# NISAR catalog and browse reference bundle

This bundle contains two real NASA ASF DAAC catalog records and their unchanged provider browse PNGs for a region that includes Marikina, Philippines. It contains **no science HDF5 raster pixels**, quantitative backscatter extraction, flood classification, subsidence estimate, or routing result.

| Acquisition (UTC) | CMR concept | Product |
| --- | --- | --- |
| 21 October 2026, 21:30:32 | [G4404197169-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4404197169-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |
| 2 November 2026, 21:30:32 | [G4408731464-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4408731464-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |

The acquisitions are exactly 12 days apart and share ascending track 140, frame 009, processing release P05036, and HH/HV polarizations. Frequency A (40 MHz) and B (5 MHz) are L-SAR subbands. They are not L-band and S-band images. These 2026 observations are separate from the July 2024 Carina case study.

The catalog footprints differ. The original reference manifest records the evidence available at its import: it did not include pixel georeferencing or a paired analysis. The later `comparison/` bundle retrieves each PNG's explicitly linked provider KML and establishes their shared image grid. This supports the geographically aligned display-code comparison described below. It does not establish calibrated radar change or independent geolocation accuracy. The provider's VALIDATED maturity label applies to its product release, not to any K-SAR interpretation. Catalog footprints do not guarantee valid science pixels.

## Files and reproduction

- `raw/` retains the exact CMR UMM JSON response bytes for both granules and their collection.
- `browse/` contains original provider `_LATLON.png` images, renamed locally by acquisition date.
- `footprints.geojson` derives polygon coordinates directly from CMR, using GeoJSON longitude–latitude order and counterclockwise exterior rings.
- `manifest.json` records source URLs, original filenames, SHA-256 hashes, byte lengths, PNG dimensions, provider MD5 checks, acquisition metadata and limitations.

Run from the repository root with Python 3.10 or later; no third-party package or Earthdata credential is needed:

```sh
python scripts/import-nisar.py
python scripts/import-nisar.py --verify
python -B -m unittest discover -s tests -p "test_nisar_import.py"
```

The importer downloads only the two pinned CMR granule concepts, their collection record and their explicitly linked browse PNGs. It binds each PNG to the archive entry with the exact same filename, verifies the provider's MD5 and length, checks PNG chunk integrity, and calculates SHA-256. It will not substitute the much larger science HDF5 file or its checksum. Reimporting may change catalog metadata or retrieval timestamps; retained hashes describe the exact downloaded bytes. Local offline verification performs no network requests.

The importer also checks exact product identities, collection version and configuration. Both catalog polygons are convex and contain the entire study bounding box, longitude 121.04–121.15° E and latitude 14.50–14.75° N. Containment is verified against every oriented polygon edge, not inferred merely from a catalog search hit. This verifies catalog coverage only; valid science-pixel coverage remains untested.

The initial import's fresh CMR HTTP Date headers report **14 November 2026, 03:38 UTC**. The workstation clock was approximately eight hours behind. Each download retains both the provider's HTTP Date and the observed host UTC time, the calculated skew, and the explicitly server-derived `retrievedAt`. If a browse CDN response is cached, the importer derives retrieval time from the fresh CMR response clock plus monotonic elapsed time. It never changes the system clock. Temporary CDN redirect query strings are omitted; stable source URLs remain recorded.

## Source and attribution

NASA–ISRO NISAR mission; L-SAR products processed by NASA Jet Propulsion Laboratory and distributed by NASA Alaska Satellite Facility Distributed Active Archive Center. Source data is not relicensed as original K-SAR code. The project is not endorsed by NASA, ISRO or ASF.

The retained [collection record C3622241360-ASF](https://cmr.earthdata.nasa.gov/search/concepts/C3622241360-ASF.umm_json) declares `FreeAndOpenData: true`, identifies collection DOI [10.5067/NIL2GCOV-V1](https://doi.org/10.5067/NIL2GCOV-V1), and links [NASA ESDIS Data Use and Citation Guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance). Its own retrieval time and hash are recorded separately from the original granule/image import.

- [NISAR GCOV product documentation](https://nisar-docs.asf.alaska.edu/gcov/)
- [Available data and product maturity](https://nisar-docs.asf.alaska.edu/availability-overview/)
- [Data access, authentication and scientific subsetting](https://nisar-docs.asf.alaska.edu/access-overview/)

Quantitative analysis requires authenticated science-data access, quality-mask inspection, appropriate alignment and a separately documented method. This reference bundle establishes traceable discovery and inspection, not completion of that analysis or competition eligibility.

## Aligned display comparison

`comparison/manifest.json` records a derived comparison of the same two original browse PNGs. Each retained `comparison/raw/*_LATLON.kml` is selected by its exact filename in the pinned CMR record and verified against the provider's size and MD5. Its GroundOverlay names the exact source PNG. Both KMLs specify the same axis-aligned EPSG:4326 image-edge rectangle; the catalog polygons are used only to restrict coverage, never to invent PNG corner positions.

The source images contain 1,990 by 1,960 pixels spanning roughly three degrees. Their browse sampling is approximately 172 m near Marikina, distinct from the finer GCOV science raster. Nearest-neighbor sampling at the centers of a 200 m projected EPSG:3857 grid produces 62 by 145 cells. The requested area is 121.04–121.15 degrees east, 14.50–14.75 degrees north. The snapped grid extent, coordinate convention and all input/output SHA-256 identities are in the derived manifest.

The common mask retains 8,784 cells. Each cell must lie inside the requested area and both catalog polygons, and all three source color channels must be nonzero and opaque for both dates. Zero is reserved for invalid values by the published QA renderer. This mask describes usable browse coverage, not the HDF5 science quality flags for layover, shadow or other limitations. Both aligned RGBA PNGs use exactly this common mask.

`difference.i16` contains signed little-endian 16-bit values, in row-major north-to-south order, with -32768 outside the common mask. For each date, the display brightness code is `floor((2126*R + 7152*G + 722*B + 5000)/10000)`. The difference is 2 November minus 21 October. This integer half-up calculation is shared with the browser. The PNG difference layer uses a fixed -64 to +64 DN color scale. Full histograms for red, green, blue and weighted display brightness retain all 511 possible signed differences, including zero.

These are differences of rendered display codes. They are not calibrated gamma-naught, dB, physical luminance, floodwater or a confirmed surface-change measurement. The published NISAR QA renderer applies image correction and independently normalizes arrays to codes 1–255. Its per-product clipping/gamma parameters and science HDF5 files require Earthdata authentication and were not retrieved. The comparison must therefore retain this radiometric limitation even where the image-grid alignment is exact.

No image-derived geometric correction is applied. A diagnostic search of shifts within two output cells finds its highest texture correlation at zero shift (about 0.99757), but this is not independent ground-control validation or a positional accuracy estimate. The provider KML and exact pixel mapping support a common grid; the physical accuracy of the observations remains unverified here.

Reproduce offline with Python, NumPy and Pillow:

```sh
python scripts/build-nisar-comparison.py
python -B -m unittest discover -s tests -p "test_nisar_comparison.py"
```

Use `--fetch` to refresh only the two explicitly linked public KMLs. The importer never downloads science HDF5 pixels or accesses credentials. `comparison/access-checks.json` records anonymous full-file and Harmony subset requests that stopped at Earthdata OAuth redirects. The original reference manifest and all original source files remain unchanged.
