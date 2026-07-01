#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson } from "./jsonl.mjs";
import { mlModelsRoot } from "./paths.mjs";

const tokenizerFiles = [
  "tokenizer.json",
  "vocab.json",
  "merges.txt",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "added_tokens.json",
  "chat_template.jinja"
];

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source, target) {
  if (!(await exists(source))) return false;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
  return true;
}

async function linkOrCopy(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await exists(target)) await fs.rm(target, { force: true });
  try {
    await fs.link(source, target);
    return "hardlink";
  } catch {
    await fs.copyFile(source, target);
    return "copy";
  }
}

function resolveRun(spec, runId) {
  const run = spec.runs.find((item) => item.id === runId);
  if (!run) throw new Error(`Unknown run id ${runId}. Known: ${spec.runs.map((item) => item.id).join(", ")}`);
  return run;
}

const runId = arg("--run-id");
const forceConfig = process.argv.includes("--force-config");
const spec = await readJson(path.join(mlModelsRoot, "export-spec.json"));
const run = resolveRun(spec, runId || spec.default_run_id);

const mergedDir = path.join(mlModelsRoot, run.merged_hf_dir);
const modelDir = path.join(mlModelsRoot, run.webllm.model_dir);
const revision = run.webllm.servable_revision || "main";
const serveDir = path.join(modelDir, "resolve", revision);

const copiedTokenizers = [];
for (const file of tokenizerFiles) {
  if (await copyIfExists(path.join(mergedDir, file), path.join(modelDir, file))) {
    copiedTokenizers.push(file);
  }
}

const configPath = path.join(modelDir, "mlc-chat-config.json");
let config = { status: "kept-existing", path: "mlc-chat-config.json" };
if (!(await exists(configPath)) || forceConfig) {
  const reuse = run.webllm.reuse_prebuilt_model_lib_from;
  if (reuse) {
    const url = `https://huggingface.co/mlc-ai/${reuse}/resolve/main/mlc-chat-config.json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
    const data = await response.json();
    data.conv_template ??= {};
    data.conv_template.name = run.webllm.conv_template || data.conv_template.name;
    data.conv_template.system_template = "";
    data.conv_template.system_message = "";
    data.conv_template.add_role_after_system_message = false;
    data.model_type = "qwen3";
    data.quantization = run.webllm.quantization;
    await writeJson(configPath, data);
    config = { status: "installed-prebuilt", source: url, path: "mlc-chat-config.json", system_prompt_removed: true };
  } else {
    config = { status: "skipped-no-prebuilt-source" };
  }
}

await fs.mkdir(serveDir, { recursive: true });
const entries = await fs.readdir(modelDir, { withFileTypes: true });
const hardlinkedFiles = [];
const copiedFiles = [];
const skippedDirectories = [];
for (const entry of entries) {
  if (entry.isDirectory()) {
    if (entry.name !== "resolve") skippedDirectories.push(entry.name);
    continue;
  }
  const method = await linkOrCopy(path.join(modelDir, entry.name), path.join(serveDir, entry.name));
  if (method === "hardlink") hardlinkedFiles.push(entry.name);
  else copiedFiles.push(entry.name);
}

const serveEntries = await fs.readdir(serveDir).catch(() => []);
const report = {
  run_id: run.id,
  model_id: run.webllm.model_id,
  model_dir: run.webllm.model_dir,
  servable_model_dir: `${run.webllm.model_dir}/resolve/${revision}`,
  copied_tokenizer_files: copiedTokenizers,
  config,
  servable_view: {
    status: "ready",
    path: `resolve/${revision}`,
    hardlinked_files: hardlinkedFiles,
    copied_files: copiedFiles,
    skipped_directories: skippedDirectories
  },
  required_files: {
    mlc_chat_config: serveEntries.includes("mlc-chat-config.json"),
    tensor_cache: serveEntries.includes("tensor-cache.json"),
    params_shards: serveEntries.filter((name) => /^params_shard_.*\.bin$/.test(name)).sort()
  }
};

await writeJson(path.join(modelDir, "finalize-report.json"), report);
await linkOrCopy(path.join(modelDir, "finalize-report.json"), path.join(serveDir, "finalize-report.json"));
console.log(JSON.stringify(report, null, 2));
