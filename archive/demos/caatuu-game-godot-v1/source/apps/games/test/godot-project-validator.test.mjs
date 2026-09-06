import assert from "node:assert/strict";
import test from "node:test";

import {
  GODOT_PROJECT_ISSUE_CODES,
  loadGodotProjectSources,
  validateGodotProject,
  validateGodotProjectSources,
} from "../tooling/validate-godot-project.mjs";

test("the Godot project, resources, Web preset, and real engine evidence pipeline agree", async () => {
  const report = await validateGodotProject();
  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
  assert.deepEqual(report.facts.evidenceSteps, [
    "import",
    "scenery",
    "movement",
    "responsive",
    "costume-fallback",
    "smoke",
    "export",
  ]);
});

test("the validator rejects renderer drift and unsafe resource traversal", async () => {
  const { sources } = await loadGodotProjectSources();
  const mutated = {
    ...sources,
    project: sources.project
      .replace('renderer/rendering_method="gl_compatibility"', 'renderer/rendering_method="forward_plus"')
      .replace('run/main_scene="res://main.tscn"', 'run/main_scene="res://../main.tscn"'),
  };
  const report = validateGodotProjectSources(mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(({ code }) => code === GODOT_PROJECT_ISSUE_CODES.CONTRACT_MISMATCH));
  assert.ok(report.issues.some(({ code }) => code === GODOT_PROJECT_ISSUE_CODES.RESOURCE_UNSAFE));
});

test("the validator rejects removal of a real engine evidence step", async () => {
  const { sources } = await loadGodotProjectSources();
  const mutated = {
    ...sources,
    exporter: sources.exporter.replace("run_godot_checked movement \\", "run_godot_skipped movement \\")
  };
  const report = validateGodotProjectSources(mutated);
  assert.equal(report.valid, false);
  assert.ok(report.issues.some(({ code }) => code === GODOT_PROJECT_ISSUE_CODES.PIPELINE_MISMATCH));
});
