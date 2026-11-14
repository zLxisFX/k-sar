# Project K-SAR

A research workspace for radar observations and surface-elevation scenarios in the Marikina–Pasig basin, Philippines.

## Current scope

Phase 1 makes three sources inspectable in the app:

- **NASA–ISRO NISAR:** original ASF DAAC browse images, catalog records and coverage footprints for 21 October and 2 November 2026. Both are L2 GCOV products on ascending track 140, frame 009, twelve days apart. Their downloaded bytes are checked against the provider's PNG checksums. These are visual references, not quantitative science rasters, and do not observe Carina in 2024.
- **Sentinel-1:** the existing Orbit 32 observations from 10 July and 3 August 2024, imported unchanged. The app reads the actual Float32 TIFFs on their aligned 854 × 998 grid, with 852,292 finite pixels per band. Values are already gamma-naught dB. The two acquisitions are 24 days apart; neither captures the flood peak.
- **Copernicus GLO-30 DSM:** surface elevations and a 59-sample, 1.724 km Marikina transect. A user-selected subsidence rate and elapsed time lower the surface with `z_model = z_DSM - abs(rate_mm_per_year) / 1000 * years`. At −30 mm/year over 13 years, the change is −0.390 m. This is a sensitivity scenario, not a measured velocity field.

The app supports source inspection, raster sampling and the elevation scenario. Network routing, SMS delivery, operational flood mapping and quantitative NISAR analysis are not part of this phase.

## Development

Use Node.js 22.18+ in the 22.x series or Node.js 24+, npm, and Python 3.11+. Development was checked with Node.js 26.7.0 and Python 3.13. Package versions are exact and the lockfile is committed. Python data tools use only the standard library; the committed data allows offline verification.

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

## Structure

- `src/app/` contains the page, styles and an allowlisted data-download route.
- `src/components/` contains the NISAR reference viewer and raster/profile interactions.
- `src/domain/` contains the raster decoder, coordinate sampling, elevation equations and shared types. Raster transforms use `x = columnX × column + rowX × row + originX` and `y = columnY × column + rowY × row + originY`.
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

The official [Dancing with the SARs challenge](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/) and its [resources](https://www.spaceappschallenge.org/2026/challenges/dancing-with-the-sars/?tab=resources) motivate the NISAR workflow. This phase establishes traceable data access and inspection; it does not yet deliver the challenge's quantitative surface-change analysis.

## Provenance and assistance

Pre-competition research and a separate local prototype were developed during **5–13 November 2026**. This repository began on **14 November 2026** as a new scaffold; its creation date is not the start of the underlying research. Earlier research, code, data preparation and benchmark work must be attributed when imported. This repository does not establish competition eligibility or imply endorsement by NASA, ISRO or the Space Apps Challenge.

Development has used **OpenAI Codex and Google Gemini** for research, architectural discussion, implementation and review. AI assistance is part of the project's development history. Scientific claims, source data and generated code require human review; assistance does not substitute for validation.

The workstation clock was found to be eight hours behind on 14 November 2026: GitHub returned `Sat, 14 Nov 2026 03:30:15 GMT` while the workstation reported `2026-11-13T19:30:15Z`. Commit timestamps for this phase are taken from a fresh GitHub HTTPS response at commit time. The workstation clock is left unchanged. This corrects clock skew; it does not reconstruct or disguise earlier development.

The Sentinel-1 TIFFs, DSM and archived transect came from that earlier research workspace. The NASA catalog and browse files were newly downloaded during Phase 1. Source datasets retain their own licenses and attribution requirements; see [data/NOTICE.txt](data/NOTICE.txt) and the NISAR bundle's source notes.

## License

Original project code is licensed under [Apache License 2.0](LICENSE). Dependency and dataset licenses remain separate.
