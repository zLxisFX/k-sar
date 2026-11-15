"""Physical-unit, quality-mask and retained-array checks for the GCOV subsets."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

import numpy as np
import rasterio
from affine import Affine

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nisar_science", ROOT / "scripts/extract-nisar-science.py")
science = importlib.util.module_from_spec(spec)
spec.loader.exec_module(science)
DATA = ROOT / "data/nasa/nisar"


class ScienceProcessingTests(unittest.TestCase):
    def test_masks_preserve_polarization_bits_and_reject_bad_subswaths_and_exceptions(self):
        power = np.ones(10, np.float32)
        subswath = np.array([1, 5, 0, 255, 1, 1, 1, 1, 1, 1], np.uint8)
        flags = np.array([768, 768, 768, 768, 770, 65535, 256, 512, 0, 768], np.uint16)
        power[-1] = 0
        np.testing.assert_array_equal(science.native_validity(power, subswath, flags, "HH"),
                                      [1, 1, 0, 0, 0, 0, 1, 0, 0, 0])
        np.testing.assert_array_equal(science.native_validity(power, subswath, flags, "HV"),
                                      [1, 1, 0, 0, 0, 0, 0, 1, 0, 0])

    def test_power_conversion_uses_ten_log10_and_excludes_nonpositive_values(self):
        actual = science.power_to_db(np.array([.1, 1, 10, 0, -1, np.nan, np.inf], np.float32))
        np.testing.assert_allclose(actual[:3], [-10, 0, 10], atol=1e-6)
        self.assertTrue(np.isnan(actual[3:]).all())

    def test_resampling_averages_power_before_log_and_rejects_partial_support(self):
        grid = {"width": 1, "height": 1, "crs": "EPSG:32651", "transform": [20, 0, 300000, 0, -20, 1600000]}
        power = np.array([[1, 9], [1, 9]], np.float32)
        transform = Affine(10, 0, 300000, 0, -10, 1600000)
        valid = np.ones((2, 2), bool)
        result, mask = science.average_complete_support(power, valid, transform, grid["crs"], grid)
        self.assertEqual(float(result[0, 0]), 5)
        self.assertTrue(mask[0, 0])
        self.assertAlmostEqual(float(science.power_to_db(result)[0, 0]), 10 * np.log10(5), places=6)
        valid[0, 0] = False
        result, mask = science.average_complete_support(power, valid, transform, grid["crs"], grid)
        self.assertFalse(mask[0, 0])
        self.assertTrue(np.isnan(result[0, 0]))

    def test_remote_range_refuses_credentials_unapproved_hosts_and_full_download(self):
        session = science.RangeSession(1024)
        with self.assertRaises(science.SafeAccessError):
            session.get("https://example.org/data", headers={"Range": "bytes=0-3"})
        with self.assertRaises(science.SafeAccessError):
            session.get(f"https://{science.CDN_HOST}/data", headers={"Range": "bytes=0-3", "Authorization": "synthetic"})
        response = Mock(status_code=200, headers={})
        with patch.object(science.requests.Session, "get", return_value=response):
            with self.assertRaises(science.SafeAccessError):
                session.get(f"https://{science.CDN_HOST}/data", headers={"Range": "bytes=0-3"})
        response.close.assert_called_once()
        self.assertEqual(session.bytes_read, 0)


class RetainedScienceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / "science/manifest.json").read_bytes())
        cls.arrays = {}
        for filename in ["2026-10-21-linear", "2026-11-02-linear", "2026-10-21-db", "2026-11-02-db", "2026-10-21-valid", "2026-11-02-valid", "change-db", "common-valid", "multi-frequency-valid"]:
            with rasterio.open(DATA / f"science/{filename}.tif") as source:
                cls.arrays[filename] = source.read()

    def test_all_outputs_match_manifest_and_source_checksums_are_catalog_only(self):
        for entry in self.manifest["outputs"]:
            data = (DATA / entry["path"]).read_bytes()
            self.assertEqual(len(data), entry["bytes"])
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
        expected_md5 = ["aed45ba9793094528370c13a9178dfa6", "3ad47d3ea9eaaf27263c73662e5036c9"]
        for record, md5 in zip(self.manifest["records"], expected_md5):
            source = record["source"]
            self.assertEqual(source["providerChecksum"]["Value"], md5)
            self.assertFalse(source["wholeFileChecksumLocallyVerified"])
            self.assertFalse(source["wholeFileDownloaded"])
            self.assertLess(source["httpRangeBytesRead"], source["wholeFileBytes"] / 20)
            self.assertNotIn("?", source["url"])
            self.assertEqual(record["nativeGrid"]["crs"], "EPSG:32651")

    def test_real_science_grid_and_units_match_the_retained_sentinel_grid(self):
        expected = json.loads((ROOT / "data/sentinel-1/manifest.json").read_bytes())["grid"]
        for name in ["2026-10-21-db", "2026-11-02-db", "change-db"]:
            with rasterio.open(DATA / f"science/{name}.tif") as source:
                self.assertEqual(source.shape, (998, 854))
                self.assertEqual(source.count, 2)
                self.assertEqual(source.crs.to_string(), expected["crs"])
                self.assertEqual(list(source.transform)[:6], expected["transform"])
                self.assertEqual(source.dtypes, ("float32", "float32"))
                self.assertTrue(np.isnan(source.nodata))
                self.assertTrue(source.tags(1)["units"].startswith("dB"))

    def test_actual_linear_conversion_change_and_individual_masks_agree(self):
        for date in ["2026-10-21", "2026-11-02"]:
            power = self.arrays[f"{date}-linear"]
            db = self.arrays[f"{date}-db"]
            valid = np.isfinite(power) & (power > 0)
            np.testing.assert_array_equal(valid, self.arrays[f"{date}-valid"].astype(bool))
            np.testing.assert_array_equal(db, science.power_to_db(power))
        before, after = [self.arrays[f"{date}-db"] for date in ["2026-10-21", "2026-11-02"]]
        common = np.isfinite(before) & np.isfinite(after)
        np.testing.assert_array_equal(common, self.arrays["common-valid"].astype(bool))
        delta = self.arrays["change-db"]
        np.testing.assert_array_equal(delta[common], (after - before)[common])
        self.assertTrue(np.isnan(delta[~common]).all())
        self.assertEqual(common.sum(axis=(1, 2)).tolist(), [852283, 852283])
        self.assertEqual(np.isfinite(after).sum(axis=(1, 2)).tolist(), [852287, 852287])

    def test_statistics_include_all_outliers_and_share_date_histogram_edges(self):
        for band, pol in enumerate(["HH", "HV"]):
            self.assertEqual(self.manifest["records"][0]["statistics"][pol]["histogram"]["edges"],
                             self.manifest["records"][1]["statistics"][pol]["histogram"]["edges"])
            for values, stats in [(self.arrays[f"{r['date']}-db"][band], r["statistics"][pol]) for r in self.manifest["records"]] + [(self.arrays["change-db"][band], self.manifest["change"]["statistics"][pol])]:
                finite = values[np.isfinite(values)].astype(np.float64)
                counts, _ = np.histogram(finite, stats["histogram"]["edges"])
                self.assertEqual(counts.tolist(), stats["histogram"]["counts"])
                self.assertEqual(int(counts.sum()), stats["validPixels"])
                self.assertEqual(float(finite.min()), stats["min"])
                self.assertEqual(float(finite.max()), stats["max"])
                self.assertAlmostEqual(float(np.mean(finite)), stats["mean"], places=12)

    def test_multi_frequency_uses_one_shared_mask_without_cross_sensor_change(self):
        report = json.loads((DATA / "science/multi-frequency.json").read_bytes())
        sentinel = []
        for filename in ["baseline", "post"]:
            with rasterio.open(ROOT / f"data/sentinel-1/{filename}.tif") as source:
                sentinel.append(source.read())
        arrays = [*sentinel, self.arrays["2026-10-21-db"], self.arrays["2026-11-02-db"]]
        common = np.logical_and.reduce([np.isfinite(array).all(axis=0) for array in arrays])
        np.testing.assert_array_equal(common, self.arrays["multi-frequency-valid"][0].astype(bool))
        self.assertEqual(report["validPixels"], int(common.sum()))
        self.assertEqual(len(report["rows"]), 8)
        self.assertEqual(len(report["withinPairChanges"]), 4)
        by_date = dict(zip(["2024-07-10", "2024-08-03", "2026-10-21", "2026-11-02"], arrays))
        for row in report["rows"]:
            values = by_date[row["date"]][0 if row["polarization"] in ["VV", "HH"] else 1][common].astype(np.float64)
            self.assertEqual(row["validPixels"], len(values))
            self.assertEqual(row["mean"], float(values.mean()))
            self.assertEqual(row["p05"], float(np.quantile(values, .05)))


if __name__ == "__main__":
    unittest.main()
