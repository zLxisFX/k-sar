"""Independent geometry, masking and display-code checks for the NISAR comparison."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("comparison", ROOT / "scripts/build-nisar-comparison.py")
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)
DATA = ROOT / "data/nasa/nisar"


class NisarComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((DATA / "comparison/manifest.json").read_bytes())
        cls.images = [np.array(Image.open(DATA / r["aligned"]["path"])) for r in cls.manifest["records"]]
        cls.mask = np.array(Image.open(DATA / cls.manifest["commonMask"]["path"])) == 255

    def test_exact_provider_png_binding_and_kml_order_are_required(self):
        record = self.manifest["records"][0]
        kml = (DATA / record["kml"]["path"]).read_bytes()
        bounds = comparison.parse_overlay(kml, record["granuleUr"] + "_LATLON.png")
        self.assertEqual(bounds, tuple(record["sourceGrid"]["boundsWgs84"][k] for k in ["west", "south", "east", "north"]))
        with self.assertRaisesRegex(ValueError, "exact retained PNG"):
            comparison.parse_overlay(kml, "another-date.png")
        rotated = kml.replace(b"121.69327667413428,13.313477572581052", b"121.69327667413428,13.413477572581052")
        with self.assertRaisesRegex(ValueError, "axis-aligned"):
            comparison.parse_overlay(rotated, record["granuleUr"] + "_LATLON.png")

    def test_pixel_edges_are_not_mistaken_for_centers_and_north_is_top(self):
        bounds = (0, 0, 4, 2)
        col, row, valid = comparison.source_pixels(bounds, 4, 2, np.array([.5, 3.5, 4, -.01]), np.array([1.5, .5, 1, 1]))
        self.assertEqual(col.tolist(), [0, 3, 4, -1])
        self.assertEqual(row.tolist(), [0, 1, 1, 1])
        self.assertEqual(valid.tolist(), [True, True, False, False])

    def test_integer_rounding_signed_direction_and_nodata(self):
        before = np.array([[[0, 0, 0], [255, 255, 255], [255, 0, 0]]], dtype=np.uint8)
        after = np.array([[[255, 255, 255], [0, 0, 0], [0, 255, 0]]], dtype=np.uint8)
        values = comparison.difference(before, after, np.array([[True, True, False]]))
        self.assertEqual(values.tolist(), [[255, -255, -32768]])
        self.assertEqual(comparison.brightness(before).tolist(), [[0, 255, 54]])
        self.assertEqual(comparison.brightness(after).tolist(), [[255, 0, 182]])

    def test_constant_texture_cannot_claim_a_registration_estimate(self):
        a = np.ones((6, 6), dtype=np.uint8)
        diagnostic = comparison.shifted_correlation(a, a, a.astype(bool))
        self.assertIsNone(diagnostic["bestIntegerShift"])
        self.assertIsNone(diagnostic["zeroShiftCorrelation"])

    def test_all_derived_pixels_match_original_nearest_cells_and_common_coverage(self):
        grid, lon, lat = comparison.output_grid()
        self.assertEqual(grid, self.manifest["grid"])
        footprints = json.loads((DATA / "footprints.geojson").read_bytes())
        polygons = {f["id"]: f["geometry"]["coordinates"][0] for f in footprints["features"]}
        expected_masks = []
        for record, actual in zip(self.manifest["records"], self.images):
            source = np.array(Image.open(DATA / record["sourcePng"]["path"]).convert("RGBA"))
            b = record["sourceGrid"]["boundsWgs84"]
            col, row, inside = comparison.source_pixels(tuple(b[k] for k in ["west", "south", "east", "north"]), source.shape[1], source.shape[0], lon, lat)
            pixels = source[row, col]
            expected = inside & np.all(pixels[..., :3] > 0, axis=2) & (pixels[..., 3] == 255)
            expected &= (lon >= 121.04) & (lon < 121.15) & (lat >= 14.5) & (lat < 14.75)
            expected &= comparison.in_polygon(lon, lat, polygons[record["conceptId"]])
            expected_masks.append(expected)
            np.testing.assert_array_equal(actual[self.mask, :3], pixels[self.mask, :3])
            np.testing.assert_array_equal(actual[..., 3] == 255, self.mask)
            self.assertTrue(np.all(actual[~self.mask] == 0))
        np.testing.assert_array_equal(self.mask, expected_masks[0] & expected_masks[1])
        self.assertEqual(int(self.mask.sum()), 8784)
        self.assertEqual(self.mask.shape, (145, 62))

    def test_all_signed_values_histograms_and_artifact_hashes_match(self):
        m = self.manifest
        delta = np.fromfile(DATA / m["difference"]["values"]["path"], dtype="<i2").reshape(self.mask.shape)
        np.testing.assert_array_equal(delta, comparison.difference(self.images[0][..., :3], self.images[1][..., :3], self.mask))
        self.assertTrue(np.all(delta[~self.mask] == -32768))
        expected = comparison.statistics(delta[self.mask])
        self.assertEqual(expected, m["difference"]["statistics"]["displayBrightness"])
        for channel in m["difference"]["statistics"].values():
            self.assertEqual(sum(channel["histogram"]["counts"]), 8784)
        identities = [m["commonMask"], m["difference"]["image"], m["difference"]["values"], m["sourceManifest"], m["sourceFootprints"], m["retrievals"], m["accessChecks"]]
        for r in m["records"]:
            identities.extend([r["aligned"], r["sourcePng"], r["sourceMetadata"], r["kml"]])
        for identity in identities:
            self.assertEqual(comparison.sha256(DATA / identity["path"]), identity["sha256"])
        self.assertFalse(m["radiometry"]["quantitativeBackscatterAnalysis"])
        self.assertFalse(m["registration"]["groundControlValidated"])
        self.assertEqual(m["difference"]["units"], "DN")


if __name__ == "__main__":
    unittest.main()
