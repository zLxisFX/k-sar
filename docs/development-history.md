---
project: Project K-SAR
development_assistance:
  OpenAI Codex: research, architecture discussion, substantial code generation and revision, data-processing scripts, tests, documentation, deployment and presentation preparation
  Google Gemini: architectural, scientific and visual suggestions
source_observations: attributed provider files; assistance does not imply synthetic satellite or OpenStreetMap observations
prior_research_period: 2026-11-05 through 2026-11-13
repository_started: 2026-11-14
independent_human_or_field_validation_claimed: false
---

# Development history

This record accompanies the repository's source data, software and documentation. It preserves the earlier research and the tools used to produce the current application.

## Research and reuse

An earlier K-SAR research workspace and prototype were developed during **5–13 November 2026** in `C:\K_SAR_Sandbox_Local`. That work included source research, code, data preparation, the Sentinel-1/DSM/transect artifacts, OpenStreetMap extracts and historical routing benchmarks.

The current repository began on **14 November 2026** as a new scaffold. This date is the start of the new repository, not the start of the underlying project. Importing earlier artifacts does not make them newly acquired or reset their preparation dates.

The Sentinel-1 TIFFs, Copernicus DSM and archived transect were copied from the earlier workspace. The road graph was imported from its original GraphML and sampled against the same DSM; the manifest retains the original input hashes. Waterways were copied unchanged from the earlier research file. The original OSM timestamps are retained as records, without treating a cached preparation time as an independently verified observation time.

NASA–ISRO NISAR metadata and browse images were retrieved on **14 November 2026**. Their records preserve the source/resolved URLs, HTTP dates, provider checksum comparison and SHA-256 hashes. They are distinct from the earlier Sentinel-1 artifacts and are not quantitative GCOV science rasters.

## Assisted development

**OpenAI Codex and Google Gemini** were used in research, architectural discussion, implementation, review and presentation preparation. Codex generated and revised substantial application code, data-import and verification scripts, automated tests, documentation and presentation copy, and operated development/deployment tools. Gemini contributed architectural, scientific and visual suggestions through the existing conversation.

This assistance was broader than boilerplate generation. It is recorded here rather than represented as exclusively human-authored development. Automated checks establish the tested software/data contracts; they do not establish that an independent human scientific review or field validation has been completed.

Original satellite pixels, source catalog metadata and OSM records retain their provider attribution. AI-assisted processing and code do not turn provider data into AI-generated observations. The repository's manifests describe copying, sampling, geometric transformations and derived artifacts.

Presentation layout and copy may be assisted by these tools. Official mission images, original data visualizations, templates and fonts retain their own source/author/license notes; a rendered layout is not evidence of a new satellite acquisition. Any generated image/audio/video should be identified according to the submission instructions for that medium.

## Clock provenance

On 14 November 2026, a fresh GitHub HTTPS response reported `Sat, 14 Nov 2026 03:30:15 GMT` while the workstation reported `2026-11-13T19:30:15Z`, an eight-hour difference. The workstation clock was left unchanged.

Commits and new import records use fresh server HTTP dates where recorded. Host timestamps and provider timestamps are retained separately. This correction documents clock skew; it does not reconstruct or disguise prior work. Session exports identify browser timestamps as unverified.

## Scope of the record

This history does not determine competition eligibility or imply endorsement by NASA, ISRO, ESA, Copernicus or the Space Apps organizers. The project and dataset licenses are recorded separately in `LICENSE`, `data/NOTICE.txt` and the source bundles.
