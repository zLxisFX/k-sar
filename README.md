# Project K-SAR

A research workspace for radar observations and surface-elevation scenarios in the Marikina–Pasig basin, Philippines.

[Open the live workspace](https://k-sar.vercel.app).

## Current scope

Three sources are inspectable in the app:

- **NASA–ISRO NISAR:** original ASF DAAC browse images, catalog records and coverage footprints for 21 October and 2 November 2026. Both are L2 GCOV products on ascending track 140, frame 009, twelve days apart. Their downloaded bytes are checked against the provider's PNG checksums. These are visual references, not quantitative science rasters, and do not observe Carina in 2024.
- **Sentinel-1:** the existing Orbit 32 observations from 10 July and 3 August 2024, imported unchanged. The app reads the actual Float32 TIFFs on their aligned 854 × 998 grid, with 852,292 finite pixels per band. Values are already gamma-naught dB. The two acquisitions are 24 days apart; neither captures the flood peak.
- **Copernicus GLO-30 DSM:** surface elevations and a 59-sample, 1.724 km Marikina transect. A user-selected subsidence rate and elapsed time lower the surface with `z_model = z_DSM - abs(rate_mm_per_year) / 1000 * years`. At −30 mm/year over 13 years, the change is −0.390 m. This is a sensitivity scenario, not a measured velocity field.

The map compares the two Sentinel-1 acquisitions with a swipe curtain. Clicking the map samples both radar passes and the DSM at the same coordinate; pointing at the river profile selects one of its 59 samples. The profile previews the selected lowering, while **Use for routing** applies the water-level and lowering scenario to the road graph. **Sources** opens the NASA browse images, footprints and original records.

The routing service operates on a local OpenStreetMap graph; its paths are research results, not verified road access or hospital availability. The SMS tool is a local acknowledgement simulator and does not transmit messages. Quantitative NISAR analysis remains outside the downloaded browse-data scope.

## Development

Use Node.js 26.x, npm, and Python 3.11+. Development was checked with Node.js 26.7.0 and Python 3.13. Package versions are exact and the lockfile is committed. NASA import and verification tools use Python's standard library; the committed data allows offline verification. Rebuilding the road import from the original GraphML additionally needs OSMnx, NumPy, Shapely, pyproj and rasterio in the original research environment.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Before committing changes:

```sh
npm run typecheck
npm test
npm run build
```

`npm start` serves the production build. Development and production servers bind to the local loopback address by default.

`npm ci` also copies the pinned MapLibre worker modules into `public/maplibre/`. Before development, build and start, `prepare:assets` publishes an explicit list of 34 source files into `public/data/` and verifies their bytes. Both generated directories are ignored by Git. The OpenStreetMap background tiles require a network connection; they are contextual cartography, not a historical flood map.

## Production deployment

From a Vercel-linked checkout, deploy with `npx vercel@65.16.0 --prod`. `vercel.json` requires `npm run build`, including asset preparation. The large TIFFs and GeoJSONs are static files; the routing function bundles only its graph, hospital features and manifest. Route results retain the same JSON structure and stream as plain JSON. Vercel handles transport compression; application-level gzip would double-encode the response. Streaming avoids the buffered-response size limit without reducing data precision.

The CLI deploys the current checkout. Push the reviewed commit before the final deployment; this workflow does not depend on a GitHub auto-deployment integration. Credentials and Vercel's local project files are ignored by Git.

## Structure

- `src/app/` contains the page, styles and routing endpoint.
- `src/components/` contains the map workstation, NASA reference viewer and river profile.
- `src/domain/` contains the raster decoder, coordinate sampling, elevation equations, graph search, SMS encoding and session serialization. Raster transforms use `x = columnX × column + rowX × row + originX` and `y = columnY × column + rowY × row + originY`.
- `data/` contains the source TIFFs, NASA reference bundle, transect, hashes, provenance and license documents.
- `scripts/` contains reproducible data import and verification commands; `tests/` checks the data contracts and scientific calculations.

The grid's 30 m spacing is in EPSG:3857 projected metres, not a uniform ground distance. DSM elevations use EGM2008 and include structures and vegetation. Scenario water levels must use that same vertical reference; the `depth > 0.30 m` cutoff is a screening assumption, not verified vehicle passability. Missing values remain unknown.

## NASA data and reproduction

The [NISAR bundle documentation](data/nasa/nisar/README.md) identifies the two exact CMR concepts, acquisition times, original filenames and checksum verification. To verify the committed files without a network connection:

```sh
python scripts/import-nisar.py --verify
```

Running the same script without `--verify` downloads those pinned NASA records and browse images again. It does not require credentials. Quantitative GCOV science pixels require Earthdata authentication and are not included in this repository. Browse colors have no project-defined physical scale; the differing footprints are not registered for pixel subtraction.

The [Sentinel-1 manifest](data/sentinel-1/manifest.json) records scene identifiers, upstream assets and inherited processing. The [transect reference](data/transect/reference.json) preserves the prior sampled array; tests independently sample the imported TIFFs and check it within the original rounding precision.

Git preserves `data/` bytes exactly, including original line endings, so a checkout does not invalidate the retained checksums.

The official [Dancing with the SARs challenge](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/) and its [resources](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/?tab=resources) motivate the NISAR workflow. The current reference bundle establishes traceable data access and inspection; it does not yet deliver quantitative NISAR surface-change analysis.

## Local acknowledgement

`simulateSms` accepts a request category (`FLOOD`, `DIALYSIS` or `TRAUMA`) followed by a location. Its fixed reply is exactly 145 GSM-7 characters and septets. Requests are limited to 145 septets; extension-table characters consume two, and unsupported Unicode is rejected rather than silently recoded. The [GSM-7 encoding reference](https://www.twilio.com/docs/glossary/what-is-gsm-7-character-encoding) describes this distinction. The simulator has no SMS gateway, transmission or dispatch capability.

## Routing and reproducible sessions

`GET /api/route` provides the origins and 215 hospital-tagged OSM features. These may include multiple features for one facility. `POST /api/route` accepts `{origin: [longitude, latitude], hospitalId, scenario}`; `scenario` is either `null` or `{waterLevelM, rateMmYear, elapsedYears}`. Heights use EGM2008, rates use mm/year, and elapsed time uses years. The response includes the exact applied request, graph hashes, the topology-only path, the scenario path and separate depth-closure/unknown-coverage counts.

The imported directed multigraph has 62,446 nodes and 155,830 edges. A* minimizes the original OSM lengths with an admissible scaled Euclidean heuristic. Each edge's DSM samples include its vertices and positions no more than 15 projected metres apart. An edge is closed by the model only when depth exceeds 0.30 m. Six edges have partially missing DSM coverage and are excluded separately in scenarios; they are not classified as flooded.

For Tumana to the selected Amang Rodriguez Memorial Medical Center OSM anchor, the unmodified network path is 3.726297 km. At a 10 m water surface it becomes 27.875634 km, both with zero lowering and with −0.390 m lowering. The lowering changes depth-closed directed edges from 55,136 to 56,568 (+1,432); total exclusions including unknown coverage are 55,142 and 56,574. At 12 m water and −0.390 m lowering, that selected origin/anchor pair has no path. This does not establish isolation from every hospital.

Run `npm run benchmark:routing` to record 30 graph-search runs after ten warmups. The [current report](data/network/benchmark-current.json) retains every timing, runtime, graph hash and timing scope. The archived Python medians of 0.216 ms (Malanday) and 0.304 ms (Tumana) are historical references; 22.27 ms was one archived detour solve. They are not hardcoded live performance claims.

The [network manifest](data/network/manifest.json) identifies the original GraphML, hospital extract, DSM and sampled-index hashes. `scripts/import-network.py --legacy-root <original-research-directory>` rebuilds this import and checks freshly sampled minima against the archived index; it requires the original research files. Running the app, its tests and its benchmark uses the checked graph already included here. OpenStreetMap attribution and ODbL terms are retained in [the network notice](data/network/NOTICE.txt).

JSON sessions use schema version 2 and preserve dataset hashes, map state, layer visibility, surface preview parameters and the complete applied route response. Preview parameters remain present when scenario routing is disabled. Requested and applied routes are stored separately; an export during a pending calculation retains that state explicitly. Client timestamps are identified as unverified; nonfinite values cannot silently turn into JSON `null`. External OpenStreetMap background tiles are not archived or covered by the local dataset hashes.

## Provenance and assistance

Pre-competition research and a separate local prototype were developed during **5–13 November 2026**. This repository began on **14 November 2026** as a new scaffold; its creation date is not the start of the underlying research. Earlier research, code, data preparation and benchmark work must be attributed when imported. This repository does not establish competition eligibility or imply endorsement by NASA, ISRO or the Space Apps Challenge.

Development has used **OpenAI Codex and Google Gemini** for research, architectural discussion, implementation and review. AI assistance is part of the project's development history. Scientific claims, source data and generated code require human review; assistance does not substitute for validation.

The workstation clock was found to be eight hours behind on 14 November 2026: GitHub returned `Sat, 14 Nov 2026 03:30:15 GMT` while the workstation reported `2026-11-13T19:30:15Z`. Commit timestamps are taken from a fresh GitHub HTTPS response at commit time. The workstation clock is left unchanged. This corrects clock skew; it does not reconstruct or disguise earlier development.

The Sentinel-1 TIFFs, DSM and archived transect came from that earlier research workspace. The NASA catalog and browse files were downloaded on 14 November 2026. Source datasets retain their own licenses and attribution requirements; see [data/NOTICE.txt](data/NOTICE.txt) and the NISAR bundle's source notes.

## License

Original project code is licensed under [Apache License 2.0](LICENSE). Dependency and dataset licenses remain separate.
