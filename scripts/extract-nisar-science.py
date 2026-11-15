"""Read bounded GCOV windows through authenticated HTTP ranges; never retain credentials."""
from __future__ import annotations

import argparse
from email.utils import parsedate_to_datetime
import hashlib
import json
import os
from pathlib import Path
import re
import traceback
from urllib.parse import urlsplit

import h5py
import numpy as np
import remfile
import requests
import rasterio
from affine import Affine
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.warp import reproject, transform_bounds

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/nasa/nisar"
NASA_HOST = "nisar.asf.earthdatacloud.nasa.gov"
CDN_HOST = "d1mv8zhcvry6x4.cloudfront.net"
BASE = "/science/LSAR/GCOV/grids/frequencyA"
SCIENCE = DATA / "science"
POLARIZATIONS = ("HH", "HV")
SPEC_URL = "https://cumulus.asf.earthdatacloud.nasa.gov/PUBLIC/DATA/NISAR/NISAR_D-102274_RevF_NASA_SDS_Product_Specification_L2_GCOV_w-esigs.pdf"


class SafeAccessError(RuntimeError):
    pass


class RangeSession(requests.Session):
    def __init__(self, expected_size):
        super().__init__()
        self.expected_size = expected_size
        self.bytes_read = 0
        self.range_requests = 0
        self.http_date = None

    def get(self, url, **kwargs):
        if urlsplit(url).scheme != "https" or urlsplit(url).hostname != CDN_HOST:
            raise SafeAccessError("Range request host is not the approved provider CDN.")
        headers = dict(kwargs.pop("headers", {}))
        if any(key.lower() == "authorization" for key in headers):
            raise SafeAccessError("Credentials must not be forwarded to the CDN.")
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", headers.get("Range", ""))
        if not match:
            raise SafeAccessError("A bounded HTTP range is required.")
        start, end = map(int, match.groups())
        if not 0 <= start <= end < self.expected_size or end - start + 1 > 32 * 1024**2:
            raise SafeAccessError("Requested range exceeds the bounded read policy.")
        if self.bytes_read + end - start + 1 > 512 * 1024**2:
            raise SafeAccessError("Partial extraction exceeded its transfer budget.")
        headers["Accept-Encoding"] = "identity"
        try:
            response = super().get(url, headers=headers, allow_redirects=False, stream=True, **kwargs)
            expected = f"bytes {start}-{end}/{self.expected_size}"
            if response.status_code != 206 or response.headers.get("Content-Range") != expected:
                status = response.status_code
                response.close()
                raise SafeAccessError(f"Expected a matching partial response; HTTP {status}.")
            content = response.content
            response.close()
            if len(content) != end - start + 1:
                raise SafeAccessError("Partial response length mismatch.")
            self.bytes_read += len(content)
            self.range_requests += 1
            self.http_date = response.headers.get("Date")
            return response
        except requests.RequestException:
            raise SafeAccessError("Provider range request failed; URL and headers withheld.") from None


def open_remote(url: str, size: int, token_path: Path):
    if urlsplit(url).scheme != "https" or urlsplit(url).hostname != NASA_HOST or urlsplit(url).query:
        raise SafeAccessError("Expected the canonical NASA product URL.")
    if token_path.resolve().is_relative_to(ROOT):
        raise SafeAccessError("Credential storage must be outside the repository.")
    token = token_path.read_text(encoding="utf-8").strip()
    if not token or "\n" in token or "\r" in token:
        raise SafeAccessError("The external credential file is invalid.")
    try:
        response = requests.get(url, headers={"Authorization": "Bearer " + token, "Range": "bytes=0-511"},
                                allow_redirects=False, stream=True, timeout=(15, 30))
        if response.status_code not in (302, 303, 307):
            status = response.status_code
            response.close()
            raise SafeAccessError(f"NASA did not return a product redirect; HTTP {status}.")
        redirect = response.headers.get("Location", "")
        http_date = response.headers.get("Date")
        response.close()
    except requests.RequestException:
        raise SafeAccessError("NASA authentication request failed; details withheld.") from None
    finally:
        token = ""
    if urlsplit(redirect).scheme != "https" or urlsplit(redirect).hostname != CDN_HOST:
        raise SafeAccessError("NASA returned an unexpected product host.")
    remote = remfile.File(redirect, _size=size, verbose=False, _min_chunk_size=256 * 1024,
                          _max_cache_size=256 * 1024**2, _max_chunk_size=16 * 1024**2)
    remote.session.close()
    remote.session = RangeSession(size)
    return remote, http_date


def clean(value):
    if isinstance(value, (bytes, np.bytes_)):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, np.ndarray):
        return clean(value.tolist())
    if isinstance(value, np.generic):
        return clean(value.item())
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, float) and not np.isfinite(value):
        return "NaN" if np.isnan(value) else str(value)
    if isinstance(value, h5py.Reference):
        return "HDF5 dimension reference"
    return value


def sources():
    manifest = json.loads((DATA / "manifest.json").read_bytes())
    for record in manifest["records"]:
        metadata = json.loads((DATA / record["metadata"]["path"]).read_bytes())
        url = next(item["URL"] for item in metadata["RelatedUrls"]
                   if item.get("Type") == "GET DATA" and item.get("Format") == "HDF5")
        archive = next(item for item in metadata["DataGranule"]["ArchiveAndDistributionInformation"]
                       if item["Name"] == record["granuleUr"] + ".h5")
        yield record, url, archive


def identity(path: Path):
    payload = path.read_bytes()
    return {"path": path.relative_to(DATA).as_posix(), "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest()}


def target_grid():
    return json.loads((ROOT / "data/sentinel-1/manifest.json").read_bytes())["grid"]


def attributes(dataset):
    return {key: clean(value) for key, value in dataset.attrs.items()}


def native_validity(power, subswath, exceptions, polarization):
    bit = {"HH": 256, "HV": 512}[polarization]
    return ((subswath >= 1) & (subswath <= 5) & (exceptions != 65535)
            & ((exceptions & 255) == 0) & ((exceptions & bit) != 0)
            & np.isfinite(power) & (power > 0))


def power_to_db(power):
    result = np.full(power.shape, np.nan, dtype=np.float32)
    valid = np.isfinite(power) & (power > 0)
    result[valid] = (10 * np.log10(power[valid].astype(np.float64))).astype(np.float32)
    return result


def average_complete_support(power, valid, source_transform, source_crs, grid):
    shape = (grid["height"], grid["width"])
    coverage = np.zeros(shape, dtype=np.float64)
    denominator = np.zeros(shape, dtype=np.float64)
    average = np.zeros(shape, dtype=np.float32)
    options = dict(src_transform=source_transform, src_crs=source_crs,
                   dst_transform=Affine(*grid["transform"]), dst_crs=grid["crs"],
                   resampling=Resampling.average, num_threads=1)
    reproject(valid.astype(np.float64), coverage, **options)
    reproject(np.ones(power.shape, dtype=np.float64), denominator, **options)
    reproject(np.where(valid, power, 0).astype(np.float32), average, **options)
    complete = (denominator >= 1 - 1e-12) & (coverage >= denominator - 1e-12)
    complete &= np.isfinite(average) & (average > 0)
    average[~complete] = np.nan
    return average, complete


def read_native_window(record, url, archive, token_path, cache_directory):
    grid = target_grid()
    grid_hash = hashlib.sha256(json.dumps(grid, sort_keys=True).encode()).hexdigest()
    cache = cache_directory / (record["conceptId"] + "-" + grid_hash[:12] + ".npz")
    metadata_cache = cache.with_suffix(".json")
    if cache.exists() and metadata_cache.exists():
        meta = json.loads(metadata_cache.read_bytes())
        if meta["source"]["providerChecksum"] != archive["Checksum"]:
            raise ValueError("Cached window source checksum differs from pinned metadata.")
        if hashlib.sha256(cache.read_bytes()).hexdigest() != meta["cacheSha256"]:
            raise ValueError("Native cache checksum mismatch.")
        with np.load(cache, allow_pickle=False) as retained:
            arrays = {name: retained[name] for name in retained.files}
        return arrays, meta
    remote, http_date = open_remote(url, archive["SizeInBytes"], token_path)
    try:
        with h5py.File(remote, "r") as source:
            group = source[BASE]
            crs = "EPSG:" + str(int(group["projection"][()]))
            dx, dy = float(group["xCoordinateSpacing"][()]), float(group["yCoordinateSpacing"][()])
            x, y = group["xCoordinates"][:], group["yCoordinates"][:]
            if crs != "EPSG:32651" or dx != 10 or dy != -10:
                raise ValueError("The pinned native grid differs from the verified 10 m UTM grid.")
            if not np.allclose(np.diff(x), dx, rtol=0, atol=1e-9) or not np.allclose(np.diff(y), dy, rtol=0, atol=1e-9):
                raise ValueError("Native coordinate vectors are not regular.")
            if any(attributes(group[name]).get("pixel_coordinate_convention") != "center" for name in ["xCoordinates", "yCoordinates"]):
                raise ValueError("Native coordinates must describe pixel centers.")
            transform = Affine(dx, 0, float(x[0] - dx / 2), 0, dy, float(y[0] - dy / 2))
            target = Affine(*grid["transform"])
            left, top = target * (0, 0)
            right, bottom = target * (grid["width"], grid["height"])
            west, south, east, north = transform_bounds(grid["crs"], crs, left, bottom, right, top, densify_pts=101)
            col0 = max(0, int(np.floor((west - transform.c) / dx)) - 4)
            col1 = min(len(x), int(np.ceil((east - transform.c) / dx)) + 4)
            row0 = max(0, int(np.floor((north - transform.f) / dy)) - 4)
            row1 = min(len(y), int(np.ceil((south - transform.f) / dy)) + 4)
            window_transform = transform * Affine.translation(col0, row0)
            window_left, window_top = window_transform * (0, 0)
            window_right, window_bottom = window_transform * (col1 - col0, row1 - row0)
            if not (window_left < west < east < window_right and window_bottom < south < north < window_top):
                raise ValueError("The target grid does not have full native-window support.")
            arrays, datasets = {}, {}
            for name in ["HHHH", "HVHV", "mask", "inputDataExceptionMask"]:
                dataset = group[name]
                attrs = attributes(dataset)
                if dataset.shape != (len(y), len(x)):
                    raise ValueError("Native science and quality grids differ.")
                if name in ["HHHH", "HVHV"]:
                    if attrs.get("units") != "1" or attrs.get("_FillValue") != "NaN":
                        raise ValueError("Expected dimensionless linear covariance with NaN fill.")
                    if any(str(attrs.get(k, "false")).lower() == "true" for k in ["isReceiveOnlyChannel1", "isReceiveOnlyChannel2"]):
                        raise ValueError("Receive-only noise observations are not a calibrated scene comparison.")
                    if "scale_factor" in attrs or "add_offset" in attrs:
                        raise ValueError("Unexpected packed science values require an explicit conversion review.")
                arrays[name] = dataset[row0:row1, col0:col1]
                datasets[name] = {"path": BASE + "/" + name, "dtype": str(dataset.dtype),
                                  "shape": list(dataset.shape), "chunks": list(dataset.chunks),
                                  "storageFillValue": clean(dataset.fillvalue), "attributes": attrs}
            identification = {}
            for name in ["productType", "productVersion", "absoluteOrbitNumber", "trackNumber", "frameNumber", "zeroDopplerStartTime", "zeroDopplerEndTime", "radarBand", "orbitPassDirection"]:
                path = "/science/LSAR/identification/" + name
                if path in source:
                    identification[name] = clean(source[path][()])
            if identification.get("productType") != "GCOV":
                raise ValueError("HDF5 identification is not GCOV.")
            meta = {
                "conceptId": record["conceptId"], "acquisitionStart": record["acquisitionStart"],
                "source": {"url": url, "granuleUr": record["granuleUr"], "wholeFileBytes": archive["SizeInBytes"],
                           "providerChecksum": archive["Checksum"], "wholeFileChecksumLocallyVerified": False,
                           "wholeFileDownloaded": False, "httpRangeBytesRead": remote.session.bytes_read,
                           "httpRangeRequests": remote.session.range_requests,
                           "providerHttpDate": http_date,
                           "retrievedAt": parsedate_to_datetime(http_date).isoformat(),
                           "timestampBasis": "NASA HTTPS response Date; workstation clock not used"},
                "identification": identification,
                "nativeGrid": {"crs": crs, "width": len(x), "height": len(y), "transform": list(transform)[:6],
                               "pixelSizeMeters": [dx, abs(dy)], "pixelCoordinateConvention": "center vectors; transform describes outer edges",
                               "projectionAttributes": attributes(group["projection"])},
                "window": {"columnStart": col0, "columnEndExclusive": col1, "rowStart": row0, "rowEndExclusive": row1,
                           "width": col1 - col0, "height": row1 - row0, "transform": list(window_transform)[:6],
                           "targetNativeBounds": [west, south, east, north], "fullTargetExtentSupported": True},
                "datasets": datasets,
            }
            meta["source"]["httpRangeBytesRead"] = remote.session.bytes_read
            meta["source"]["httpRangeRequests"] = remote.session.range_requests
        cache_directory.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(cache, **arrays)
        meta["cacheSha256"] = hashlib.sha256(cache.read_bytes()).hexdigest()
        metadata_cache.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
        return arrays, meta
    finally:
        remote.session.close()


def write_tiff(path, bands, grid, names, units):
    with rasterio.open(path, "w", driver="GTiff", width=grid["width"], height=grid["height"],
                       count=len(bands), dtype=bands.dtype, crs=grid["crs"], transform=Affine(*grid["transform"]),
                       nodata=np.nan if np.issubdtype(bands.dtype, np.floating) else 0,
                       tiled=True, blockxsize=256, blockysize=256, compress="deflate",
                       predictor=3 if np.issubdtype(bands.dtype, np.floating) else 2) as target:
        target.write(bands)
        target.update_tags(AREA_OR_POINT="Area", source="NASA-ISRO NISAR GCOV frequency A")
        for index, name in enumerate(names, 1):
            target.set_band_description(index, name)
            target.update_tags(index, units=units)
    return identity(path)


def statistics(values, edges):
    data = values[np.isfinite(values)].astype(np.float64)
    histogram, _ = np.histogram(data, bins=edges)
    if int(histogram.sum()) != len(data):
        raise ValueError("Histogram bounds omit valid values.")
    return {"validPixels": len(data), "min": float(data.min()), "max": float(data.max()),
            "mean": float(data.mean()), "median": float(np.median(data)),
            "p02": float(np.quantile(data, .02)), "p05": float(np.quantile(data, .05)),
            "p95": float(np.quantile(data, .95)), "p98": float(np.quantile(data, .98)),
            "histogram": {"edges": edges.tolist(), "counts": histogram.tolist()}}


def histogram_edges(arrays, bins=80):
    values = np.concatenate([a[np.isfinite(a)] for a in arrays])
    if not len(values):
        raise ValueError("No valid science pixels remain.")
    low, high = np.floor(float(values.min()) * 2) / 2, np.ceil(float(values.max()) * 2) / 2
    if low == high:
        high = low + .5
    return np.linspace(low, high, bins + 1)


def extract(token_path, cache_directory):
    SCIENCE.mkdir(parents=True, exist_ok=True)
    grid = target_grid()
    records, db_pair, outputs = [], [], []
    for record, url, archive in sources():
        arrays, meta = read_native_window(record, url, archive, token_path, cache_directory)
        date = record["acquisitionStart"][:10]
        powers, masks, excluded_counts = [], [], {}
        for polarization in POLARIZATIONS:
            raw = arrays[polarization * 2]
            valid = native_validity(raw, arrays["mask"], arrays["inputDataExceptionMask"], polarization)
            averaged, complete = average_complete_support(raw, valid, Affine(*meta["window"]["transform"]), meta["nativeGrid"]["crs"], grid)
            powers.append(averaged); masks.append(complete)
            bit = {"HH": 256, "HV": 512}[polarization]
            excluded_counts[polarization] = {
                "nativeWindowPixels": raw.size, "nativeValidPixels": int(valid.sum()),
                "subswathInvalidOrOutside": int(np.count_nonzero((arrays["mask"] < 1) | (arrays["mask"] > 5))),
                "inputExceptionOrFill": int(np.count_nonzero((arrays["inputDataExceptionMask"] & 255) != 0)),
                "polarizationValidityBitMissing": int(np.count_nonzero((arrays["inputDataExceptionMask"] & bit) == 0)),
                "nonpositiveOrNonfinitePower": int(np.count_nonzero(~np.isfinite(raw) | (raw <= 0))),
                "targetValidPixels": int(complete.sum()), "targetExcludedPixels": int(complete.size - complete.sum()),
                "reasonCountsOverlap": True,
            }
        linear = np.stack(powers); db = power_to_db(linear); mask = np.stack(masks).astype(np.uint8)
        db_pair.append(db)
        files = {
            "linearPower": write_tiff(SCIENCE / f"{date}-linear.tif", linear, grid, POLARIZATIONS, "1"),
            "backscatterDb": write_tiff(SCIENCE / f"{date}-db.tif", db, grid, POLARIZATIONS, "dB gamma0"),
            "validMask": write_tiff(SCIENCE / f"{date}-valid.tif", mask, grid, POLARIZATIONS, "1=valid;0=excluded"),
        }
        metadata_path = SCIENCE / f"{date}-metadata.json"
        public_meta = {key: value for key, value in meta.items() if key != "cacheSha256"}
        public_meta["qualityCounts"] = excluded_counts
        metadata_path.write_text(json.dumps(public_meta, indent=2) + "\n", encoding="utf-8")
        files["metadata"] = identity(metadata_path)
        outputs.extend(files.values())
        records.append({"conceptId": record["conceptId"], "date": date, "acquisitionStart": record["acquisitionStart"],
                        "track": record["track"], "frame": record["frame"], "direction": record["direction"],
                        "files": files, "source": public_meta["source"], "nativeGrid": meta["nativeGrid"],
                        "qualityCounts": excluded_counts})
        print(json.dumps({"extracted": date, "nativeCrs": meta["nativeGrid"]["crs"],
                          "bytesRead": meta["source"]["httpRangeBytesRead"], "validPixels": [int(m.sum()) for m in masks]}), flush=True)
    common = np.isfinite(db_pair[0]) & np.isfinite(db_pair[1])
    change = np.full(db_pair[0].shape, np.nan, dtype=np.float32)
    change[common] = db_pair[1][common] - db_pair[0][common]
    change_file = write_tiff(SCIENCE / "change-db.tif", change, grid, ["delta_HH", "delta_HV"], "dB; 2026-11-02 minus 2026-10-21")
    common_file = write_tiff(SCIENCE / "common-valid.tif", common.astype(np.uint8), grid, POLARIZATIONS, "1=valid in both dates;0=excluded")
    outputs.extend([change_file, common_file])
    for band, polarization in enumerate(POLARIZATIONS):
        edges = histogram_edges([db_pair[0][band], db_pair[1][band]])
        for i in range(2):
            records[i].setdefault("statistics", {})[polarization] = statistics(db_pair[i][band], edges)
    delta_edges = histogram_edges([change[0], change[1]])
    change_stats = {pol: statistics(change[i], delta_edges) for i, pol in enumerate(POLARIZATIONS)}
    transect = make_transect(grid, db_pair, change)
    transect_path = SCIENCE / "transect.json"
    transect_path.write_text(json.dumps(transect, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    outputs.append(identity(transect_path))
    multi_frequency = make_multi_frequency(db_pair, grid)
    outputs.extend([multi_frequency["file"], multi_frequency["commonMask"]])
    manifest = {
        "schemaVersion": 1, "kind": "calibrated-gcov-backscatter-comparison",
        "grid": grid, "polarizations": list(POLARIZATIONS), "bandOrder": ["HH", "HV"],
        "frequency": "A", "units": "dB gamma0", "linearUnits": "1",
        "records": records, "outputs": outputs,
        "change": {"direction": "2026-11-02 minus 2026-10-21", "units": "dB", "file": change_file,
                   "commonMask": common_file, "statistics": change_stats},
        "transect": identity(transect_path),
        "multiFrequency": multi_frequency,
        "processing": {
            "calibration": "GCOV real diagonal HHHH/HVHV terms are provider-calibrated, radiometrically terrain-corrected gamma0 linear power. No additional RTC gamma-to-sigma factor or scale applied.",
            "resampling": "GDAL area-weighted average of linear power, after per-polarization validity screening, to the existing Sentinel-1 EPSG:3857 grid; 10*log10 only after averaging.",
            "targetSupport": "Densified transformed target extent lies strictly inside the retained native window with a four-pixel margin. Reprojected valid coverage must equal total support within 1e-12; invalid source pixels contribute 0 to both power and coverage before target exclusion.",
            "nativeValidity": "mask in 1..5; inputDataExceptionMask low 8 bits equal 0, fill 65535 excluded, HH bit 256/HV bit 512 required; finite positive linear power. Per-polarization masks remain separate.",
            "difference": "Float32 later-minus-earlier dB only where the same polarization is valid on both dates; no cross-polarization subtraction.",
            "receiveOnly": "No receive-only flags are present on these HHHH/HVHV datasets; extraction rejects an explicit true flag if present.",
            "noiseFloor": "Noise-equivalent backscatter is not subtracted and no additional noise-floor, layover or shadow screen is applied.",
            "registration": "Identical provider native grid verified; deterministic reprojection to identical output grid. No independent ground-control registration accuracy is claimed.",
        },
        "limitations": [
            "These October/November 2026 observations do not observe the July 2024 Carina event.",
            "Calibrated backscatter change alone does not identify floodwater or establish a universal HH threshold.",
            "Surface/land-cover changes, speckle, soil moisture, geometry and instrument effects can contribute to differences.",
            "GCOV validity masks are not a complete flood, layover, shadow or noise-floor classification.",
            "30 m projected output spacing is resampling, not a claim of 30 m independent physical resolution.",
            "HDF5 source MD5 values are provider metadata; whole-file checksums were not locally verified because only HTTP ranges were read.",
        ],
        "sources": ["https://nisar-docs.asf.alaska.edu/gcov/", SPEC_URL, "https://nisar-docs.asf.alaska.edu/gdal/"],
        "reproduction": "python scripts/extract-nisar-science.py; requires an external Earthdata credential file only for uncached native windows. Native cache stays outside the repository.",
    }
    (SCIENCE / "manifest.json").write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    update_catalog_manifest(manifest)
    print(json.dumps({"manifest": identity(SCIENCE / "manifest.json"), "changeStatistics": {k: {a: b for a, b in v.items() if a != "histogram"} for k, v in change_stats.items()}}, indent=2))
    return manifest


def make_transect(grid, pair, change):
    reference_path = ROOT / "data/transect/reference.json"
    reference = json.loads(reference_path.read_bytes())
    project = Transformer.from_crs("EPSG:4326", grid["crs"], always_xy=True)
    inverse = ~Affine(*grid["transform"])
    with rasterio.open(ROOT / "data/sentinel-1/baseline.tif") as src:
        sentinel_before = src.read()
    with rasterio.open(ROOT / "data/sentinel-1/post.tif") as src:
        sentinel_after = src.read()
    with rasterio.open(ROOT / "data/sentinel-1/dem.tif") as src:
        dsm = src.read(1)
    def sample(point):
        x, y = project.transform(point["lon"], point["lat"])
        column, row = inverse * (x, y)
        column, row = int(np.floor(column)), int(np.floor(row))
        def values(array, names):
            return {name: float(array[i, row, column]) if np.isfinite(array[i, row, column]) else None for i, name in enumerate(names)}
        return {**point, "column": column, "row": row, "dsmM": float(dsm[row, column]) if np.isfinite(dsm[row, column]) else None,
                "sentinel1": {"before": values(sentinel_before, ["VV", "VH"]), "after": values(sentinel_after, ["VV", "VH"]),
                              "change": values(sentinel_after - sentinel_before, ["VV", "VH"])},
                "nisar": {"before": values(pair[0], POLARIZATIONS), "after": values(pair[1], POLARIZATIONS), "change": values(change, POLARIZATIONS)}}
    return {"schemaVersion": 1, "units": {"backscatter": "dB gamma0", "change": "dB later minus earlier", "dsm": "m EGM2008"},
            "sentinel1Dates": ["2024-07-10", "2024-08-03"], "nisarDates": ["2026-10-21", "2026-11-02"],
            "referenceSha256": hashlib.sha256(reference_path.read_bytes()).hexdigest(),
            "samples": [sample({"index": i, "lon": point["lon"], "lat": point["lat"], "distanceM": point["distance_m"]}) for i, point in enumerate(reference["samples"])],
            "selectedLocations": [sample({"name": "Tumana", "lon": 121.09593983925672, "lat": 14.6580158})],
            "comparisonScope": "Each sensor's own date pair and polarizations. C-band 2024 VV/VH and L-band 2026 HH/HV are descriptive colocated samples, not a direct cross-sensor change measurement."}


def make_multi_frequency(nisar_pair, grid):
    sentinel_pair = []
    for filename in ["baseline.tif", "post.tif"]:
        with rasterio.open(ROOT / "data/sentinel-1" / filename) as source:
            if source.crs.to_string() != grid["crs"] or list(source.transform)[:6] != grid["transform"] or source.shape != (grid["height"], grid["width"]):
                raise ValueError("Cross-sensor descriptive statistics require identical grids.")
            sentinel_pair.append(source.read())
    common = np.logical_and.reduce([np.all(np.isfinite(array), axis=0) for array in [*sentinel_pair, *nisar_pair]])
    rows, differences = [], []
    for sensor, names, dates, pair in [
        ("Sentinel-1", ("VV", "VH"), ("2024-07-10", "2024-08-03"), sentinel_pair),
        ("NISAR", POLARIZATIONS, ("2026-10-21", "2026-11-02"), nisar_pair),
    ]:
        for band, polarization in enumerate(names):
            edges = histogram_edges([array[band][common] for array in pair])
            for date, array in zip(dates, pair):
                rows.append({"sensor": sensor, "polarization": polarization, "date": date,
                             **statistics(array[band][common], edges)})
            delta = pair[1][band][common] - pair[0][band][common]
            differences.append({"sensor": sensor, "polarization": polarization, "direction": f"{dates[1]} minus {dates[0]}",
                                **statistics(delta, histogram_edges([delta]))})
    mask = write_tiff(SCIENCE / "multi-frequency-valid.tif", common[np.newaxis].astype(np.uint8), grid,
                      ["all_dates_and_polarizations"], "1=valid in every retained radar band;0=excluded")
    path = SCIENCE / "multi-frequency.json"
    report = {"schemaVersion": 1, "units": "dB gamma0", "validPixels": int(common.sum()), "commonMask": mask,
              "maskDefinition": "Intersection of finite Sentinel-1 VV/VH on both 2024 dates and valid calibrated NISAR HH/HV on both 2026 dates, on the identical aligned grid.",
              "rows": rows, "withinPairChanges": differences,
              "scope": "Descriptive comparison over the same spatial cells. Acquisition dates, wavelength and polarizations differ; no NISAR-minus-Sentinel physical change is calculated."}
    path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return {"file": identity(path), "commonMask": mask, "validPixels": int(common.sum()), "scope": report["scope"]}


def update_catalog_manifest(science):
    path = DATA / "manifest.json"
    catalog = json.loads(path.read_bytes())
    catalog.update({
        "title": "NISAR calibrated GCOV subsets, catalog and browse references over the Marikina region",
        "scope": "calibrated-science-subsets-and-browse-reference", "scienceRasterDownloaded": True,
        "quantitativeAnalysisPerformed": True, "wholeScienceFilesDownloaded": False,
        "coRegistered": False,
        "registrationScope": "Science grids are aligned by verified provider coordinates and deterministic reprojection; independent ground-control registration accuracy is not established.",
        "science": {**identity(SCIENCE / "manifest.json"), "polarizations": science["polarizations"],
                    "units": science["units"], "grid": science["grid"],
                    "commonValidPixels": {pol: science["change"]["statistics"][pol]["validPixels"] for pol in POLARIZATIONS},
                    "wholeFileChecksumsLocallyVerified": False},
        "limitations": [
            "Calibrated HH/HV subsets are extracted from the retained HDF5 products; the complete HDF5 files are not downloaded or locally checksum-verified.",
            "These October and November 2026 observations do not observe the July 2024 Carina event.",
            "Browse colors remain provider-rendered context. Quantitative values come only from the separate calibrated science rasters.",
            "Aligned science grids do not establish independent ground-control registration accuracy or identify floodwater from backscatter change alone.",
            "VALIDATED is the provider's product maturity label; it does not validate any K-SAR flood or routing result.",
            "Frequency A and B are L-SAR subbands, not separate L-band and S-band instruments.",
        ],
    })
    path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def probe(token_path: Path):
    reports = []
    for record, url, archive in sources():
        remote, date = open_remote(url, archive["SizeInBytes"], token_path)
        try:
            with h5py.File(remote, "r") as source:
                group = source[BASE]
                result = {"conceptId": record["conceptId"], "providerHttpDate": date, "datasets": {}}
                for name in group:
                    item = group[name]
                    info = {"shape": item.shape, "dtype": str(item.dtype), "chunks": item.chunks,
                            "attrs": {key: clean(value) for key, value in item.attrs.items()}}
                    if item.ndim == 0:
                        info["value"] = clean(item[()])
                    elif item.ndim == 1:
                        info["first"] = clean(item[0]); info["last"] = clean(item[-1])
                    result["datasets"][name] = info
                result["bytesRead"] = remote.session.bytes_read
                result["rangeRequests"] = remote.session.range_requests
                reports.append(result)
        finally:
            remote.session.close()
    return reports


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--token-file", type=Path,
                        default=Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "K-SAR/earthdata-token.txt")
    parser.add_argument("--probe", action="store_true")
    parser.add_argument("--cache-directory", type=Path,
                        default=Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "K-SAR/science-cache")
    args = parser.parse_args()
    try:
        if args.cache_directory.resolve().is_relative_to(ROOT):
            raise SafeAccessError("Native authentication cache must stay outside the repository.")
        if args.probe:
            print(json.dumps(probe(args.token_file), indent=2))
        else:
            extract(args.token_file, args.cache_directory)
    except Exception as error:
        # Third-party exception strings can contain a signed URL; never emit them.
        frames = [{"function": frame.name, "line": frame.lineno} for frame in traceback.extract_tb(error.__traceback__)
                  if Path(frame.filename).resolve() == Path(__file__).resolve()]
        print(json.dumps({"errorType": type(error).__name__, "frames": frames,
                          "message": "Extraction failed; sensitive request details withheld."}))
        raise SystemExit(1) from None
