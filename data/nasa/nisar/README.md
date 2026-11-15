# NISAR calibrated science and browse bundle

This bundle contains two NASA ASF DAAC catalog records, their unchanged provider browse PNGs, and calibrated HH/HV science subsets extracted from the corresponding GCOV HDF5 products. The `science/` folder contains aligned gamma-naught backscatter, within-pair change, quality masks and descriptive spatial statistics. The observations do not constitute a flood classification, subsidence measurement or validation of a routing result.

| Acquisition (UTC) | CMR concept | Product |
| --- | --- | --- |
| 21 October 2026, 21:30:32 | [G4404197169-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4404197169-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |
| 2 November 2026, 21:30:32 | [G4408731464-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4408731464-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |

The acquisitions are exactly 12 days apart and share ascending track 140, frame 009, processing release P05036, and HH/HV polarizations. Frequency A (40 MHz) and B (5 MHz) are L-SAR subbands. They are not L-band and S-band images. These 2026 observations are separate from the July 2024 Carina case study.

The catalog footprints differ. The `comparison/` bundle uses each PNG's explicitly linked provider KML to establish the shared browse image grid. It contains a geographically aligned display-code comparison, separate from the calibrated values in `science/`. The top manifest links both the original source identities and the science analysis. The provider's VALIDATED maturity label applies to its product release, not to a K-SAR interpretation. Catalog footprints alone do not guarantee valid science pixels; the science subset applies explicit native quality screening.

## Files and reproduction

- `raw/` retains the exact CMR UMM JSON response bytes for both granules and their collection.
- `browse/` contains original provider `_LATLON.png` images, renamed locally by acquisition date.
- `footprints.geojson` derives polygon coordinates directly from CMR, using GeoJSON longitude–latitude order and counterclockwise exterior rings.
- `manifest.json` records source URLs, original filenames, SHA-256 hashes, byte lengths, PNG dimensions, provider MD5 checks, acquisition metadata and limitations.

Verify the retained original references offline with Python 3.10 or later; this check requires no third-party package or Earthdata credential:

```sh
python scripts/import-nisar.py --verify
python -B -m unittest discover -s tests -p "test_nisar_import.py"
```

The original-reference importer downloads only the two pinned CMR granule concepts, their collection record and their explicitly linked browse PNGs. It binds each PNG to the archive entry with the exact same filename, verifies the provider's MD5 and length, checks PNG chunk integrity, and calculates SHA-256. It does not substitute the larger HDF5 file or its checksum. To refresh only that reference bundle, use `python scripts/import-nisar.py --output <separate-directory>`; overwriting the retained bundle would change retrieval records and its analysis links. Local offline verification performs no network requests.

The importer also checks exact product identities, collection version and configuration. Both catalog polygons are convex and contain the entire study bounding box, longitude 121.04–121.15° E and latitude 14.50–14.75° N. Containment is checked against every oriented polygon edge. The separate science masks document usable coverage over the larger retained Sentinel-1 grid.

The initial import's fresh CMR HTTP Date headers report **14 November 2026, 03:38 UTC**. The workstation clock was approximately eight hours behind. Each download retains both the provider's HTTP Date and the observed host UTC time, the calculated skew, and the explicitly server-derived `retrievedAt`. If a browse CDN response is cached, the importer derives retrieval time from the fresh CMR response clock plus monotonic elapsed time. It never changes the system clock. Temporary CDN redirect query strings are omitted; stable source URLs remain recorded.

## Source and attribution

NASA–ISRO NISAR mission; L-SAR products processed by NASA Jet Propulsion Laboratory and distributed by NASA Alaska Satellite Facility Distributed Active Archive Center. Source data is not relicensed as original K-SAR code. The project is not endorsed by NASA, ISRO or ASF.

The retained [collection record C3622241360-ASF](https://cmr.earthdata.nasa.gov/search/concepts/C3622241360-ASF.umm_json) declares `FreeAndOpenData: true`, identifies collection DOI [10.5067/NIL2GCOV-V1](https://doi.org/10.5067/NIL2GCOV-V1), and links [NASA ESDIS Data Use and Citation Guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance). Its own retrieval time and hash are recorded separately from the original granule/image import.

- [NISAR GCOV product documentation](https://nisar-docs.asf.alaska.edu/gcov/)
- [Available data and product maturity](https://nisar-docs.asf.alaska.edu/availability-overview/)
- [Data access, authentication and scientific subsetting](https://nisar-docs.asf.alaska.edu/access-overview/)

The science subset below documents authenticated range access, quality-mask inspection, alignment and physical-unit conversion. It does not establish competition eligibility.

## Calibrated GCOV science subsets

`science/manifest.json` records the source HDF5 paths, provider MD5 metadata, native dataset attributes, successful extraction transfer counts, output SHA-256 identities and full-range statistics. The complete 5,276,434,432-byte HDF5 products were not downloaded: the successful window extractions read 90,439,680 bytes and 81,264,640 bytes respectively. These figures exclude earlier metadata probes and failed attempts. Provider whole-file MD5 values are retained as catalog evidence and **were not locally verified**. Locally generated TIFFs and JSON files have independently calculated SHA-256 identities.

Both native science grids are EPSG:32651 with 10 m spacing. The real diagonal `frequencyA/HHHH` and `frequencyA/HVHV` covariance terms have dimensionless, radiometrically terrain-corrected gamma-naught linear-power units. No additional gamma-to-sigma factor, offset or scale is applied. HDF5 `_FillValue` is NaN; nonpositive and nonfinite power is excluded.

Native pixels must have `mask` in 1–5, no low-byte `inputDataExceptionMask` anomaly code, and the appropriate polarization-validity bit (256 for HH; 512 for HV). Fill 65535 is excluded. This differs from testing the entire exception value against zero: ordinary valid HH/HV pixels can have value 768. Each polarization retains its own mask. Receive-only flags are absent on these datasets; the extractor rejects an explicit true flag if encountered. No noise-equivalent backscatter subtraction or additional noise-floor, layover or shadow screen is applied.

Linear power is area-averaged onto the existing 854 × 998 EPSG:3857 grid before applying `10 log10(power)`. The native window encloses the transformed target extent with a four-pixel margin. Reprojected valid coverage must equal complete support within 1e-12; partial invalid support excludes the output cell. The 30 m projected output spacing is a resampling grid, not a claim of independent physical resolution. Provider coordinates establish consistent grids; independent ground-control registration accuracy is not established.

Each acquisition has two-band Float32 linear-power and dB TIFFs plus a two-band valid mask, ordered HH then HV. The first date retains 852,283 cells per polarization; the second retains 852,287. `change-db.tif` is 2 November minus 21 October dB, retaining 852,283 valid cells per polarization. Invalid float values remain NaN. Histograms retain every finite value, including outliers, and each polarization uses identical bin boundaries across acquisition dates.

`transect.json` contains all 59 actual cell samples from both sensors, both polarizations and each date, within-pair changes, DSM values and row/column indices. `multi-frequency.json` compares eight acquisition/polarization distributions over one common spatial mask and reports four within-pair changes. It never subtracts 2026 NISAR from 2024 Sentinel-1: wavelength, polarization and observation dates differ. Calibrated backscatter change by itself does not identify floodwater or establish a universal HH threshold.

Reproduce from the repository root with Python and the dependencies in `scripts/requirements-nisar-science.txt`:

```sh
python -m pip install -r scripts/requirements-nisar-science.txt
python scripts/extract-nisar-science.py
python scripts/build-nisar-comparison.py
node scripts/copy-public-data.mjs
python -B -m unittest discover -s tests -p "test_nisar*.py"
node --test tests/nisar-science-data.test.ts tests/nisar-science.test.ts
```

Uncached extraction requires a separately stored Earthdata credential supplied through `--token-file`; it defaults to the user's local application-data K-SAR directory. The native subset cache also stays outside the repository. Cached extraction is offline and deterministic. Authentication is sent only to the canonical NASA endpoint, never forwarded to the CDN; signed redirect URLs remain in memory and are omitted from retained metadata. The extractor refuses full-file responses and enforces bounded range sizes and a transfer budget. Source timestamps use NASA HTTPS response Date headers.

## Aligned display comparison

`comparison/manifest.json` records a derived comparison of the same two original browse PNGs. Each retained `comparison/raw/*_LATLON.kml` is selected by its exact filename in the pinned CMR record and verified against the provider's size and MD5. Its GroundOverlay names the exact source PNG. Both KMLs specify the same axis-aligned EPSG:4326 image-edge rectangle; the catalog polygons are used only to restrict coverage, never to invent PNG corner positions.

The source images contain 1,990 by 1,960 pixels spanning roughly three degrees. Their browse sampling is approximately 172 m near Marikina, distinct from the finer GCOV science raster. Nearest-neighbor sampling at the centers of a 200 m projected EPSG:3857 grid produces 62 by 145 cells. The requested area is 121.04–121.15 degrees east, 14.50–14.75 degrees north. The snapped grid extent, coordinate convention and all input/output SHA-256 identities are in the derived manifest.

The common mask retains 8,784 cells. Each cell must lie inside the requested area and both catalog polygons, and all three source color channels must be nonzero and opaque for both dates. Zero is reserved for invalid values by the published QA renderer. This mask describes usable browse coverage, not the HDF5 science quality flags for layover, shadow or other limitations. Both aligned RGBA PNGs use exactly this common mask.

`difference.i16` contains signed little-endian 16-bit values, in row-major north-to-south order, with -32768 outside the common mask. For each date, the display brightness code is `floor((2126*R + 7152*G + 722*B + 5000)/10000)`. The difference is 2 November minus 21 October. This integer half-up calculation is shared with the browser. The PNG difference layer uses a fixed -64 to +64 DN color scale. Full histograms for red, green, blue and weighted display brightness retain all 511 possible signed differences, including zero.

These are differences of rendered display codes. They are not calibrated gamma-naught, dB, physical luminance, floodwater or a confirmed surface-change measurement. The published NISAR QA renderer applies image correction and independently normalizes arrays to codes 1–255. Its per-product clipping/gamma parameters were not retrieved. The separate calibrated HDF5 extraction does not invert those display values: it reads the physical science datasets directly. The browse comparison retains its radiometric limitation even where image-grid alignment is exact.

No image-derived geometric correction is applied. A diagnostic search of shifts within two output cells finds its highest texture correlation at zero shift (about 0.99757), but this is not independent ground-control validation or a positional accuracy estimate. The provider KML and exact pixel mapping support a common grid; the physical accuracy of the observations remains unverified here.

Reproduce offline with Python, NumPy and Pillow:

```sh
python scripts/build-nisar-comparison.py
python -B -m unittest discover -s tests -p "test_nisar_comparison.py"
```

Use `--fetch` to refresh only the two explicitly linked public KMLs. The browse comparison script never downloads HDF5 pixels or accesses credentials. `comparison/access-checks.json` retains the earlier anonymous requests that stopped at Earthdata OAuth redirects; it does not describe the subsequent authenticated science extraction. Original UMM records, browse PNGs and KML bytes remain unchanged. The top manifest now links the calibrated analysis; the comparison manifest records that current source-manifest identity.
