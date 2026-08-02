import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { tryCompileDictionaryPatch } from "../../../apps/languages/czech/static/dictionary-patch-core.mjs";

const defaultPatchUrl = new URL(
  "../../../apps/languages/czech/static/data/dictionaries/patches/reviewed-cs-en.v1.json",
  import.meta.url
);
const defaultCatalogUrl = new URL(
  "../../../apps/languages/czech/static/data/dictionaries/catalog.json",
  import.meta.url
);
const runtimeUrl = new URL("../../../apps/languages/czech/static/runtime.js", import.meta.url);
const serviceWorkerUrl = new URL("../../../apps/languages/czech/static/sw.js", import.meta.url);

function patchPathFromArgs(args) {
  const optionIndex = args.indexOf("--patch");
  if (optionIndex < 0) return fileURLToPath(defaultPatchUrl);
  const value = String(args[optionIndex + 1] || "").trim();
  if (!value) throw new Error("--patch requires a JSON file path.");
  return value;
}

function optionValue(args, name) {
  const optionIndex = args.indexOf(name);
  if (optionIndex < 0) return "";
  const value = String(args[optionIndex + 1] || "").trim();
  if (!value) throw new Error(`${name} requires a file path.`);
  return value;
}

function exactCzech(value) {
  return String(value || "").normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("cs-CZ");
}

function foldedCzech(value) {
  return exactCzech(value).normalize("NFD").replace(/\p{M}/gu, "");
}

export function dictionaryPatchDigest(raw) {
  const { digest: _ignoredDigest, ...content } = raw;
  const hex = createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex");
  return `sha256-${hex}`;
}

async function databasePathFromArgs(args, dictionaryKey) {
  const explicit = optionValue(args, "--database");
  if (explicit) return resolve(explicit);

  const catalog = JSON.parse(await readFile(defaultCatalogUrl, "utf8"));
  const descriptor = catalog?.dictionaries?.find((item) => item?.key === dictionaryKey);
  if (!descriptor?.database_file) {
    throw new Error(`Dictionary ${dictionaryKey} has no database_file in the catalog.`);
  }
  return fileURLToPath(new URL(descriptor.database_file, defaultCatalogUrl));
}

export function validatePatchAgainstDatabase(patch, database) {
  const errors = [];
  const targetById = database.prepare("SELECT id, lemma, pos FROM entries WHERE id = ?1");
  const coveredSearchTerm = database.prepare(
    "SELECT term, kind FROM search_terms WHERE entry_id = ?1 AND normalized = ?2 LIMIT 5"
  );
  const baseLemma = database.prepare(
    `SELECT
       entries.id,
       entries.lemma,
       entries.pos,
       EXISTS(
         SELECT 1 FROM senses
         WHERE senses.entry_id = entries.id AND trim(senses.gloss) <> ''
       ) AS has_usable_sense
     FROM entries
     WHERE entries.lemma_normalized = ?1 AND lower(entries.pos) = ?2`
  );

  for (const entry of patch.entries) {
    const existing = baseLemma
      .all(foldedCzech(entry.lemma), exactCzech(entry.pos))
      .find((candidate) => exactCzech(candidate.lemma) === exactCzech(entry.lemma) && candidate.has_usable_sense);
    if (existing) {
      errors.push(
        `${entry.id} is not a missing entry; base entry ${existing.id} already covers ${entry.lemma}/${entry.pos}.`
      );
    }
  }

  for (const alias of patch.aliases) {
    const target = targetById.get(alias.target.entryId);
    if (!target) {
      errors.push(`${alias.id} targets missing base entry ${alias.target.entryId}.`);
      continue;
    }
    if (exactCzech(target.lemma) !== exactCzech(alias.target.lemma) || exactCzech(target.pos) !== exactCzech(alias.target.pos)) {
      errors.push(
        `${alias.id} target metadata does not match base entry ${alias.target.entryId} (${target.lemma}/${target.pos}).`
      );
      continue;
    }
    const existingTerms = coveredSearchTerm.all(alias.target.entryId, foldedCzech(alias.form));
    if (existingTerms.length) {
      errors.push(
        `${alias.id} is redundant; base entry ${alias.target.entryId} already indexes “${existingTerms[0].term}” as ${existingTerms[0].kind}.`
      );
    }
  }
  return errors;
}

async function validateRevisionReferences(patch) {
  const [runtime, serviceWorker] = await Promise.all([
    readFile(runtimeUrl, "utf8"),
    readFile(serviceWorkerUrl, "utf8")
  ]);
  const versionedPath = `data/dictionaries/patches/reviewed-cs-en.v1.json?v=${patch.digest}`;
  const errors = [];
  if (!runtime.includes(`const dictionaryPatchPath = "${versionedPath}";`)) {
    errors.push(`runtime.js must reference ${versionedPath}.`);
  }
  if (!serviceWorker.includes(`"./${versionedPath}"`)) {
    errors.push(`sw.js must precache ./${versionedPath}.`);
  }
  return errors;
}

async function main() {
  const args = process.argv.slice(2);
  const patchPath = patchPathFromArgs(args);
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

  const databasePath = await databasePathFromArgs(args, compiled.patch.dictionaryKey);
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  let semanticErrors;
  try {
    semanticErrors = validatePatchAgainstDatabase(compiled.patch, database);
  } finally {
    database.close();
  }
  const computedDigest = dictionaryPatchDigest(raw);
  if (compiled.patch.digest !== computedDigest) {
    semanticErrors.push(`$.digest must be ${computedDigest} for the current patch content.`);
  }
  semanticErrors.push(...await validateRevisionReferences(compiled.patch));
  if (semanticErrors.length) {
    for (const error of semanticErrors) process.stderr.write(`- ${error}\n`);
    throw new Error(`Dictionary patch validation failed with ${semanticErrors.length} base/runtime error(s).`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    patch: patchPath,
    schema: compiled.patch.schema,
    revision: compiled.patch.revision,
    dictionaryKey: compiled.patch.dictionaryKey,
    database: databasePath,
    entries: compiled.patch.entries.length,
    formAliases: compiled.patch.aliases.length
  }, null, 2)}\n`);
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
