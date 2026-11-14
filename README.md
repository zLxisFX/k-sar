# Project K-SAR

A research workspace for radar observations, surface scenarios and road-network analysis in the Marikina–Pasig basin, Philippines.

## Current scope

This repository contains the initial Next.js and TypeScript scaffold. Its home page records the intended data scope and distinguishes observations from modeled scenarios. It does not yet contain geospatial datasets, a map, a routing service, or an SMS gateway. The status page does not simulate these capabilities.

## Development

Use Node.js 20.9 or later and npm. The initial build was checked with Node.js 26.7.0. Package versions are exact and the lockfile is committed for reproducible installation.

```sh
npm ci
npm run dev
```

Open <http://127.0.0.1:3000>. Before committing changes:

```sh
npm run typecheck
npm run build
```

`npm start` serves the production build. Development and production servers bind to the local loopback address by default.

## Structure

- `src/app/` contains the application shell, status page and styles. The scaffold uses server components; browser-only map and interaction code will have explicit client boundaries.
- `src/domain/geospatial.ts` contains the study-area, raster-grid and evidence types. The page displays the expected Sentinel-1 grid dimensions from prior research; this is an import target, not a newly loaded dataset. Raster transforms use `x = columnX × column + rowX × row + originX` and `y = columnY × column + rowY × row + originY`.

As workflows are added, keep radar observations, physical scenarios, network routing and transect analysis in separate domain modules. Keep data acquisition and scientific processing outside display components. Import reviewed data with its source, acquisition date, units, coordinate reference system, license and limitations. Do not infer measurement validity from visual presentation.

## Provenance and assistance

Pre-competition research and a separate local prototype were developed during **5–13 November 2026**. This repository began on **14 November 2026** as a new scaffold; its creation date is not the start of the underlying research. Earlier research, code, data preparation and benchmark work must be attributed when imported. This repository does not establish competition eligibility or imply endorsement by NASA, ISRO or the Space Apps Challenge.

Development has used **OpenAI Codex and Google Gemini** for research, architectural discussion, implementation and review. AI assistance is part of the project's development history. Scientific claims, source data and generated code require human review; assistance does not substitute for validation.

The workstation clock was found to be eight hours behind on 14 November 2026: GitHub returned `Sat, 14 Nov 2026 03:30:15 GMT` while the workstation reported `2026-11-13T19:30:15Z`. Commit timestamps for this phase are taken from a fresh GitHub HTTPS response at commit time. The workstation clock is left unchanged. This corrects clock skew; it does not reconstruct or disguise earlier development.

Source datasets retain their own licenses and attribution requirements. No third-party geospatial data is included in this initial scaffold.

## License

Original project code is licensed under [Apache License 2.0](LICENSE). Dependency and future dataset licenses remain separate.
