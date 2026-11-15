"""Reproject pinned provider browse codes using their linked KML image bounds.

Requires numpy and Pillow. Run with --fetch once to retrieve the two pinned KMLs;
subsequent runs are offline and deterministic. This never downloads science HDF5
pixels and never interprets rendered PNG values as backscatter or a flood class.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/nasa/nisar"
OUTPUT = DATA / "comparison"
RADIUS = 6378137.0
AOI = (121.04, 14.5, 121.15, 14.75)
SPACING = 200
NO_DATA = -32768
SOURCE_COMMIT = "a8bc425f5e8873174471d6a12fe622df338623d1"
SOURCE_BASE = f"https://github.com/isce-framework/nisarqa/blob/{SOURCE_COMMIT}/src/nisarqa"


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def file_record(path, data=DATA):
    path = Path(path)
    return {"path": path.relative_to(data).as_posix(), "bytes": path.stat().st_size,
            "sha256": sha256(path)}


def parse_overlay(data: bytes, expected_png: str):
    """Accept only the provider's north-up EPSG:4326 image-edge rectangle."""
    root = ET.fromstring(data)
    overlay = next((e for e in root.iter() if e.tag.split("}")[-1] == "GroundOverlay"), None)
    if overlay is None:
        raise ValueError("KML has no GroundOverlay")
    hrefs = [e.text for e in overlay.iter() if e.tag.split("}")[-1] == "href"]
    if hrefs != [expected_png]:
        raise ValueError("KML does not name the exact retained PNG")
    quads = [e for e in overlay.iter() if e.tag.endswith("LatLonQuad")]
    if len(quads) != 1:
        raise ValueError("Exactly one provider LatLonQuad is required")
    coordinates = next(e.text for e in quads[0].iter() if e.tag.split("}")[-1] == "coordinates")
    points = [tuple(map(float, item.split(",")[:2])) for item in coordinates.split()]
    if len(points) != 4 or not all(math.isfinite(v) for p in points for v in p):
        raise ValueError("Invalid KML corner coordinates")
    (west, south), (east, s2), (e2, north), (w2, n2) = points
    if not (west < east and south < north and abs(south - s2) < 1e-10
            and abs(east - e2) < 1e-10 and abs(west - w2) < 1e-10
            and abs(north - n2) < 1e-10):
        raise ValueError("Only axis-aligned counterclockwise KML rectangles are supported")
    return (west, south, east, north)


def forward(lon, lat):
    return RADIUS * np.radians(lon), RADIUS * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def inverse(x, y):
    return np.degrees(x / RADIUS), np.degrees(2 * np.arctan(np.exp(y / RADIUS)) - np.pi / 2)


def output_grid(bounds=AOI, spacing=SPACING):
    left, bottom = forward(bounds[0], bounds[1])
    right, top = forward(bounds[2], bounds[3])
    left, bottom = math.floor(left / spacing) * spacing, math.floor(bottom / spacing) * spacing
    right, top = math.ceil(right / spacing) * spacing, math.ceil(top / spacing) * spacing
    width, height = round((right - left) / spacing), round((top - bottom) / spacing)
    x, y = np.meshgrid(left + (np.arange(width) + .5) * spacing,
                       top - (np.arange(height) + .5) * spacing)
    lon, lat = inverse(x, y)
    west, south = inverse(left, bottom)
    east, north = inverse(right, top)
    return ({"crs": "EPSG:3857", "width": width, "height": height,
             "pixelSizeMeters": spacing, "boundsMeters": [left, bottom, right, top],
             "boundsWgs84": {"west": float(west), "south": float(south),
                             "east": float(east), "north": float(north)},
             "transform": [spacing, 0, left, 0, -spacing, top],
             "pixelCoordinateConvention": "area; samples taken at cell centers",
             "requestedBoundsWgs84": list(bounds)}, lon, lat)


def in_polygon(lon, lat, ring):
    inside = np.zeros(lon.shape, dtype=bool)
    for a, b in zip(ring, ring[1:]):
        x1, y1 = a
        x2, y2 = b
        if y1 == y2:
            continue
        crossing = ((y1 > lat) != (y2 > lat)) & (lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1)
        inside ^= crossing
    return inside


def source_pixels(bounds, width, height, lon, lat):
    west, south, east, north = bounds
    column = np.floor((lon - west) / (east - west) * width).astype(np.int64)
    row = np.floor((north - lat) / (north - south) * height).astype(np.int64)
    valid = (column >= 0) & (column < width) & (row >= 0) & (row < height)
    return column, row, valid


def brightness(rgb):
    """Rec.709 weights on DISPLAY CODES, not linear-light radiance/luminance."""
    a = rgb.astype(np.int32)
    return ((a[..., 0] * 2126 + a[..., 1] * 7152 + a[..., 2] * 722 + 5000) // 10000).astype(np.int16)


def difference(before, after, common):
    result = np.full(common.shape, NO_DATA, dtype=np.int16)
    result[common] = brightness(after)[common] - brightness(before)[common]
    return result


def statistics(values):
    values = np.asarray(values, dtype=np.int16)
    if not values.size:
        raise ValueError("No common valid samples")
    return {"min": int(values.min()), "max": int(values.max()),
            "mean": float(values.mean()), "median": float(np.median(values)),
            "meanAbsolute": float(np.abs(values.astype(np.int32)).mean()),
            "negativePixels": int((values < 0).sum()), "unchangedPixels": int((values == 0).sum()),
            "positivePixels": int((values > 0).sum()),
            "histogram": {"min": -255, "max": 255, "step": 1,
                          "counts": np.bincount(values + 255, minlength=511).tolist()}}


def shifted_correlation(before, after, valid, max_shift=2):
    """Diagnostic of browse texture only. No shift is applied to the data."""
    scores = []
    height, width = valid.shape
    for dy in range(-max_shift, max_shift + 1):
        for dx in range(-max_shift, max_shift + 1):
            a_y = slice(max(0, -dy), min(height, height - dy))
            a_x = slice(max(0, -dx), min(width, width - dx))
            b_y = slice(max(0, dy), min(height, height + dy))
            b_x = slice(max(0, dx), min(width, width + dx))
            ok = valid[a_y, a_x] & valid[b_y, b_x]
            a = before[a_y, a_x][ok].astype(float)
            b = after[b_y, b_x][ok].astype(float)
            if a.size >= 2:
                a -= a.mean()
                b -= b.mean()
                denominator = np.linalg.norm(a) * np.linalg.norm(b)
                score = float(a @ b / denominator) if denominator > 0 else None
            else:
                score = None
            scores.append({"columns": dx, "rows": dy, "correlation": score, "samples": int(ok.sum())})
    informative = [s for s in scores if s["correlation"] is not None]
    best = max(informative, key=lambda s: s["correlation"]) if informative else None
    return {"bestIntegerShift": best,
            "zeroShiftCorrelation": next(s["correlation"] for s in scores if s["columns"] == s["rows"] == 0),
            "searchRadiusOutputPixels": max_shift, "scores": scores,
            "interpretation": "Texture correlation on reprojected display brightness, not independent ground-control validation or a positional accuracy estimate. No correction applied."}


def load_inputs(fetch=False, output=OUTPUT):
    original = json.loads((DATA / "manifest.json").read_bytes())
    output.mkdir(parents=True, exist_ok=True)
    (output / "raw").mkdir(exist_ok=True)
    downloads_path = output / "raw/retrievals.json"
    downloads = json.loads(downloads_path.read_bytes()) if downloads_path.exists() else {}
    results = []
    for record in original["records"]:
        if sha256(DATA / record["browse"]["path"]) != record["browse"]["sha256"]:
            raise ValueError("Source PNG SHA mismatch")
        if sha256(DATA / record["metadata"]["path"]) != record["metadata"]["sha256"]:
            raise ValueError("Source CMR metadata SHA mismatch")
        metadata = json.loads((DATA / record["metadata"]["path"]).read_bytes())
        png_name = record["browse"]["providerFilename"]
        kml_name = png_name.replace(".png", ".kml")
        entry = next(e for e in metadata["DataGranule"]["ArchiveAndDistributionInformation"] if e["Name"] == kml_name)
        url = next(r["URL"] for r in metadata["RelatedUrls"] if r["URL"].startswith("https://") and r["URL"].endswith("/" + kml_name))
        path = output / "raw" / (record["conceptId"] + "_LATLON.kml")
        if fetch:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(100_000)
                final = urllib.parse.urlsplit(response.url)
                downloads[record["conceptId"]] = {"sourceUrl": url,
                    "resolvedUrl": urllib.parse.urlunsplit((final.scheme, final.netloc, final.path, "", "")),
                    "httpStatus": response.status, "httpDate": response.headers.get("Date"),
                    "timeBasis": "provider HTTP Date; local workstation clock not trusted"}
            path.write_bytes(data)
        data = path.read_bytes()
        if len(data) != entry["SizeInBytes"] or hashlib.md5(data).hexdigest() != entry["Checksum"]["Value"]:
            raise ValueError("KML provider size/MD5 mismatch")
        bounds = parse_overlay(data, png_name)
        image = np.array(Image.open(DATA / record["browse"]["path"]).convert("RGBA"))
        results.append((record, path, bounds, image, downloads.get(record["conceptId"], {})))
    if fetch:
        downloads_path.write_text(json.dumps(downloads, indent=2) + "\n", encoding="utf-8")
    return original, results


def build(fetch=False, output=OUTPUT):
    original, inputs = load_inputs(fetch, output)
    if sha256(DATA / "footprints.geojson") != original["footprints"]["sha256"]:
        raise ValueError("Source catalog footprints SHA mismatch")
    footprints = json.loads((DATA / "footprints.geojson").read_bytes())
    polygons = {f["id"]: f["geometry"]["coordinates"][0] for f in footprints["features"]}
    grid, lon, lat = output_grid()
    aoi_mask = (lon >= AOI[0]) & (lon < AOI[2]) & (lat >= AOI[1]) & (lat < AOI[3])
    images, masks, records = [], [], []
    for record, kml_path, bounds, source, retrieval in inputs:
        column, row, inside = source_pixels(bounds, source.shape[1], source.shape[0], lon, lat)
        pixels = source[np.clip(row, 0, source.shape[0] - 1), np.clip(column, 0, source.shape[1] - 1)]
        valid = inside & (pixels[..., 3] == 255) & np.all(pixels[..., :3] > 0, axis=2)
        valid &= aoi_mask & in_polygon(lon, lat, polygons[record["conceptId"]])
        images.append(pixels[..., :3])
        masks.append(valid)
        records.append({"conceptId": record["conceptId"], "date": record["acquisitionStart"][:10],
            "acquisitionStart": record["acquisitionStart"], "granuleUr": record["granuleUr"],
            "sourcePng": file_record(DATA / record["browse"]["path"]),
            "sourceMetadata": file_record(DATA / record["metadata"]["path"]),
            "kml": {**file_record(kml_path), **retrieval, "providerMd5Verified": True},
            "sourceGrid": {"crs": "EPSG:4326", "width": source.shape[1], "height": source.shape[0],
                "boundsWgs84": dict(zip(["west", "south", "east", "north"], bounds)),
                "pixelSpacingDegrees": [(bounds[2] - bounds[0]) / source.shape[1], (bounds[3] - bounds[1]) / source.shape[0]],
                "cornerConvention": "KML image edges, counterclockwise from lower left"},
            "validPixelsBeforeIntersection": int(valid.sum())})
    common = masks[0] & masks[1]
    if not common.any():
        raise ValueError("Study area has no common valid browse samples")
    for record, rgb in zip(records, images):
        rgba = np.zeros((*common.shape, 4), dtype=np.uint8)
        rgba[common, :3] = rgb[common]
        rgba[common, 3] = 255
        path = output / ("aligned-" + record["date"] + ".png")
        Image.fromarray(rgba).save(path, compress_level=9)
        record["aligned"] = file_record(path)
    mask_path = output / "common-mask.png"
    Image.fromarray(common.astype(np.uint8) * 255).save(mask_path, compress_level=9)
    delta = difference(images[0], images[1], common)
    binary_path = output / "difference.i16"
    delta.astype("<i2").tofile(binary_path)
    neutral = np.array([245, 246, 239], dtype=float)
    negative, positive = np.array([36, 111, 120]), np.array([165, 78, 39])
    rgba = np.zeros((*common.shape, 4), dtype=np.uint8)
    t = np.minimum(np.abs(delta.astype(float)), 64) / 64
    target = np.where((delta < 0)[..., None], negative, positive)
    rgba[common, :3] = np.rint(neutral + (target - neutral) * t[..., None])[common].astype(np.uint8)
    rgba[common, 3] = 255
    diff_path = output / "difference.png"
    Image.fromarray(rgba).save(diff_path, compress_level=9)
    rgb_delta = images[1].astype(np.int16) - images[0].astype(np.int16)
    stats = {channel: statistics(rgb_delta[..., i][common]) for i, channel in enumerate(["red", "green", "blue"])}
    stats["displayBrightness"] = statistics(delta[common])
    spacing_deg = records[0]["sourceGrid"]["pixelSpacingDegrees"]
    latitude = (AOI[1] + AOI[3]) / 2
    source_ground = [RADIUS * math.radians(spacing_deg[0]) * math.cos(math.radians(latitude)), RADIUS * math.radians(spacing_deg[1])]
    manifest = {"schemaVersion": 1, "kind": "provider-browse-display-comparison", "grid": grid, "records": records,
        "attribution": original["attribution"],
        "commonMask": {**file_record(mask_path), "validPixels": int(common.sum()), "totalPixels": int(common.size),
            "definition": "Both provider images have nonzero R,G,B and opaque PNG transparency at the sampled location; cell center is inside both catalog footprints and the requested study bounds. This is browse coverage, not a science quality mask."},
        "difference": {"image": file_record(diff_path), "values": {**file_record(binary_path), "dtype": "int16-le", "noData": NO_DATA, "layout": "row-major, north to south"},
            "metric": "rounded weighted RGB display code", "weights": [.2126, .7152, .0722],
            "formula": "floor((2126*R + 7152*G + 722*B + 5000)/10000) per date, then later minus earlier",
            "direction": "2026-11-02 minus 2026-10-21", "units": "DN", "displayRange": [-64, 64],
            "colors": {"negative": "#246f78", "zero": "#f5f6ef", "positive": "#a54e27"}, "statistics": stats},
        "georeferencing": {"method": "Provider-linked LATLON KML image-edge rectangles, independently checksum-bound to the exact source PNG names; no transform inferred from catalog footprints.",
            "resampling": "nearest source browse pixel at each EPSG:3857 output cell center; no additional contrast stretch",
            "sourceGroundPixelMetersAtStudyLatitude": source_ground,
            "sourcePixelHalfDiagonalMeters": math.hypot(*source_ground) / 2,
            "quantizationNote": "Half-pixel diagonal describes browse sampling scale only. It is not a geolocation accuracy or confidence bound."},
        "registration": {"providerGridIdentical": inputs[0][2] == inputs[1][2] and inputs[0][3].shape == inputs[1][3].shape,
            "correctionApplied": False, "groundControlValidated": False,
            "diagnostic": shifted_correlation(brightness(images[0]), brightness(images[1]), common)},
        "radiometry": {"scienceRasterDownloaded": False, "quantitativeBackscatterAnalysis": False,
            "providerChannelAssignment": "For HH/HV GCOV, the documented QA renderer maps HHHH to red/blue and HVHV to green after image correction.",
            "redBlueIdenticalInRetainedPair": all(np.array_equal(x[..., 0], x[..., 2]) for x in images),
            "providerProcessing": "The published QA renderer multilooks, optionally percentile-clips, converts to dB and applies gamma correction, then independently normalizes each rendered array to codes 1..255; zero is reserved for invalid values.",
            "actualProductStretchParametersVerified": False,
            "parameterCaveat": "Product runconfig/QA statistics and original HDF5 are Earthdata-authenticated. Current published defaults are not proof of the parameters used for these granules."},
        "sourceManifest": file_record(DATA / "manifest.json"), "sourceFootprints": file_record(DATA / "footprints.geojson"),
        "retrievals": file_record(output / "raw/retrievals.json"),
        "accessChecks": file_record(output / "access-checks.json"),
        "limitations": ["Rendered browse codes are not calibrated gamma-naught, dB, linear power, water depth or a flood classification.",
            "Per-scene/channel normalization, clipping and gamma processing can alter inter-date display differences independently of physical surface change.",
            "Both images share provider pixel georeferencing. Independent ground-control or science-raster registration accuracy has not been established.",
            "The common mask checks browse availability and catalog coverage, not layover, shadow, noise-floor or other HDF5 science quality flags.",
            "The 200 m projected output grid contains no new spatial detail beyond the roughly 170 m provider browse samples.",
            "These October/November 2026 acquisitions do not observe the July 2024 Carina event."],
        "sources": [{"title": "NISAR GCOV product guide", "url": "https://nisar-docs.asf.alaska.edu/gcov/"},
            {"title": "NISAR Harmony customization and authentication", "url": "https://nisar-docs.asf.alaska.edu/harmony/"},
            {"title": "Provider KML image-edge convention", "url": SOURCE_BASE + "/lonlat.py#L370-L442"},
            {"title": "Provider HH/HV browse channel assignment", "url": SOURCE_BASE + "/input_product_readers/gcov_reader.py#L192-L330"},
            {"title": "Provider image correction and display-code normalization", "url": SOURCE_BASE + "/processing/plotting_utils.py#L388-L677"}]}
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="Retrieve the two exact provider KML files before deriving outputs")
    args = parser.parse_args()
    m = build(fetch=args.fetch)
    print(json.dumps({"grid": m["grid"], "validPixels": m["commonMask"]["validPixels"],
        "displayDifference": {k: v for k, v in m["difference"]["statistics"]["displayBrightness"].items() if k != "histogram"},
        "registrationDiagnostic": m["registration"]["diagnostic"]["bestIntegerShift"]}, indent=2))
