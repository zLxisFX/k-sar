# Project K-SAR

A map workspace for radar comparison, surface-elevation scenarios and hospital-path calculations in the Marikina–Pasig basin, Philippines. Built for the 2026 NASA Space Apps Challenge (*Dancing with the SARs*).

[Open the workspace](https://k-sar.vercel.app) · [Source code](https://github.com/zLxisFX/k-sar) · [Seven-slide presentation](https://k-sar.vercel.app/Project_K-SAR_2026_Final.pdf)

At an assumed **11.6 m EGM2008 water surface**, the Tumana-to-Amang network path is **27.876 km** with the original DSM. Lowering that surface model uniformly by **0.390 m** changes the result to **no path to the selected hospital anchor**. K-SAR lets you reproduce that comparison, inspect the additional excluded roads and trace the calculation to its source files.

The workspace combines quantitative Sentinel-1 radar samples, a Copernicus DSM, an OpenStreetMap directed graph and two NASA–ISRO NISAR browse observations. Radar observations, rendered browse comparisons and parameterized surface scenarios have separate units and processing records.

![K-SAR map workspace with radar curtain, route and surface controls, and Marikina River profile.](docs/workstation.png)

## Reproduce the routing comparison

Under **Subsidence tipping point**, select **Without lowering** and **With 0.390 m lowering**. Both use Tumana and the Amang Rodriguez Memorial Medical Center OSM anchor, hold water at **11.6 m EGM2008** and elapsed time at **13 years**, and recalculate with rates of **0** and **−30 mm/year**, respectively. The same inputs remain editable under **Custom inputs**.

| Surface scenario | Network result | Known depth exclusions | Unknown coverage |
|---|---:|---:|---:|
| Original DSM; 0 mm/year | 27.875634 km | 61,848 directed edges | 6 directed edges |
| DSM lowered by 0.390 m | No path to the selected anchor | 63,408 directed edges | 6 directed edges |

Lowering adds **1,560 known depth exclusions** at this water level. The amber overlay identifies newly excluded directed edges, deduplicated for display when edges share geometry. Unknown DSM coverage remains separate.

The **Baseline**, **10 m water** and **12 m water** presets provide other reference cases for the same origin and selected hospital anchor:

| Preset | Water surface | Rate / elapsed time | Routing scenario | Reference result |
|---|---:|---|---|---|
| Baseline | 0 m EGM2008 | 0 mm/year / 13 years | Off | 3.726 km topology-only path |
| 10 m water | 10 m EGM2008 | −30 mm/year / 13 years | On; 0.390 m lowering | 27.876 km path, a 648% increase |
| 12 m water | 12 m EGM2008 | −30 mm/year / 13 years | On; 0.390 m lowering | No path to the selected anchor |

The preset's reference text is distinct from the computed result. Changing the origin, hospital, water level, rate, elapsed time or routing toggle removes the preset selection unless the controls exactly match another preset. **Custom inputs** remain editable; with **Use for routing** off, surface preview changes do not apply flood exclusions to the graph.

The 10 m scenario has 55,136 depth-closed directed edges without lowering and 56,568 with 0.390 m lowering: **1,432 additional closures**. The amber layer contains 803 unique geometries associated with those 1,432 newly excluded directed edges. Six edges with incomplete DSM coverage are excluded separately. The 27.876 km path is the same with and without lowering at this water level.

### Exact threshold in this graph

An independent directed breadth-first search finds a maximum connected cutoff of **11.612146377563477 m DSM elevation**. Under the strict depth rule, the original surface remains connected through a water level of **11.912146377563477 m**; with 0.390 m lowering it remains connected through **11.522146377563477 m**. The same-water contrast interval is **(11.522146377563477, 11.912146377563477] m**, approximately 11.522–11.912 m.

These digits reproduce the stored samples and floating-point calculation; they are not physical elevation precision. The [threshold analysis](data/network/routing-threshold.json) records the separating directed edge, full geometry, graph hashes and 301 comparisons at 0.05 m steps. It verifies connected and disconnected results at adjacent representable water values. At the threshold, the selected-pair cut crosses an E. Rodriguez Highway edge between OSM nodes 596838287 and 596838267.

These calculations screen graph connectivity using an assumed water surface and a DSM. They do not establish observed flooding, road passability, hospital operation or isolation from every hospital.

## Run locally

Use Node.js 26.x and npm for the application. Data checks and NISAR comparison regeneration also use Python 3.11 or later, NumPy and Pillow. The npm lockfile pins package versions.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. To check and build:

```sh
python -m pip install numpy Pillow
npm run typecheck
npm test
npm run build
npm start
```

The servers bind to loopback by default. The committed data supports local calculations and offline data verification; the contextual OpenStreetMap background tiles require a network connection.

## Data

| Source | Included material | Use |
|---|---|---|
| Sentinel-1 RTC | Orbit 32, descending, 10 July and 3 August 2024; VV/VH Float32 TIFFs | Radar comparison and coordinate samples |
| Copernicus GLO-30 | DSM aligned to the radar grid; elevations in m EGM2008 | Surface profile and scenario screening |
| OpenStreetMap | 62,446 nodes, 155,830 directed edges, 215 hospital-tagged features and contextual waterways | Graph search and map context |
| NASA–ISRO NISAR | L2 GCOV catalog records, original browse PNGs, provider KML bounds and footprints for 21 October and 2 November 2026 | Aligned browse comparison, display-code differences and provenance |

The Sentinel-1 TIFFs contain gamma-naught values already converted to dB on an aligned **854 × 998** grid. Each band has **852,292 finite pixels**. Grid spacing is 30 projected metres in EPSG:3857. At the Tumana reference coordinate (`121.095940° E, 14.658016° N`), VV shifts from `−9.41 dB` on 10 July to `−7.05 dB` on 3 August (`+2.36 dB`). The acquisitions are 24 days apart and do not capture the July 2024 flood peak; backscatter change is not water depth.

The NISAR pair shares ascending track 140 and frame 009, twelve days apart. Original browse files are checked against provider PNG checksums. These October–November 2026 observations do not depict the July 2024 Carina event. Quantitative GCOV HDF5 pixels have not been downloaded or analyzed.

### Why C-band and L-band

Sentinel-1 uses **C-band, approximately 5.6 cm wavelength**; NISAR L-SAR uses **L-band, approximately 24 cm**. Longer-wavelength radar generally penetrates farther into vegetation, although canopy density and target geometry affect the response. This motivates testing NISAR for surface change beneath vegetation alongside the Sentinel-1 observations. It does not establish a universal flood threshold or make the two sensors' backscatter directly interchangeable. K-SAR compares quantitative Sentinel-1 values and rendered NISAR browse codes; it has not measured an L-band flood response. Sources: [ESA Sentinel-1 tutorial](https://step.esa.int/docs/tutorials/S1TBX%20Landcover%20classification%20with%20Sentinel-1%20GRD.pdf), [NASA NISAR fact sheet](https://www.earthdata.nasa.gov/s3fs-public/2025-01/HR_NA_NISAR_Nov2024.pdf), [NASA SAR Handbook, chapter 2](https://earthdata.nasa.gov/s3fs-public/2025-04/SARHB_CH2_Content.pdf).

The [raster manifest](data/sentinel-1/manifest.json), [network manifest](data/network/manifest.json), [transect reference](data/transect/reference.json) and [NISAR documentation](data/nasa/nisar/README.md) retain file hashes and source details. The 59-point transect spans 1.724 km on the WGS84 ellipsoid.

### NISAR browse comparison

The provider's linked KML files place both 1,990 × 1,960 browse images on the same geographic grid, despite their different catalog footprints. Nearest-neighbor sampling maps them to a **62 × 145 grid at 200 projected metres in EPSG:3857**. The output adds no spatial detail to the roughly 170 m provider browse samples.

The common mask retains **8,784 of 8,990 cells**: each sampled location has nonzero R, G and B values and opaque transparency in both images, and its center falls within both catalog footprints and the study bounds. This is a browse-coverage mask, not the GCOV science-quality mask.

The difference layer subtracts the earlier rounded weighted RGB display code from the later code:

```text
display_code = floor((2126R + 7152G + 722B + 5000) / 10000)
difference_DN = display_code_2026-11-02 − display_code_2026-10-21
```

Across the common cells, the difference ranges from **−44 to +37 DN**, with a median of **0 DN** and mean absolute difference of **1.3784 DN**. These are rendered display codes, not gamma-naught, dB or a flood measurement. The provider renderer normalizes images after display processing; the actual products' stretch parameters have not been verified. A zero-shift texture-correlation check is recorded as a diagnostic, not independent positional validation.

The [comparison manifest](data/nasa/nisar/comparison/manifest.json) records grid bounds, source KML hashes, the mask, signed differences, distributions, processing references and limitations. The original PNGs and metadata remain unchanged.

## Calculations

Surface lowering uses:

```text
z_model = z_DSM − abs(rate_mm_per_year) / 1000 × elapsed_years
```

At −30 mm/year over 13 years, the modeled change is −0.390 m. Rate and elapsed time are user inputs, not a measured InSAR velocity field or an exact acquisition epoch. GLO-30 is a surface model that includes buildings and vegetation.

Each directed road edge is sampled at its vertices and at intervals of at most 15 projected metres. Its minimum sampled DSM elevation is tested with:

```text
exclude_known_edge = minimum_DSM < water_level + lowering − 0.30 m
```

This implements modeled depth **strictly greater than 0.30 m**; equality stays open. Any missing DSM sample excludes the edge as unknown. Water and surface elevations share the EGM2008 vertical reference. Water level is an absolute assumed surface elevation, not a depth or river-gauge reading. The model contains no hydraulics, drainage, bridge clearance, barriers or surveyed road-deck heights.

Conventional A* minimizes original OSM edge lengths using an admissible scaled Euclidean heuristic in EPSG:32651. Origins and hospital features are snapped to graph nodes; snap distances are reported. Hospital-tagged features can duplicate a facility and do not verify entrances, capacity or operation.

The surface preview and routing scenario are independent. **Use for routing** applies the selected water level, rate and elapsed time. Pending calculations remain distinguishable from applied results.

## API and session export

`GET /api/route` returns the origin and hospital catalog. `POST /api/route` accepts:

```json
{
  "origin": [121.09593983925672, 14.6580158],
  "hospitalId": "way/54025002",
  "scenario": { "waterLevelM": 11.6, "rateMmYear": -30, "elapsedYears": 13 }
}
```

Use `scenario: null` for the topology-only result. Responses preserve the applied request, graph identity, geometry, graph-search timing, known depth exclusions, additional exclusions from lowering and unknown coverage.

`withoutLoweringRoute` calculates the same origin, hospital and water level with zero lowering, including the same unknown-coverage exclusions. It is distinct from the topology-only `baseline`, reuses `scenarioRoute` when lowering is zero, and is `null` when scenario routing is off. This reference allows a direct comparison of the lowering effect without changing water level.

Session JSON records source and derived file identities with SHA-256 hashes, map position, layer visibility, the selected coordinate and profile index, surface preview, requested route, applied response and pending state. Browser timestamps are unverified. The export identifies files rather than embedding all source pixels; external background tiles are outside its hash coverage.

The SMS panel is a local acknowledgement simulator. It validates GSM-7 requests and returns a fixed reply of exactly 145 characters and septets. It has no gateway, transmission or dispatch integration.

## Verification and benchmarks

Tests cover raster decoding and alignment, source pixel samples, geodesic transect distances, lowering, strict depth boundaries, unknown coverage, directed routing, the exact connectivity threshold, presets, session state, GSM-7 encoding, streaming transport and NISAR source contracts. These are software and data checks, not field validation.

```sh
node scripts/analyze-routing-threshold.ts
node scripts/analyze-routing-threshold.ts --check
python scripts/import-nisar.py --verify
python scripts/build-nisar-comparison.py
npm run benchmark:routing
```

The benchmark records 30 graph-search runs after ten warmups. [benchmark-current.json](data/network/benchmark-current.json) retains the runtime, every timing and graph hashes. Its 14 November Node.js run measured Tumana baseline at 0.1654 ms median and the 10 m detour at 3.7931 ms median. Search timing includes allocation and path reconstruction; it excludes graph loading, snapping, scenario preparation, geometry and HTTP. Live timings vary.

Running `scripts/import-nisar.py` without `--verify` retrieves the pinned public NASA source files again. Application use and routing tests require only the checked graph bundled in this repository. Reconstructing that import from the original research GraphML requires the separately retained source files and the Python geospatial dependencies documented in the import script.

`scripts/build-nisar-comparison.py` regenerates the derived NISAR files deterministically from retained inputs, without network access. Its `--fetch` option refreshes the two pinned provider KML files; it does not download science HDF5 pixels.

## Architecture and deployment

- `src/components/`: MapLibre workspace, radar curtain, river profile and NASA reference viewer.
- `src/domain/`: raster sampling, elevation, graph search, SMS encoding and session serialization.
- `src/server/` and `src/app/api/route/`: graph loading and route responses.
- `data/`, `scripts/` and `tests/`: source assets, import records, reproduction and checks.

Before development, build or production start, `prepare:assets` copies an explicit list of source files into `public/data/` and verifies the copied bytes. The pinned MapLibre worker is copied to `public/maplibre/`. Both generated directories are ignored by Git.

For Vercel, `vercel.json` runs `npm run build`; large TIFF/GeoJSON assets are static. The routing function streams plain JSON and leaves transport compression to Vercel. From a linked checkout, deploy with `npx vercel@65.16.0 --prod`. Review and push the intended commit before deploying the checkout. Local Vercel configuration and credentials are ignored by Git.

## Attribution and provenance

See [data notices](data/NOTICE.txt), [OpenStreetMap network terms](data/network/NOTICE.txt), the [network manifest](data/network/manifest.json) and [presentation credits](docs/presentation-sources.md).

The repository began on 14 November 2026 and reuses Sentinel-1, DSM, transect and network research from 5–13 November. Manifests retain source hashes, processing steps and provider HTTP dates separately from the offset workstation clock. Importing a file does not reset its acquisition or preparation history.

OpenAI Codex generated and revised substantial application code, processing scripts, tests, documentation and presentation material, and operated development and deployment tools. Google Gemini contributed architectural, scientific and visual suggestions. Provider observations retain their attribution; the assistance does not imply synthetic satellite data or completed independent scientific review.

The [Dancing with the SARs challenge](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/) motivates the NISAR inspection workflow. Quantitative NISAR change analysis and field comparison are further work.

Original software is licensed under [Apache License 2.0](LICENSE). Third-party data and dependencies retain their own licenses.

## Original source-file hashes

These 17 original file identities are retained unchanged. They were fetched anonymously from the production alias on 15 November 2026 and matched the local SHA-256 digests below. New derived comparison and analysis outputs are identified separately; they do not replace these source files.

| # | Dataset ID | Bytes | SHA-256 |
|---:|---|---:|---|
| 1 | `sentinel-1/baseline.tif` | 6,153,533 | `0f035f4b14488d27c45c7d88744503b23c12ac32f6145b1b1af56006115475f4` |
| 2 | `sentinel-1/post.tif` | 6,147,415 | `24473d762dcd2de5dbf227e3d0ce043b32b3d46f4ce767076cda1e21e5e21f0c` |
| 3 | `sentinel-1/dem.tif` | 2,561,258 | `39ee1d9afa27ffbf5a552566253e646a740416c3b86cac61db79209dbaec2a86` |
| 4 | `network/graph.json.gz` | 8,001,173 | `187a0e0fb4929b4ef5e092a76d43bcf76c179f622659887baa5c7497af7380b2` |
| 5 | `network/hospitals.geojson` | 106,810 | `cb8398481f67381f2a9d2c604325d4f9ed9b9c0aa63caf1f51ed0e9b5691db83` |
| 6 | `network/roads-display.geojson` | 16,179,717 | `3ee78a19b59672fa90c287cdff7693139d98f9582fe7c3451f29f94ddb7d3e4b` |
| 7 | `network/source-osm-manifest.json` | 561 | `275a06719e32d4523cda4581edd8d9ece0be7a03bb710a3463a41fb87f7aa711` |
| 8 | `network/source-terrain-manifest.json` | 1,049 | `d63ce525ab23df671e1deb380d643dae46c60c4550d661097b3ec8c97b35855b` |
| 9 | `network/odbl-1.0.html` | 51,543 | `85bc21fb2c00b2effb9202b2aa785934ce5a05df954e17cbd2a1f7c10c04c633` |
| 10 | `network/waterways.geojson` | 2,381,373 | `eca79db5e7d29d8efcd05770b39e18b30afb5845b813640c5e5c8fc73b5111df` |
| 11 | `transect/reference.json` | 23,416 | `848bc873ac998406b7287a4b54a7ba7d413d2d7780b6fa8d5b73bdd97117ab8e` |
| 12 | `nasa/nisar/browse/2026-10-21.png` | 3,577,844 | `28b5d11fe4953b81ec0c82ae5c0512894ef2a5550afbffced8c5b7da385cb5bf` |
| 13 | `nasa/nisar/raw/G4404197169-ASF.umm.json` | 29,124 | `870955a73ab5ac97dbddeca674d2483c59d3602a517dfe6730ce5aecc5bffe27` |
| 14 | `nasa/nisar/browse/2026-11-02.png` | 3,461,930 | `066d77b8f38fbc0b03edf65727ff1647f0db6e58898f53544173dc5008b78289` |
| 15 | `nasa/nisar/raw/G4408731464-ASF.umm.json` | 29,120 | `6a95424ba69fe1affaf0e5ae28479c6cebebd14569fa99598694b449b1cc8200` |
| 16 | `nasa/nisar/raw/C3622241360-ASF.umm.json` | 10,704 | `616216cbc19bbf9f16b70ac4b6c063b993f4d966007a3a26c7ee7259598bc256` |
| 17 | `nasa/nisar/footprints.geojson` | 1,710 | `d96bf5c72628cfc01512c9b0a00b8cd6aa7b3d074fb60600d260b183389eca2a` |

These are 17 file identities, not 17 independent scientific datasets. They include a license document and provenance metadata. External OpenStreetMap tiles are not included. The page computes the transect hash from the actual file.

### Derived analysis identities

The session also identifies the two provider KML files and six derived NISAR comparison files below. The [comparison manifest](data/nasa/nisar/comparison/manifest.json) describes their relationship to the unchanged original sources. The [routing-threshold result](data/network/routing-threshold.json) is a separate deterministic graph analysis; reproduce it with `node scripts/analyze-routing-threshold.ts --check`.

| File | Bytes | SHA-256 |
|---|---:|---|
| `nasa/nisar/comparison/raw/G4404197169-ASF_LATLON.kml` | 573 | `eda6489fdb15bdba49ca08509446b574c6ad1e49f9e5dc9c51060ab87b9176ba` |
| `nasa/nisar/comparison/raw/G4408731464-ASF_LATLON.kml` | 573 | `9bf18f6f9426f2120afb7028363bfdd80be326f5bc95520484cee1b8ee7e66d8` |
| `nasa/nisar/comparison/aligned-2026-10-21.png` | 15,574 | `a2330d6cd88a6851c0db1338acca2a0eab2637da8e9562c7af1774422b683899` |
| `nasa/nisar/comparison/aligned-2026-11-02.png` | 15,317 | `140e643f0960cdf92a052dc0f468b6be16123f69aa87ec83267077f401e1f933` |
| `nasa/nisar/comparison/common-mask.png` | 117 | `31535cbf122f6da3a52d8a97ea8865b13b985b2436bad05a11c21797df42353a` |
| `nasa/nisar/comparison/difference.png` | 8,979 | `050e6d013b135ff8be1b3771509d7388106f1ba0e7d1e0366d04c60251de4d6e` |
| `nasa/nisar/comparison/difference.i16` | 17,980 | `2d20ccd38f640625eb2297dcb5c2668c63f006d38a0c300a1aef2d013da5650d` |
| `nasa/nisar/comparison/manifest.json` | 49,764 | `73975e1fd216e297e76ce843740c7d5531a8f29de3537906ba5023d99865d3a1` |
| `network/routing-threshold.json` | 236,822 | `f107f93170da5b14d7a64d583b134141a358762e9d61e6ecdf34a26af91fec92` |
