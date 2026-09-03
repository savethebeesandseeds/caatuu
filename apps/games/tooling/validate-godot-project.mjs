import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

export const GODOT_PROJECT_ISSUE_CODES = Object.freeze({
  FILE_MISSING: "file.missing",
  CONFIG_INVALID: "config.invalid",
  CONTRACT_MISMATCH: "contract.mismatch",
  RESOURCE_UNSAFE: "resource.unsafe",
  RESOURCE_MISSING: "resource.missing",
  PIPELINE_MISMATCH: "pipeline.mismatch",
});

export const GODOT_PROJECT_SOURCE_FILES = Object.freeze({
  manifest: "apps/games/caatuu-game/game.json",
  project: "apps/games/caatuu-game/project.godot",
  mainScene: "apps/games/caatuu-game/main.tscn",
  exportPreset: "apps/games/caatuu-game/export_presets.cfg",
  exporter: "apps/games/caatuu-game/tooling/export-web.sh",
});

export const GODOT_ENGINE_EVIDENCE_STEPS = Object.freeze([
  "import",
  "scenery",
  "movement",
  "responsive",
  "costume-fallback",
  "smoke",
  "export",
]);

const GODOT_ENGINE_EVIDENCE_SCRIPTS = Object.freeze([
  "res://tooling/verify-world-scenery.gd",
  "res://tooling/verify-movement.gd",
  "res://tooling/verify-responsive-layout.gd",
  "res://tooling/verify-macaw-costume.gd",
]);

function addIssue(issues, code, file, message) {
  issues.push({ code, file, message });
}

function finishReport(issues, facts = {}) {
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
    facts: Object.freeze(facts),
  });
}

function parseGodotConfig(source, file, issues) {
  const sections = new Map();
  let current = "";
  sections.set(current, new Map());
  for (const [index, rawLine] of source.replaceAll("\r\n", "\n").split("\n").entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;
    const sectionMatch = /^\[([^\]]+)\]$/u.exec(line);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections.has(current)) sections.set(current, new Map());
      continue;
    }
    const separator = line.indexOf("=");
    if (separator <= 0) {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.CONFIG_INVALID,
        file,
        `line ${index + 1} is not a section or key/value entry`,
      );
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    const values = sections.get(current);
    if (values.has(key)) {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.CONFIG_INVALID,
        file,
        `duplicate ${current}/${key}`,
      );
    }
    values.set(key, value);
  }
  return sections;
}

function configValue(config, section, key) {
  return config.get(section)?.get(key);
}

function quoted(value) {
  if (typeof value !== "string" || !/^"(?:[^"\\]|\\.)*"$/u.test(value)) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function requireEqual(issues, file, label, actual, expected) {
  if (actual !== expected) {
    addIssue(
      issues,
      GODOT_PROJECT_ISSUE_CODES.CONTRACT_MISMATCH,
      file,
      `${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}`,
    );
  }
}

function resourcePath(value, file, issues) {
  if (typeof value !== "string" || !value.startsWith("res://")) {
    addIssue(issues, GODOT_PROJECT_ISSUE_CODES.RESOURCE_UNSAFE, file, `invalid resource path: ${value}`);
    return undefined;
  }
  const relative = value.slice("res://".length);
  if (
    !relative
    || relative.includes("\\")
    || relative.startsWith("/")
    || relative.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    addIssue(issues, GODOT_PROJECT_ISSUE_CODES.RESOURCE_UNSAFE, file, `unsafe resource path: ${value}`);
    return undefined;
  }
  return relative;
}

function sceneResourcePaths(scene) {
  return [...scene.matchAll(/^\[ext_resource\b[^\]]*\bpath="([^"]+)"[^\]]*\]$/gmu)]
    .map((match) => match[1]);
}

function parseManifest(source, file, issues) {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("root must be an object");
    return value;
  } catch (error) {
    addIssue(issues, GODOT_PROJECT_ISSUE_CODES.CONFIG_INVALID, file, error.message);
    return {};
  }
}

function validateEvidencePipeline(exporter, issues) {
  const normalized = exporter.replaceAll("\r\n", "\n");
  const steps = [...normalized.matchAll(/^run_godot_checked[ \t]+([a-z-]+)[ \t]+\\$/gmu)]
    .map((match) => match[1]);
  if (
    steps.length !== GODOT_ENGINE_EVIDENCE_STEPS.length
    || steps.some((step, index) => step !== GODOT_ENGINE_EVIDENCE_STEPS[index])
  ) {
    addIssue(
      issues,
      GODOT_PROJECT_ISSUE_CODES.PIPELINE_MISMATCH,
      GODOT_PROJECT_SOURCE_FILES.exporter,
      `expected ${GODOT_ENGINE_EVIDENCE_STEPS.join(" -> ")}; found ${steps.join(" -> ")}`,
    );
  }
  for (const script of GODOT_ENGINE_EVIDENCE_SCRIPTS) {
    if (!normalized.includes(`--script ${script}`)) {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.PIPELINE_MISMATCH,
        GODOT_PROJECT_SOURCE_FILES.exporter,
        `engine evidence does not invoke ${script}`,
      );
    }
  }
  for (const contract of [
    "--quit-after 4",
    '--export-release "Web"',
    "SCRIPT ERROR|ERROR",
    "godot --headless --version",
  ]) {
    if (!normalized.includes(contract)) {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.PIPELINE_MISMATCH,
        GODOT_PROJECT_SOURCE_FILES.exporter,
        `engine evidence is missing ${contract}`,
      );
    }
  }
  return steps;
}

export function validateGodotProjectSources(sources) {
  const issues = [];
  for (const name of Object.keys(GODOT_PROJECT_SOURCE_FILES)) {
    if (typeof sources[name] !== "string") {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.FILE_MISSING,
        GODOT_PROJECT_SOURCE_FILES[name],
        "source was not provided",
      );
    }
  }
  const manifest = parseManifest(
    sources.manifest ?? "{}",
    GODOT_PROJECT_SOURCE_FILES.manifest,
    issues,
  );
  const project = parseGodotConfig(
    sources.project ?? "",
    GODOT_PROJECT_SOURCE_FILES.project,
    issues,
  );
  const preset = parseGodotConfig(
    sources.exportPreset ?? "",
    GODOT_PROJECT_SOURCE_FILES.exportPreset,
    issues,
  );

  const mainScene = quoted(configValue(project, "application", "run/main_scene"));
  const mainScenePath = resourcePath(mainScene, GODOT_PROJECT_SOURCE_FILES.project, issues);
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "application name", quoted(configValue(project, "application", "config/name")), "Caatuu Game");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "main scene", mainScene, "res://main.tscn");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "desktop renderer", quoted(configValue(project, "rendering", "renderer/rendering_method")), "gl_compatibility");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "mobile renderer", quoted(configValue(project, "rendering", "renderer/rendering_method.mobile")), "gl_compatibility");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "stretch mode", quoted(configValue(project, "display", "window/stretch/mode")), "canvas_items");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.project, "stretch aspect", quoted(configValue(project, "display", "window/stretch/aspect")), "expand");

  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "game engine", manifest.engine?.name, "godot");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "game engine version", manifest.engine?.version, "4.7.1");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "game renderer", manifest.engine?.renderer, "gl_compatibility");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "game threading", manifest.engine?.threading, "single");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "project authority", manifest.source?.project, GODOT_PROJECT_SOURCE_FILES.project);
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "browser delivery", manifest.platforms?.browser, true);
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "Android exclusion", manifest.platforms?.android, false);
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.manifest, "standalone browser mode", manifest.browser_mode, "standalone");

  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.exportPreset, "export preset", quoted(configValue(preset, "preset.0", "name")), manifest.engine?.export_preset);
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.exportPreset, "export platform", quoted(configValue(preset, "preset.0", "platform")), "Web");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.exportPreset, "thread support", configValue(preset, "preset.0.options", "variant/thread_support"), "false");
  requireEqual(issues, GODOT_PROJECT_SOURCE_FILES.exportPreset, "export path", quoted(configValue(preset, "preset.0", "export_path")), "build/web/index.html");

  const sceneReferences = sceneResourcePaths(sources.mainScene ?? "")
    .map((value) => resourcePath(value, GODOT_PROJECT_SOURCE_FILES.mainScene, issues))
    .filter(Boolean);
  const evidenceSteps = validateEvidencePipeline(sources.exporter ?? "", issues);
  const evidenceReferences = GODOT_ENGINE_EVIDENCE_SCRIPTS
    .map((value) => resourcePath(value, GODOT_PROJECT_SOURCE_FILES.exporter, issues))
    .filter(Boolean);
  const resourcePaths = [...new Set([mainScenePath, ...sceneReferences, ...evidenceReferences].filter(Boolean))];

  return finishReport(issues, { mainScene: mainScenePath, resourcePaths, evidenceSteps });
}

export async function loadGodotProjectSources({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const entries = await Promise.all(
    Object.entries(GODOT_PROJECT_SOURCE_FILES).map(async ([name, relativePath]) => {
      try {
        return [name, await readFile(path.join(resolvedRoot, relativePath), "utf8"), null];
      } catch (error) {
        return [name, undefined, error];
      }
    }),
  );
  const sources = {};
  const issues = [];
  for (const [name, source, error] of entries) {
    if (error) {
      addIssue(issues, GODOT_PROJECT_ISSUE_CODES.FILE_MISSING, GODOT_PROJECT_SOURCE_FILES[name], error.message);
    } else {
      sources[name] = source;
    }
  }
  return { sources, issues, repoRoot: resolvedRoot };
}

export async function validateGodotProject(options = {}) {
  const loaded = await loadGodotProjectSources(options);
  const sourceReport = validateGodotProjectSources(loaded.sources);
  const issues = [...loaded.issues, ...sourceReport.issues];
  const gameRoot = path.join(loaded.repoRoot, "apps/games/caatuu-game");
  for (const relativePath of sourceReport.facts.resourcePaths ?? []) {
    try {
      const metadata = await stat(path.join(gameRoot, relativePath));
      if (!metadata.isFile()) throw new TypeError("resource is not a regular file");
    } catch (error) {
      addIssue(
        issues,
        GODOT_PROJECT_ISSUE_CODES.RESOURCE_MISSING,
        `apps/games/caatuu-game/${relativePath}`,
        error.message,
      );
    }
  }
  return finishReport(issues, sourceReport.facts);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const report = await validateGodotProject();
  if (!report.valid) {
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Godot project contract is valid; engine evidence: ${report.facts.evidenceSteps.join(", ")}.\n`);
  }
}
