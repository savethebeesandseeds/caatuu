import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { validateCrossGameBindings } from "./cross-game-binding-core.mjs";

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--curriculum") result.curriculumPath = argv[++index];
    else if (token === "--pack") result.packPath = argv[++index];
    else if (token === "--catalog") result.catalogPath = argv[++index];
    else if (token === "--registry") result.registryPath = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return result;
}

async function readJson(path, flag) {
  if (!path) throw new Error(`${flag} is required`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const [curriculum, pack, catalog, registry] = await Promise.all([
    readJson(args.curriculumPath, "--curriculum"),
    readJson(args.packPath, "--pack"),
    readJson(args.catalogPath, "--catalog"),
    readJson(args.registryPath, "--registry")
  ]);
  const result = validateCrossGameBindings(curriculum, pack, catalog, registry);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
