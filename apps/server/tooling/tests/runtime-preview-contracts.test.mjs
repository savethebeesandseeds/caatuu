import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { standalonePreviewIssues } from "../runtime-preview-contracts.mjs";

const root = new URL("../../../../", import.meta.url);
const routesSource = readFileSync(new URL("apps/server/src/routes/mod.rs", root), "utf8");
const composeSource = readFileSync(new URL("compose.yaml", root), "utf8");
const issues = (routes = routesSource, compose = composeSource) => standalonePreviewIssues({ routesSource: routes, composeSource: compose });
const mount = 'router.nest("/games", game_lab::build_router(&workspace))';

test("current source retains only gated labs and retired Godot services stay inactive", () => {
  assert.deepEqual(issues(), []);
});

test("a lab mount escaping the gate cannot be justified by the old gate text", () => {
  const moved = routesSource.replace(mount, "router").replace("let router = mounted_language_apps", `let router = ${mount};\n    let router = mounted_language_apps`);
  assert.ok(issues(moved).some((message) => message.includes("enabled preview branch")));
  const ungated = routesSource.replace("if features.caatuu_game_preview {", "if true {");
  assert.ok(issues(ungated).some((message) => message.includes("enabled preview branch")));
  const inverted = routesSource.replace("if features.caatuu_game_preview {", "if !features.caatuu_game_preview {");
  assert.ok(issues(inverted).some((message) => message.includes("enabled preview branch")));
});

test("a second default mount and a mount in the disabled branch are rejected", () => {
  const duplicate = routesSource.replace("let router = mounted_language_apps", `let router = ${mount};\n    let router = mounted_language_apps`);
  assert.ok(issues(duplicate).some((message) => message.includes("exactly once")));
  const disabledBranch = `fn router() { if features.caatuu_game_preview { router } else { ${mount} } }`;
  assert.ok(issues(disabledBranch).some((message) => message.includes("enabled preview branch")));
});

test("comments and test-only routes cannot satisfy or break the production contract", () => {
  const fake = `// if features.caatuu_game_preview { ${mount} }\nfn router() { ${mount} }`;
  assert.ok(issues(fake).some((message) => message.includes("enabled preview branch")));
  const comments = routesSource.replace(mount, `/* { retired nested comment /* } */ } */ ${mount}`);
  assert.deepEqual(issues(comments), []);
  assert.deepEqual(issues(`${routesSource}\n// .nest(\"/games/caatuu-game/\", retired)`), []);
  assert.deepEqual(issues(routesSource, `${composeSource}\n# caatuu-game-godot-export:\n# - caatuu-godot-web-toolchain:/toolchain`), []);
});

test("retired entries and artifact mounts fail even while the retained lab gate is intact", () => {
  for (const reference of [
    '"/games/caatuu-game/"',
    '"/caatuu-game/godot-v1"',
    'r#"artifacts/games/caatuu-game/web/godot-v1"#',
  ]) {
    assert.ok(issues(`const RETIRED: &str = ${reference};\n${routesSource}`).some((message) => message.includes("retired Godot game entries")));
  }
});

test("retired exporter services and output/toolchain mounts cannot return to active Compose", () => {
  for (const service of ["caatuu-game-godot-export", "caatuu-game-godot-provision"]) {
    assert.ok(issues(routesSource, `${composeSource}\n  '${service}':\n    image: old`).some((message) => message.includes("export or provisioning services")));
  }
  for (const mount of [
    "./artifacts/games/caatuu-game/web/godot-v1:/output",
    "caatuu-godot-web-toolchain-4-7-1:/toolchain:ro",
  ]) {
    assert.ok(issues(routesSource, `${composeSource}\n    volumes:\n      - ${mount}`).some((message) => message.includes("export mounts or toolchain volumes")));
  }
});

test("local preview receives both canonical source roots read-only from its own service", () => {
  for (const source of ["apps/games/lab", "apps/games/caatuu-game/character-workshop"]) {
    const mount = `./${source}:/workspace/${source}:ro`;
    const missing = composeSource.replace(`      - ${mount}`, "");
    assert.ok(issues(routesSource, missing).some((message) => message.includes(`mount ${source} read-only`)));
    const writable = composeSource.replace(mount, mount.slice(0, -3));
    assert.ok(issues(routesSource, writable).some((message) => message.includes(`mount ${source} read-only`)));
    const wrongTarget = composeSource.replace(mount, `./${source}:/elsewhere:ro`);
    assert.ok(issues(routesSource, wrongTarget).some((message) => message.includes(`mount ${source} read-only`)));
    const anotherService = `${missing}\n  unrelated-service:\n    volumes:\n      - ${mount}\n`;
    assert.ok(issues(routesSource, anotherService).some((message) => message.includes(`mount ${source} read-only`)));
    const configurableOff = missing.replace("CAATUU_ENABLE_CAATUU_GAME_PREVIEW:-1", "CAATUU_ENABLE_CAATUU_GAME_PREVIEW:-0");
    assert.ok(issues(routesSource, configurableOff).some((message) => message.includes(`mount ${source} read-only`)));
  }
});

test("a service with preview explicitly disabled does not require art source mounts", () => {
  const disabled = composeSource
    .replace(/ENABLE_CAATUU_GAME_PREVIEW:.*$/mu, 'ENABLE_CAATUU_GAME_PREVIEW: "0"')
    .replace(/^\s+- \.\/apps\/games\/.*$/gmu, "");
  assert.deepEqual(issues(routesSource, disabled), []);
});
