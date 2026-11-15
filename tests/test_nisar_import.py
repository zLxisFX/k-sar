"""Offline integrity and evidence-boundary checks for the retained NASA references."""

import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nisar_import", ROOT / "scripts" / "import-nisar.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)
DATA = ROOT / "data" / "nasa" / "nisar"


class NisarReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / "manifest.json").read_bytes())
        cls.record = cls.manifest["records"][0]
        cls.raw = json.loads((DATA / cls.record["metadata"]["path"]).read_bytes())
        cls.png = (DATA / cls.record["browse"]["path"]).read_bytes()

    def test_retained_bundle_matches_cmr_and_provider_checksums(self):
        self.assertEqual(importer.verify_bundle(DATA)["status"], "verified")

    def test_image_checksum_is_selected_by_exact_filename_not_first_archive_entry(self):
        archive, url = importer.browse_archive_entry(self.raw)
        self.assertTrue(self.raw["DataGranule"]["ArchiveAndDistributionInformation"][0]["Name"].endswith(".h5"))
        self.assertTrue(archive["Name"].endswith("_LATLON.png"))
        self.assertTrue(url.endswith(archive["Name"]))
        self.assertEqual(importer.validate_png(self.png, archive), (1990, 1960))

    def test_corrupted_image_is_rejected(self):
        archive, _ = importer.browse_archive_entry(self.raw)
        corrupted = bytearray(self.png)
        corrupted[100] ^= 1
        with self.assertRaisesRegex(ValueError, "MD5"):
            importer.validate_png(bytes(corrupted), archive)

    def test_science_hdf5_checksum_cannot_validate_a_browse_png(self):
        wrong_archive = self.raw["DataGranule"]["ArchiveAndDistributionInformation"][0]
        with self.assertRaisesRegex(ValueError, "size"):
            importer.validate_png(self.png, wrong_archive)

    def test_geojson_uses_longitude_latitude_and_retains_closed_footprint(self):
        ring = importer.normalize_geometry(self.raw)["coordinates"][0]
        original = self.raw["SpatialExtent"]["HorizontalSpatialDomain"]["Geometry"]["GPolygons"][0]["Boundary"]["Points"]
        self.assertEqual(ring[0], ring[-1])
        self.assertEqual({tuple(point) for point in ring}, {(point["Longitude"], point["Latitude"]) for point in original})
        self.assertTrue(all(118 < lon < 122 and 13 < lat < 17 for lon, lat in ring))

    def test_pair_rejects_different_geometry_configuration(self):
        records = copy.deepcopy(self.manifest["records"])
        records[1]["track"] = 39
        with self.assertRaisesRegex(ValueError, "track"):
            importer.check_pair(records)

    def test_pair_rejects_wrong_date_interval(self):
        records = copy.deepcopy(self.manifest["records"])
        records[1]["acquisitionStart"] = "2026-11-03T21:30:32Z"
        with self.assertRaisesRegex(ValueError, "12 days"):
            importer.check_pair(records)

    def test_pinned_metadata_rejects_another_product(self):
        wrong = copy.deepcopy(self.raw)
        wrong["GranuleUR"] = wrong["GranuleUR"].replace("20261021", "20261022")
        with self.assertRaisesRegex(ValueError, "Pinned granule identity"):
            importer.normalize_record(self.record["conceptId"], wrong)

    def test_both_footprints_contain_the_entire_study_aoi(self):
        for feature in json.loads((DATA / "footprints.geojson").read_bytes())["features"]:
            importer.verify_aoi_containment(feature["geometry"], self.manifest["discoveryBounds"])
            with self.assertRaisesRegex(ValueError, "full study AOI"):
                importer.verify_aoi_containment(feature["geometry"], [125, 14.5, 126, 14.75])

    def test_retained_json_has_no_credentials_or_signed_download_parameters(self):
        credential = re.compile(
            r"Bearer\s+[A-Za-z0-9._~+/-]+|(?:Authorization|Cookie|Set-Cookie)\s*[:=]|"
            r"(?:Signature|X-Amz-Credential|X-Amz-Security-Token|access_token|refresh_token|client_secret|password)=",
            re.IGNORECASE,
        )
        for path in DATA.rglob("*.json"):
            self.assertIsNone(credential.search(path.read_text(encoding="utf-8")), str(path))

    def test_differing_footprints_and_science_subset_scope_are_explicit(self):
        geometries = json.loads((DATA / "footprints.geojson").read_bytes())["features"]
        self.assertNotEqual(geometries[0]["geometry"], geometries[1]["geometry"])
        self.assertFalse(self.manifest["coRegistered"])
        self.assertTrue(self.manifest["scienceRasterDownloaded"])
        self.assertTrue(self.manifest["quantitativeAnalysisPerformed"])
        self.assertFalse(self.manifest["wholeScienceFilesDownloaded"])
        self.assertFalse(self.manifest["science"]["wholeFileChecksumsLocallyVerified"])
        self.assertEqual(self.manifest["science"]["path"], "science/manifest.json")

    def test_server_and_skewed_host_clocks_remain_distinguishable(self):
        for record in self.manifest["records"]:
            clock = record["metadata"]
            self.assertEqual(clock["retrievedAtBasis"], "http-response-date")
            actual_skew = (importer.parse_iso(clock["retrievedAt"]) - importer.parse_iso(clock["hostRecordedAt"])).total_seconds()
            self.assertLessEqual(abs(actual_skew - clock["clockSkewSeconds"]), 1)
            self.assertNotIn("?", record["browse"]["resolvedUrl"])


if __name__ == "__main__":
    unittest.main()
