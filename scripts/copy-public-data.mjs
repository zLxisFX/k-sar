import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "data");
const destination = join(root, "public/data");
const json = async (path) => JSON.parse(await readFile(join(source, path), "utf8"));
const [radar, network, nasa] = await Promise.all([
  json("sentinel-1/manifest.json"), json("network/manifest.json"), json("nasa/nisar/manifest.json"),
]);
const files = new Set([
  "NOTICE.txt", "transect/reference.json",
  "sentinel-1/manifest.json", "sentinel-1/source-sar-items.json", "sentinel-1/source-raster-sha256.json",
  "sentinel-1/source-raster-manifest.json", "sentinel-1/source-dem-catalog.json",
  "network/manifest.json", "network/NOTICE.txt", "network/waterways.geojson", "network/waterways-provenance.json", "network/benchmark-current.json",
  "licenses/cc-by-4.0.txt", "licenses/sentinel-data-legal-notice.pdf", "licenses/copernicus-dem-licenses.pdf",
  "licenses/sentinel-1-rtc-collection.json", "licenses/sources.json",
  "nasa/nisar/manifest.json", "nasa/nisar/footprints.geojson", "nasa/nisar/README.md",
  `nasa/nisar/${nasa.collection.metadata.path}`,
  ...radar.files.map((file) => `sentinel-1/${file.file}`),
  ...network.files.map((file) => `network/${file.path}`),
  ...nasa.records.flatMap((record) => [`nasa/nisar/${record.metadata.path}`, `nasa/nisar/${record.browse.path}`]),
]);
const expectedHashes = new Map([
  ...radar.files.map((file) => [`sentinel-1/${file.file}`, file.sha256]),
  ...network.files.map((file) => [`network/${file.path}`, file.sha256]),
  ...nasa.records.flatMap((record) => [[`nasa/nisar/${record.metadata.path}`, record.metadata.sha256], [`nasa/nisar/${record.browse.path}`, record.browse.sha256]]),
  [`nasa/nisar/${nasa.collection.metadata.path}`, nasa.collection.metadata.sha256],
  ["nasa/nisar/footprints.geojson", nasa.footprints.sha256],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function checkedPath(base, path) {
  const result = resolve(base, path);
  const suffix = relative(base, result);
  if (!suffix || isAbsolute(suffix) || suffix === ".." || suffix.startsWith(`..${sep}`)) throw new Error(`Invalid publication path: ${path}`);
  return result;
}
await mkdir(destination, { recursive: true });
// Remove only stale generated files inside this checked output directory.
for (const entry of await readdir(destination, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  const suffix = relative(destination, path).split(sep).join("/");
  if (!files.has(suffix)) await rm(checkedPath(destination, suffix));
}
let totalBytes = 0;
for (const path of [...files].sort()) {
  const input = checkedPath(source, path), output = checkedPath(destination, path);
  const bytes = await readFile(input), digest = hash(bytes);
  if (expectedHashes.has(path) && digest !== expectedHashes.get(path)) throw new Error(`Source checksum mismatch: ${path}`);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(input, output);
  if (hash(await readFile(output)) !== digest) throw new Error(`Static copy checksum mismatch: ${path}`);
  const size = (await stat(output)).size;
  if (size >= 100_000_000) throw new Error(`Static asset exceeds the Hobby per-file limit: ${path}`);
  totalBytes += size;
}
console.log(`Published ${files.size} byte-identical data assets (${totalBytes.toLocaleString()} bytes) to public/data; source hashes preserved.`);
