#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "../../..");

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? path.resolve(process.argv[index + 1])
    : fallback;
}

const configPath = argumentValue(
  "--config",
  path.join(workspaceRoot, "tools/on-device-models/model-configs.json")
);
const catalogPath = argumentValue(
  "--catalog",
  path.join(workspaceRoot, "apps/languages/czech/static/data/models/phone-bench/models.json")
);

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} could not be read at ${filePath}: ${error.message}`);
  }
}

function activeConfigEntries(config) {
  return Object.entries(config.models || {}).filter(([, model]) => (
    model?.status === "active" && model?.deprecated !== true
  ));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const config = await readJson(configPath, "Model configuration");
const catalog = await readJson(catalogPath, "Static model catalog");
const configured = activeConfigEntries(config);
const published = Array.isArray(catalog.models) ? catalog.models : [];
const configuredKeys = configured.map(([key]) => key).sort();
const publishedKeys = published.map((model) => String(model?.key || "")).sort();
const supportedPolicies = new Set(["setup_required", "on_demand"]);

assert(
  JSON.stringify(configuredKeys) === JSON.stringify(publishedKeys),
  `Static catalog model keys are stale. Expected ${configuredKeys.join(", ")}; got ${publishedKeys.join(", ")}.`
);
assert(
  catalog.default_model === config.default_model,
  `Static catalog default_model is ${catalog.default_model}; expected ${config.default_model}.`
);

for (const [key, model] of configured) {
  assert(
    supportedPolicies.has(model.install_policy),
    `${key} must declare install_policy as setup_required or on_demand.`
  );
  const entry = published.find((candidate) => candidate.key === key);
  assert(entry, `Static catalog is missing ${key}.`);
  assert(
    entry.install_policy === model.install_policy,
    `${key} install_policy is ${entry.install_policy}; expected ${model.install_policy}.`
  );
  assert(
    entry.intended_use === model.intended_use,
    `${key} intended_use does not match model-configs.json.`
  );
  assert(entry.status === "active" && entry.deprecated !== true, `${key} is not active in the static catalog.`);
  assert(Number(entry.bytes) > 0, `${key} has no published byte size.`);
  assert(/^[a-f0-9]{64}$/i.test(String(entry.sha256 || "")), `${key} has no valid SHA-256.`);
}

console.log(
  `Static model catalog verified: ${published.length} optional model${published.length === 1 ? "" : "s"}; `
  + `${published.filter((model) => model.install_policy === "setup_required").length} setup-required.`
);
