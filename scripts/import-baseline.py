"""Explicit import of attributed pre-existing research artifacts; never synthesize pixels.

Run with Python 3.11+ from the repository. This optional reproducibility command
uses only the standard library. The application and its tests use Node/TypeScript.
"""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
from urllib.request import Request, urlopen
from email.utils import parsedate_to_datetime

ROOT = Path(__file__).resolve().parents[1]
LICENSES = {
    "copernicus-dem-licenses.pdf": "https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf",
    "sentinel-data-legal-notice.pdf": "https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice",
    "cc-by-4.0.txt": "https://creativecommons.org/licenses/by/4.0/legalcode.txt",
}


def remote(url):
    with urlopen(Request(url, headers={"User-Agent": "K-SAR research provenance importer", "Cache-Control": "no-cache"}), timeout=45) as response:
        return response.read(), dict(response.headers)


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-root", type=Path, required=True)
    parser.add_argument("--session", type=Path, required=True)
    args = parser.parse_args()
    source = args.legacy_root.resolve() / "data"
    destination = ROOT / "data" / "sentinel-1"
    destination.mkdir(parents=True, exist_ok=True)
    license_dir = ROOT / "data" / "licenses"
    license_dir.mkdir(parents=True, exist_ok=True)

    # Host wall clock was found to be offset during preparation. Preserve an
    # independently observed NASA HTTP Date, including its raw source header.
    clock_url = "https://cmr.earthdata.nasa.gov/search/collections.json?short_name=OPERA_L2_RTC-S1_V1&page_size=1"
    _, headers = remote(clock_url)
    http_date = next(v for k, v in headers.items() if k.lower() == "date")
    imported_at = parsedate_to_datetime(http_date).isoformat()
    time_evidence = {"imported_at": imported_at, "timestamp_source": clock_url, "http_date": http_date, "host_clock_used": False}

    old_manifest = json.loads((source / "raster_manifest.json").read_text())
    old_hashes = json.loads((source / "raster_sha256.json").read_text())
    records = []
    for name, role, bands, units in [
        ("baseline.tif", "Sentinel-1 RTC baseline", ["VV", "VH"], "gamma-naught dB"),
        ("post.tif", "Sentinel-1 RTC later pass", ["VV", "VH"], "gamma-naught dB"),
        ("dem.tif", "Copernicus GLO-30 DSM", ["surface_elevation"], "m EGM2008"),
    ]:
        raw = (source / name).read_bytes()
        if digest(raw) != old_hashes[name]:
            raise ValueError(f"Source hash mismatch: {name}")
        shutil.copy2(source / name, destination / name)
        records.append({"file": name, "role": role, "bytes": len(raw), "sha256": digest(raw), "bands": bands, "units": units, "radiometric_conversion_required": False})
    shutil.copy2(source / "raster_manifest.json", destination / "source-raster-manifest.json")
    shutil.copy2(source / "raster_sha256.json", destination / "source-raster-sha256.json")
    shutil.copy2(source / "dem_catalog.json", destination / "source-dem-catalog.json")
    scene_ids = {scene["id"] for scene in old_manifest["scenes"]}
    catalog = json.loads((source / "sar_catalog.json").read_text())
    save_json(destination / "source-sar-items.json", [item for item in catalog if item["id"] in scene_ids])

    license_records = []
    for name, url in LICENSES.items():
        raw, _ = remote(url)
        if name.endswith(".pdf") and not raw.startswith(b"%PDF"):
            raise ValueError(f"License endpoint did not return a PDF: {name}")
        if name.endswith(".txt") and b"Attribution 4.0 International" not in raw:
            raise ValueError("Unexpected Creative Commons license response")
        (license_dir / name).write_bytes(raw)
        license_records.append({"file": name, "source_url": url, "bytes": len(raw), "sha256": digest(raw)})
    rtc_url = "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc"
    rtc_raw, _ = remote(rtc_url)
    (license_dir / "sentinel-1-rtc-collection.json").write_bytes(rtc_raw)
    license_records.append({"file": "sentinel-1-rtc-collection.json", "source_url": rtc_url, "bytes": len(rtc_raw), "sha256": digest(rtc_raw)})
    save_json(license_dir / "sources.json", {**time_evidence, "files": license_records, "copernicus_applicable_section": "GLO-30-F public license, PDF pages 22-24 (zero-based 21-23); earlier restrictive GLO-30-R terms are a different product."})

    save_json(destination / "manifest.json", {
        "schema_version": 1, "id": "legacy-sentinel1-orbit32-july-august-2024", **time_evidence,
        "provenance": {"status": "reused pre-existing research data, byte-for-byte copies", "source_workspace": str(args.legacy_root.resolve()), "source_manifest": "source-raster-manifest.json", "source_timestamp_note": "The source manifest timestamp is preserved, not independently verified against an external clock.", "processing_script": "Original pipeline/prepare_rasters.py; new import scripts/import-baseline.py", "nasa_product": False},
        "grid": {"width": 854, "height": 998, "crs": "EPSG:3857", "pixelSizeMeters": [30, 30], "transform": [30, 0, 13461866.021630574, 0, -30, 1661556.429169403], "noData": "NaN", "dataType": "float32", "rasterType": "PixelIsArea", "image_coordinates": old_manifest["image_coordinates"]},
        "scenes": old_manifest["scenes"], "files": records,
        "processing": ["Original radar assets are gamma-naught power; the existing import bilinearly resampled linear power before converting with 10*log10(power).", "The bundled baseline/post TIFFs already contain dB: do not apply another logarithm.", "DSM was mosaicked/resampled onto the same projected grid. Elevations include structures and vegetation.", "30m refers to projected grid spacing; ground spacing varies with latitude."],
        "licenses": {"radar": {"license": "CC-BY-4.0 plus underlying Copernicus Sentinel notice", "license_url": "https://creativecommons.org/licenses/by/4.0/", "attribution": "Contains modified Copernicus Sentinel data 2024. RTC processing by Catalyst; hosted/licensed by Microsoft Planetary Computer."}, "dsm": {"license": "Copernicus WorldDEM-30 public GLO-30-F license", "license_url": LICENSES["copernicus-dem-licenses.pdf"], "notice": "../NOTICE.txt"}},
        "limitations": old_manifest["limitations"] + ["No NISAR/OPERA science raster, measured vertical-velocity field, water level, or verified safe route is introduced by this import."]
    })
    session_bytes = args.session.read_bytes()
    samples = json.loads(session_bytes)["transect"]
    if len(samples) != 59 or samples[0]["distance_m"] != 0 or samples[-1]["distance_m"] != 1723.57:
        raise ValueError("Unexpected reference transect")
    save_json(ROOT / "data" / "transect" / "reference.json", {
        "schema_version": 1, "id": "marikina-reference-59", "sample_count": 59,
        "start": [121.083, 14.651], "end": [121.099, 14.651], "distance_m": 1723.56707152871,
        "units": {"coordinates": "EPSG:4326 longitude,latitude", "dsm_m": "m EGM2008", "distance_m": "geodesic metres", "radar": "gamma-naught dB"},
        "provenance": {"status": "reused actual sampled data; no synthetic profile", "source_artifact": args.session.name, "source_artifact_sha256": digest(session_bytes), "source_dem_sha256": old_hashes["dem.tif"], "source_grid": "../sentinel-1/manifest.json", "method": "Nearest raster cell at 59 geodesically spaced positions; original API rounded elevations to 0.001m and distances to 0.01m for serialization, not accuracy.", **time_evidence},
        "samples": samples,
        "limitations": ["Copernicus GLO-30 DSM includes buildings and vegetation; this is not a surveyed bare-earth or river-bed profile.", "Subsidence rate and elapsed years are scenario inputs; no measured velocity grid or unique pixel acquisition epoch is known.", "Underlying samples retain the Sentinel and Copernicus licenses in data/NOTICE.txt."]
    })
    print(json.dumps({"status": "imported", "files": records, "samples": len(samples), **time_evidence}))


if __name__ == "__main__":
    main()
