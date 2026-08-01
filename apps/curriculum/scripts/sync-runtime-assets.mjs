import { mkdir, readFile, writeFile } from "node:fs/promises";

const checkOnly = process.argv.includes("--check");
const curriculumDataUrl = new URL("../data/", import.meta.url);
const curriculumRuntimeUrl = new URL("../runtime/", import.meta.url);
const runtimeDataUrl = new URL("../../languages/czech/static/data/curriculum/", import.meta.url);
const runtimeModuleUrl = new URL("../../languages/czech/static/curriculum/", import.meta.url);

const runtimeAssets = [
  ...[
    "canonical-curriculum.v1.en.json",
    "cs-CZ.realization-pack.v1.json",
    "pilot-content-sources.v1.json",
    "cs-CZ.cross-game-bindings.v1.json"
  ].map((name) => ({ name, sourceBase: curriculumDataUrl, destinationBase: runtimeDataUrl })),
  ...[
    "curriculum-runtime-core.mjs",
    "curriculum-planner-core.mjs",
    "curriculum-service.mjs",
    "guided-opportunity.mjs"
  ].map((name) => ({ name, sourceBase: curriculumRuntimeUrl, destinationBase: runtimeModuleUrl }))
];

const mismatches = [];
let changed = 0;
if (!checkOnly) await Promise.all([
  mkdir(runtimeDataUrl, { recursive: true }),
  mkdir(runtimeModuleUrl, { recursive: true })
]);

for (const { name, sourceBase, destinationBase } of runtimeAssets) {
  const source = await readFile(new URL(name, sourceBase));
  const destinationUrl = new URL(name, destinationBase);
  let destination = null;
  try {
    destination = await readFile(destinationUrl);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (destination?.equals(source)) continue;
  if (checkOnly) {
    mismatches.push(name);
    continue;
  }
  await writeFile(destinationUrl, source);
  changed += 1;
}

if (mismatches.length) {
  throw new Error(`Runtime curriculum assets are stale or missing: ${mismatches.join(", ")}`);
}

process.stdout.write(checkOnly
  ? `Verified ${runtimeAssets.length} runtime curriculum assets.\n`
  : `Synchronized ${runtimeAssets.length} runtime curriculum assets (${changed} changed).\n`);
