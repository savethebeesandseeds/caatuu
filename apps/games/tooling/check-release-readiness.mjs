#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateJsonSchemaSubset } from "./json-schema-subset.mjs";

const modulePath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(modulePath), "..", "..", "..");
const defaultRequiredGameIds = Object.freeze([]);
const gameIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readCheckedJson(filePath, label, blockers) {
  try {
    return await readJson(filePath);
  } catch (error) {
    const reason = error?.code === "ENOENT" ? "is missing" : "is not valid JSON";
    blockers.push(`${label} ${reason}: ${filePath}`);
    return null;
  }
}

function safeRelativePath(value, label) {
  if (typeof value !== "string"
      || value.length === 0
      || path.isAbsolute(value)
      || value.includes("\\")
      || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} is not a safe repository-relative path: ${value}`);
  }
  return value;
}

function schemaBlockers(label, result) {
  return result.errors.map((error) => (
    `${label}: schema ${error.keyword} at ${error.instancePath || "/"}: ${error.message}`
  ));
}

function requireGameIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Release validation requires at least one delivered game ID.");
  }
  const unique = new Set();
  for (const gameId of value) {
    if (typeof gameId !== "string" || !gameIdPattern.test(gameId)) {
      throw new Error(`Invalid delivered game ID: ${gameId}`);
    }
    unique.add(gameId);
  }
  return [...unique].sort();
}

export async function findReleaseBlockers({
  repoRoot = defaultRepoRoot,
  requiredGameIds = defaultRequiredGameIds,
} = {}) {
  const deliveredGameIds = requireGameIds(requiredGameIds);
  const gamesRoot = path.join(repoRoot, "apps", "games");
  const blockers = [];
  const [catalogSchema, manifestSchema] = await Promise.all([
    readJson(path.join(gamesRoot, "schemas", "game-catalog.v1.schema.json")),
    readJson(path.join(gamesRoot, "schemas", "game-manifest.v2.schema.json")),
  ]);
  const catalog = await readCheckedJson(
    path.join(gamesRoot, "catalog.json"),
    "game catalog",
    blockers,
  );
  if (catalog === null) return blockers;

  const catalogResult = validateJsonSchemaSubset(catalogSchema, catalog);
  if (!catalogResult.valid) {
    blockers.push(...schemaBlockers("game catalog", catalogResult));
    return blockers;
  }

  const entriesById = new Map();
  for (const entry of catalog.games) {
    const entries = entriesById.get(entry.id) ?? [];
    entries.push(entry);
    entriesById.set(entry.id, entries);
  }
  for (const gameId of deliveredGameIds) {
    const count = entriesById.get(gameId)?.length ?? 0;
    if (count !== 1) {
      blockers.push(`${gameId}: delivered game must appear exactly once in the catalog; found ${count}`);
    }
  }
  for (const [gameId, entries] of entriesById) {
    if (entries.length > 1) {
      blockers.push(`${gameId}: catalog contains ${entries.length} entries with the same game ID`);
    }
  }

  for (const entry of catalog.games) {
    let manifestRelativePath;
    try {
      manifestRelativePath = safeRelativePath(entry.manifest, `${entry.id} manifest`);
    } catch (error) {
      blockers.push(error.message);
      continue;
    }
    const manifestPath = path.join(gamesRoot, manifestRelativePath);
    const manifest = await readCheckedJson(manifestPath, `${entry.id} manifest`, blockers);
    if (manifest === null) continue;

    const manifestResult = validateJsonSchemaSubset(manifestSchema, manifest);
    if (!manifestResult.valid) {
      blockers.push(...schemaBlockers(`${entry.id} manifest`, manifestResult));
      continue;
    }
    if (manifest.id !== entry.id) {
      blockers.push(`${entry.id}: catalog and manifest identities disagree`);
    }
    if (manifest.release_status !== "released") {
      blockers.push(`${entry.id}: release_status is ${manifest.release_status}`);
    }

    for (const dependency of manifest.dependencies) {
      if (dependency.status !== "active") {
        blockers.push(`${entry.id}/${dependency.id}: dependency status is ${dependency.status}`);
      }

      let authorityRelativePath;
      try {
        authorityRelativePath = safeRelativePath(
          dependency.authority,
          `${entry.id}/${dependency.id} authority`,
        );
      } catch (error) {
        blockers.push(error.message);
        continue;
      }
      if (!authorityRelativePath.endsWith(".json")) {
        blockers.push(`${entry.id}/${dependency.id}: authority is not machine-readable JSON`);
        continue;
      }
      const authorityPath = path.join(repoRoot, authorityRelativePath);
      const authority = await readCheckedJson(
        authorityPath,
        `${entry.id}/${dependency.id} authority`,
        blockers,
      );
      if (authority === null) continue;
      if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
        blockers.push(`${entry.id}/${dependency.id}: authority must contain a JSON object`);
        continue;
      }

      const authorityId = typeof authority.id === "string"
        ? authority.id
        : typeof authority.package_id === "string"
          ? authority.package_id
          : null;
      if (authorityId === null) {
        blockers.push(`${entry.id}/${dependency.id}: authority has no id or package_id`);
      } else if (authorityId !== dependency.id) {
        blockers.push(`${entry.id}/${dependency.id}: authority identity is ${authorityId}`);
      }

      if (authority.release_status !== "released") {
        blockers.push(
          `${entry.id}/${dependency.id}: authority release_status is ${authority.release_status ?? "<missing>"}`,
        );
      }
      if (Object.hasOwn(authority, "distribution_status")
          && authority.distribution_status !== "distributed") {
        blockers.push(
          `${entry.id}/${dependency.id}: authority distribution_status is ${authority.distribution_status}`,
        );
      }
    }
  }

  return blockers;
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArguments(argv) {
  let repoRoot = defaultRepoRoot;
  let surface = "public-distribution";
  const requiredGameIds = new Set(defaultRequiredGameIds);

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--surface") {
      surface = optionValue(argv, index, option);
      index += 1;
    } else if (option === "--repo-root") {
      repoRoot = path.resolve(optionValue(argv, index, option));
      index += 1;
    } else if (option === "--require-game") {
      requiredGameIds.add(optionValue(argv, index, option));
      index += 1;
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(surface)) {
    throw new Error(`Invalid release surface: ${surface}`);
  }
  return { repoRoot, surface, requiredGameIds: [...requiredGameIds] };
}

async function main() {
  const { repoRoot, surface, requiredGameIds } = parseArguments(process.argv.slice(2));
  const blockers = await findReleaseBlockers({ repoRoot, requiredGameIds });
  if (blockers.length > 0) {
    console.error(`Refusing ${surface}; the game catalog is not release-ready:`);
    for (const blocker of blockers) console.error(`- ${blocker}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Game catalog is release-ready for ${surface}.`);
}

if (process.argv[1]
    && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`Release readiness validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
