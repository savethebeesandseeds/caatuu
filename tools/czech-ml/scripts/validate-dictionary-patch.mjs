import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { tryCompileDictionaryPatch } from "../../../apps/languages/czech/static/dictionary-patch-core.mjs";

const defaultPatchUrl = new URL(
  "../../../apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json",
  import.meta.url
);

function patchPathFromArgs(args) {
  const optionIndex = args.indexOf("--patch");
  if (optionIndex < 0) return fileURLToPath(defaultPatchUrl);
  const value = String(args[optionIndex + 1] || "").trim();
  if (!value) throw new Error("--patch requires a JSON file path.");
  return value;
}

async function main() {
  const patchPath = patchPathFromArgs(process.argv.slice(2));
  let raw;
  try {
    raw = JSON.parse(await readFile(patchPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read dictionary patch ${patchPath}: ${error.message}`);
  }

  const compiled = tryCompileDictionaryPatch(raw);
  if (!compiled.ok) {
    for (const error of compiled.errors) process.stderr.write(`- ${error}\n`);
    throw new Error(`Dictionary patch validation failed with ${compiled.errors.length} error(s).`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    patch: patchPath,
    schema: compiled.patch.schema,
    dictionaryKey: compiled.patch.dictionaryKey,
    entries: compiled.patch.entries.length,
    formAliases: compiled.patch.aliases.length
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`error: ${error.message}\n`);
  process.exitCode = 1;
});
