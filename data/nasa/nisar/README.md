# NISAR catalog and browse reference bundle

This bundle contains two real NASA ASF DAAC catalog records and their unchanged provider browse PNGs for a region that includes Marikina, Philippines. It contains **no science HDF5 raster pixels**, quantitative backscatter extraction, flood classification, subsidence estimate, or routing result.

| Acquisition (UTC) | CMR concept | Product |
| --- | --- | --- |
| 21 October 2026, 21:30:32 | [G4404197169-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4404197169-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |
| 2 November 2026, 21:30:32 | [G4408731464-ASF](https://cmr.earthdata.nasa.gov/search/concepts/G4408731464-ASF.umm_json) | NISAR L2 GCOV, VALIDATED |

The acquisitions are exactly 12 days apart and share ascending track 140, frame 009, processing release P05036, and HH/HV polarizations. Frequency A (40 MHz) and B (5 MHz) are L-SAR subbands. They are not L-band and S-band images. These 2026 observations are separate from the July 2024 Carina case study.

The footprints differ. The PNGs have not been co-registered and must not be used for pixel subtraction, quantitative comparisons or a curtain that implies matched pixels. The provider's VALIDATED maturity label applies to its product release, not to any K-SAR interpretation. Catalog footprints do not establish that every location contains valid science pixels. Browse colors have no project-defined physical units or classification legend.

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
