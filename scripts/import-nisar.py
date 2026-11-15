"""Import public NISAR catalog records and provider browse PNGs, never science rasters.

Run: python scripts/import-nisar.py
Verify the retained bundle without network access: python scripts/import-nisar.py --verify
Only Python's standard library is required. No credentials are read or stored.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
import math
from pathlib import Path
import struct
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import zlib


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "nasa" / "nisar"
EXPECTED_GRANULES = {
    "G4404197169-ASF": "NISAR_L2_PR_GCOV_033_140_A_009_4005_DHDH_A_20261021T213032_20261021T213106_P05036_N_F_J_001",
    "G4408731464-ASF": "NISAR_L2_PR_GCOV_034_140_A_009_4005_DHDH_A_20261102T213032_20261102T213106_P05036_N_F_J_001",
}
CONCEPT_IDS = tuple(EXPECTED_GRANULES)
COLLECTION = "NISAR_L2_GCOV_V1"
COLLECTION_ID = "C3622241360-ASF"
DISCOVERY_BOUNDS = [121.04, 14.5, 121.15, 14.75]
CMR_BASE = "https://cmr.earthdata.nasa.gov/search/concepts/"
LIMITATIONS = [
    "Catalog metadata and provider browse images only; science HDF5 pixels were not downloaded or analyzed.",
    "These observations are from October and November 2026. They do not observe the July 2024 Carina event.",
    "The pair shares a track and frame, but the browse images are not pixel-co-registered; their footprints differ.",
    "Browse colors are provider-rendered visualizations, not quantitative backscatter values or flood classifications.",
    "A footprint describes catalog coverage, not a guarantee of valid science pixels at every point.",
    "VALIDATED is the provider's product maturity label; it does not validate any K-SAR flood or routing result.",
    "Frequency A and B are L-SAR subbands, not separate L-band and S-band instruments.",
]


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, max_bytes: int) -> tuple[bytes, dict]:
    require(urlparse(url).scheme == "https", "Only HTTPS downloads are permitted")
    request = Request(url, headers={
        "User-Agent": "K-SAR-2026-reference-importer/1.0",
        "Cache-Control": "no-cache",
        "Accept-Encoding": "identity",
    })
    with urlopen(request, timeout=60) as response:
        require(urlparse(response.url).scheme == "https", "Redirect must retain HTTPS")
        host_time = datetime.now(timezone.utc)
        date_header = response.headers.get("Date")
        require(bool(date_header), "Provider did not supply an HTTP Date header")
        provider_time = parsedate_to_datetime(date_header).astimezone(timezone.utc)
        content_length = response.headers.get("Content-Length")
        if content_length is not None:
            require(int(content_length) <= max_bytes, "Download exceeds the size limit")
        data = response.read(max_bytes + 1)
        require(len(data) <= max_bytes, "Download exceeds the size limit")
        require(response.status == 200, "Expected a complete HTTP 200 response")
        if content_length is not None:
            require(len(data) == int(content_length), "Incomplete response body")
        return data, {
            "sourceUrl": url,
            "resolvedUrl": urlparse(response.url)._replace(query="", fragment="").geturl(),
            "httpStatus": response.status,
            "httpDate": date_header,
            "httpAgeSeconds": int(response.headers.get("Age", "0")),
            "retrievedAt": iso(provider_time),
            "retrievedAtBasis": "http-response-date",
            "hostRecordedAt": iso(host_time),
            "clockSkewSeconds": round((provider_time - host_time).total_seconds()),
            "bytes": len(data),
            "sha256": sha256(data),
        }


def normalize_geometry(metadata: dict) -> dict:
    polygons = metadata["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"]
    coordinates = []
    for polygon in polygons:
        require(not polygon.get("ExclusiveZone"), "Footprints with exclusion holes need explicit handling")
        ring = [[p["Longitude"], p["Latitude"]] for p in polygon["Boundary"]["Points"]]
        require(len(ring) >= 4, "A footprint needs at least four vertices")
        for lon, lat in ring:
            require(math.isfinite(lon) and math.isfinite(lat), "Invalid footprint coordinate")
            require(-180 <= lon <= 180 and -90 <= lat <= 90, "Footprint coordinate out of range")
        if ring[-1] != ring[0]:
            ring.append(ring[0][:])
        # GeoJSON exterior rings have counterclockwise winding.
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:]))
        require(area != 0, "Degenerate footprint")
        if area < 0:
            ring.reverse()
        coordinates.append([ring])
    require(bool(coordinates), "Missing footprint")
    if len(coordinates) == 1:
        return {"type": "Polygon", "coordinates": coordinates[0]}
    return {"type": "MultiPolygon", "coordinates": coordinates}


def verify_aoi_containment(geometry: dict, bounds: list[float]) -> None:
    """Prove bbox containment for these simple convex footprints; fail for other shapes."""
    require(geometry["type"] == "Polygon" and len(geometry["coordinates"]) == 1,
            "AOI containment requires one footprint exterior without holes")
    ring = geometry["coordinates"][0]
    west, south, east, north = bounds
    corners = [(west, south), (east, south), (east, north), (west, north)]
    for a, b in zip(ring, ring[1:]):
        def side(point: list[float] | tuple[float, float]) -> float:
            return (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])
        require(all(side(point) >= -1e-10 for point in ring), "Expected a convex counterclockwise footprint")
        require(all(side(point) >= -1e-10 for point in corners), "Footprint does not contain the full study AOI")


def browse_archive_entry(metadata: dict) -> tuple[dict, str]:
    filename = metadata["GranuleUR"] + "_LATLON.png"
    entries = [item for item in metadata["DataGranule"]["ArchiveAndDistributionInformation"]
               if item["Name"] == filename]
    require(len(entries) == 1, "Expected one archive entry for the exact browse PNG filename")
    entry = entries[0]
    require(entry["Format"] == "PNG", "Browse archive entry must be PNG, not HDF5")
    require(entry["Checksum"]["Algorithm"].upper() == "MD5", "Expected provider MD5")
    urls = [item["URL"] for item in metadata["RelatedUrls"]
            if item.get("Type") == "GET RELATED VISUALIZATION"
            and item.get("URL", "").startswith("https://")
            and Path(urlparse(item["URL"]).path).name == filename]
    require(len(urls) == 1, "Expected one HTTPS URL for the exact browse PNG filename")
    require(urlparse(urls[0]).hostname == "nisar.asf.earthdatacloud.nasa.gov", "Unexpected browse host")
    return entry, urls[0]


def validate_png(data: bytes, archive: dict) -> tuple[int, int]:
    require(len(data) == archive["SizeInBytes"], "Browse PNG size differs from provider metadata")
    require(hashlib.md5(data).hexdigest() == archive["Checksum"]["Value"].lower(),
            "Browse PNG MD5 differs from its own provider archive entry")
    require(data.startswith(b"\x89PNG\r\n\x1a\n"), "Response is not a PNG")
    offset, dimensions, ended = 8, None, False
    while offset < len(data):
        require(offset + 12 <= len(data), "Truncated PNG chunk")
        length, kind = struct.unpack(">I4s", data[offset:offset + 8])
        end = offset + 12 + length
        require(end <= len(data), "Truncated PNG payload")
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack(">I", data[offset + 8 + length:end])[0]
        require(zlib.crc32(kind + payload) & 0xFFFFFFFF == crc, "PNG CRC mismatch")
        if offset == 8:
            require(kind == b"IHDR" and length == 13, "Missing PNG IHDR")
            dimensions = struct.unpack(">II", payload[:8])
            require(all(0 < value <= 100000 for value in dimensions), "Invalid PNG dimensions")
        if kind == b"IEND":
            require(length == 0 and end == len(data), "Invalid PNG end")
            ended = True
        offset = end
    require(ended and dimensions is not None, "Incomplete PNG")
    return dimensions


def normalize_record(concept_id: str, metadata: dict) -> dict:
    require(metadata["GranuleUR"] == EXPECTED_GRANULES[concept_id], "Pinned granule identity differs")
    require(metadata["CollectionReference"]["ShortName"] == COLLECTION, "Unexpected NISAR collection")
    require(metadata["CollectionReference"]["Version"] == "1", "Unexpected collection version")
    attributes = {item["Name"]: item["Values"] for item in metadata["AdditionalAttributes"]}
    identifiers = metadata["DataGranule"]["Identifiers"]
    crid = next(item["Identifier"] for item in identifiers if item["IdentifierType"] == "CRID")
    require(attributes["PRODUCT_TYPE"] == ["GCOV"], "Expected GCOV metadata")
    require(attributes["STACK_ID"] == ["140_A_009"], "Unexpected track/frame stack")
    for key, value in (("TRACK_NUMBER", ["140"]), ("FRAME_NUMBER", ["9"]),
                       ("ASCENDING_DESCENDING", ["ASCENDING"]),
                       ("FREQUENCY_A_POLARIZATION", ["HH", "HV"]),
                       ("FREQUENCY_B_POLARIZATION", ["HH", "HV"]),
                       ("FREQUENCY_A_RANGE_BANDWIDTH", ["40"]),
                       ("FREQUENCY_B_RANGE_BANDWIDTH", ["5"])):
        require(attributes[key] == value, f"Pinned observation configuration differs: {key}")
    require(crid == "P05036", "Unexpected processing release")
    platform = metadata["Platforms"][0]
    require(platform["ShortName"] == "NISAR" and platform["Instruments"][0]["ShortName"] == "L-SAR",
            "Expected NISAR L-SAR metadata")
    dates = metadata["TemporalExtent"]["RangeDateTime"]
    start_token, end_token = metadata["GranuleUR"].split("_")[11:13]
    require(parse_iso(dates["BeginningDateTime"]).strftime("%Y%m%dT%H%M%S") == start_token,
            "Acquisition start differs from pinned product name")
    require(parse_iso(dates["EndingDateTime"]).strftime("%Y%m%dT%H%M%S") == end_token,
            "Acquisition end differs from pinned product name")
    return {
        "conceptId": concept_id,
        "granuleUr": metadata["GranuleUR"],
        "acquisitionStart": dates["BeginningDateTime"],
        "acquisitionEnd": dates["EndingDateTime"],
        "track": int(attributes["TRACK_NUMBER"][0]),
        "frame": int(attributes["FRAME_NUMBER"][0]),
        "direction": attributes["ASCENDING_DESCENDING"][0],
        "stackId": attributes["STACK_ID"][0],
        "instrument": "L-SAR",
        "maturity": "VALIDATED",
        "crid": crid,
        "polarizations": {band: attributes[f"FREQUENCY_{band}_POLARIZATION"] for band in ("A", "B")},
        "rangeBandwidthMHz": {band: float(attributes[f"FREQUENCY_{band}_RANGE_BANDWIDTH"][0]) for band in ("A", "B")},
        "footprintId": concept_id,
    }


def check_pair(records: list[dict]) -> float:
    require(tuple(item["conceptId"] for item in records) == CONCEPT_IDS, "Unexpected reference pair")
    first, second = records
    for key in ("stackId", "track", "frame", "direction", "crid", "polarizations", "rangeBandwidthMHz"):
        require(first[key] == second[key], f"Pair mismatch: {key}")
    days = (parse_iso(second["acquisitionStart"]) - parse_iso(first["acquisitionStart"])).total_seconds() / 86400
    require(days == 12, "The selected acquisitions must be 12 days apart")
    return days


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, suffix=".tmp") as handle:
        temporary = Path(handle.name)
        handle.write(data)
    temporary.replace(path)


def import_bundle(output: Path) -> dict:
    files: dict[str, bytes] = {}
    records, features = [], []
    collection_raw, collection_retrieval = fetch(CMR_BASE + COLLECTION_ID + ".umm_json", 1024 * 1024)
    collection = json.loads(collection_raw)
    require(collection["ShortName"] == COLLECTION and collection["Version"] == "1", "Unexpected collection record")
    require(collection["UseConstraints"]["FreeAndOpenData"] is True, "Collection no longer declares free/open data")
    collection_path = f"raw/{COLLECTION_ID}.umm.json"
    files[collection_path] = collection_raw
    anchor_time, anchor_monotonic = None, None
    for concept_id in CONCEPT_IDS:
        raw, retrieval = fetch(CMR_BASE + concept_id + ".umm_json", 1024 * 1024)
        require(retrieval["httpAgeSeconds"] == 0, "CMR clock anchor must not be a cached response")
        if anchor_time is None:
            anchor_time, anchor_monotonic = parse_iso(retrieval["retrievedAt"]), time.monotonic()
        else:
            elapsed = time.monotonic() - anchor_monotonic
            require(abs((parse_iso(retrieval["retrievedAt"]) - anchor_time).total_seconds() - elapsed) < 30,
                    "CMR response clock changed unexpectedly during import")
        metadata = json.loads(raw)
        record = normalize_record(concept_id, metadata)
        raw_path = f"raw/{concept_id}.umm.json"
        files[raw_path] = raw
        record["metadata"] = {"path": raw_path, **retrieval}
        archive, browse_url = browse_archive_entry(metadata)
        png, browse_retrieval = fetch(browse_url, 16 * 1024 * 1024)
        width, height = validate_png(png, archive)
        # CDN Date can describe cached delivery. Anchor retrieval to the fresh CMR clock.
        if browse_retrieval["httpAgeSeconds"] or abs(
                (parse_iso(browse_retrieval["retrievedAt"]) - anchor_time).total_seconds()
                - (time.monotonic() - anchor_monotonic)) >= 30:
            estimated = anchor_time + timedelta(seconds=time.monotonic() - anchor_monotonic)
            browse_retrieval["retrievedAt"] = iso(estimated)
            browse_retrieval["retrievedAtBasis"] = "fresh-cmr-http-date-plus-monotonic-elapsed"
            browse_retrieval["responseDateClockSkewSeconds"] = browse_retrieval["clockSkewSeconds"]
            browse_retrieval["clockSkewSeconds"] = round(
                (estimated - parse_iso(browse_retrieval["hostRecordedAt"])).total_seconds())
        browse_path = f"browse/{record['acquisitionStart'][:10]}.png"
        files[browse_path] = png
        record["browse"] = {
            "path": browse_path, **browse_retrieval,
            "providerFilename": archive["Name"],
            "providerChecksumAlgorithm": "MD5",
            "md5": archive["Checksum"]["Value"].lower(),
            "providerMd5Verified": True,
            "width": width, "height": height,
        }
        records.append(record)
        geometry = normalize_geometry(metadata)
        verify_aoi_containment(geometry, DISCOVERY_BOUNDS)
        features.append({
            "type": "Feature", "id": concept_id,
            "properties": {"conceptId": concept_id, "acquisitionStart": record["acquisitionStart"],
                           "sourceUrl": retrieval["sourceUrl"], "scope": "catalog-footprint"},
            "geometry": geometry,
        })
    interval = check_pair(records)
    footprint_bytes = json_bytes({"type": "FeatureCollection", "features": features})
    files["footprints.geojson"] = footprint_bytes
    manifest = {
        "schemaVersion": 1,
        "title": "NISAR catalog and browse references over the Marikina region",
        "scope": "catalog-and-browse-reference",
        "scienceRasterDownloaded": False,
        "quantitativeAnalysisPerformed": False,
        "coRegistered": False,
        "attribution": "NASA–ISRO NISAR mission; L-SAR products processed by NASA JPL and distributed by NASA ASF DAAC.",
        "collection": {"shortName": COLLECTION, "version": "1", "conceptId": COLLECTION_ID,
                       "doi": collection["DOI"]["DOI"], "freeAndOpenData": True,
                       "dataUseGuidanceUrl": collection["UseConstraints"]["LicenseURL"]["Linkage"],
                       "metadata": {"path": collection_path, **collection_retrieval}},
        "discoveryBounds": DISCOVERY_BOUNDS,
        "discoveryBoundsCrs": "EPSG:4326",
        "intervalDays": interval,
        "limitations": LIMITATIONS,
        "clockNote": f"CMR minus host clock was approximately {records[0]['metadata']['clockSkewSeconds'] / 3600:.2f} hours at import. RetrievedAt uses a fresh HTTPS response Date, or that clock plus elapsed monotonic time. Host and response times are retained separately; the workstation clock was not changed.",
        "sourceDocumentation": [
            "https://nisar-docs.asf.alaska.edu/gcov/",
            "https://nisar-docs.asf.alaska.edu/availability-overview/",
            "https://nisar-docs.asf.alaska.edu/access-overview/",
        ],
        "footprints": {"path": "footprints.geojson", "sha256": sha256(footprint_bytes), "bytes": len(footprint_bytes)},
        "records": records,
    }
    for path, data in files.items():
        write_atomic(output / path, data)
    # The manifest is the last file published, after all bytes pass validation.
    write_atomic(output / "manifest.json", json_bytes(manifest))
    return verify_bundle(output)


def verify_bundle(output: Path) -> dict:
    manifest = json.loads((output / "manifest.json").read_bytes())
    if manifest["scope"] == "calibrated-science-subsets-and-browse-reference":
        require(manifest["scienceRasterDownloaded"] is True and manifest["quantitativeAnalysisPerformed"] is True,
                "Science subset evidence flags differ")
        science_file = manifest["science"]
        science_path = (output / science_file["path"]).resolve()
        require(science_path.is_relative_to(output.resolve()), "Science manifest path escapes output directory")
        science_bytes = science_path.read_bytes()
        require(len(science_bytes) == science_file["bytes"] and sha256(science_bytes) == science_file["sha256"],
                "Science manifest integrity failed")
        require(manifest["wholeScienceFilesDownloaded"] is False and science_file["wholeFileChecksumsLocallyVerified"] is False,
                "Partial extraction must not claim complete HDF5 verification")
    else:
        require(manifest["scope"] == "catalog-and-browse-reference", "Incorrect evidence scope")
        require(manifest["scienceRasterDownloaded"] is False and manifest["quantitativeAnalysisPerformed"] is False,
                "Reference bundle must not claim science-pixel analysis")
    require(manifest["coRegistered"] is False, "Independent registration accuracy must not be asserted")
    require(manifest["discoveryBounds"] == DISCOVERY_BOUNDS, "Unexpected study AOI")
    collection_record = manifest["collection"]["metadata"]
    require(collection_record["path"] == f"raw/{COLLECTION_ID}.umm.json", "Unexpected collection file path")
    collection_bytes = (output / collection_record["path"]).read_bytes()
    require(len(collection_bytes) == collection_record["bytes"] and sha256(collection_bytes) == collection_record["sha256"],
            "Collection metadata integrity failed")
    collection = json.loads(collection_bytes)
    require(collection["ShortName"] == COLLECTION and collection["Version"] == "1", "Unexpected retained collection")
    require(collection["UseConstraints"]["FreeAndOpenData"] is True and manifest["collection"]["freeAndOpenData"] is True,
            "Collection free/open declaration differs")
    require(manifest["collection"]["doi"] == collection["DOI"]["DOI"], "Collection DOI differs")
    normalized = []
    expected_features = []
    for record in manifest["records"]:
        for key in ("metadata", "browse"):
            item = record[key]
            path = (output / item["path"]).resolve()
            require(path.is_relative_to(output.resolve()), "Bundle path escapes output directory")
            data = path.read_bytes()
            require(len(data) == item["bytes"] and sha256(data) == item["sha256"], f"File integrity failed: {key}")
        raw = json.loads((output / record["metadata"]["path"]).read_bytes())
        require(record["metadata"]["sourceUrl"] == CMR_BASE + record["conceptId"] + ".umm_json", "Unexpected CMR source URL")
        normalized_record = normalize_record(record["conceptId"], raw)
        require(all(record[key] == value for key, value in normalized_record.items()), "Normalized metadata differs from raw CMR")
        normalized.append(normalized_record)
        archive, url = browse_archive_entry(raw)
        require(record["browse"]["sourceUrl"] == url, "Browse URL differs from raw CMR")
        require(record["browse"]["providerFilename"] == archive["Name"], "Browse provider filename differs")
        require(record["browse"]["md5"] == archive["Checksum"]["Value"].lower(), "Manifest provider MD5 differs")
        require(record["browse"]["providerChecksumAlgorithm"] == "MD5" and record["browse"]["providerMd5Verified"] is True,
                "Manifest checksum status differs")
        dimensions = validate_png((output / record["browse"]["path"]).read_bytes(), archive)
        require(dimensions == (record["browse"]["width"], record["browse"]["height"]), "PNG dimensions differ")
        geometry = normalize_geometry(raw)
        verify_aoi_containment(geometry, DISCOVERY_BOUNDS)
        expected_features.append(geometry)
    require(check_pair(normalized) == manifest["intervalDays"], "Manifest interval differs")
    geometry_bytes = (output / "footprints.geojson").read_bytes()
    require(sha256(geometry_bytes) == manifest["footprints"]["sha256"], "Footprint SHA-256 differs")
    require(len(geometry_bytes) == manifest["footprints"]["bytes"], "Footprint byte length differs")
    features = json.loads(geometry_bytes)["features"]
    require(len(features) == 2, "Expected two footprints")
    require(tuple(f["id"] for f in features) == CONCEPT_IDS, "Footprint identifiers differ")
    for feature, record in zip(features, normalized):
        require(feature["properties"]["conceptId"] == record["conceptId"]
                and feature["properties"]["acquisitionStart"] == record["acquisitionStart"], "Footprint provenance differs")
    require([f["geometry"] for f in features] == expected_features, "Footprints differ from raw CMR coordinates")
    return {"status": "verified", "records": len(normalized), "intervalDays": manifest["intervalDays"],
            "providerPngMd5Verified": True, "sha256Verified": True,
            "verificationScope": "Retained catalog, browse and linked science manifest identities; science array validation is separate"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--verify", action="store_true", help="Verify retained files without network access")
    args = parser.parse_args()
    result = verify_bundle(args.output) if args.verify else import_bundle(args.output)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
