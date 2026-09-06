import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const readText = (path) => readFile(new URL(path, repoRoot), "utf8");
const [catalog, concept, compose, launcher] = await Promise.all([
  readText("apps/games/catalog.json").then(JSON.parse),
  readText("apps/games/lab/concept.json").then(JSON.parse),
  readText("compose.yaml"),
  readText("apps/launcher/static/index.html"),
]);

test("the paused adventure has no deliverable game entry or application launch link", async () => {
  assert.deepEqual(catalog.games, []);
  assert.equal(concept.status, "paused");
  assert.deepEqual(concept.delivery, {
    local_review_only: true, application: false, android: false, public_static_host: false,
  });
  assert.doesNotMatch(launcher, /href=["'][^"']*\/games\//);
  const base = new URL("apps/games/lab/", repoRoot);
  for (const path of Object.values(concept.sources)) await access(new URL(path, base));
  await assert.rejects(access(new URL("apps/games/caatuu-game/project.godot", repoRoot)), { code: "ENOENT" });
  await assert.rejects(access(new URL("apps/games/caatuu-game/game.json", repoRoot)), { code: "ENOENT" });
});

test("the existing local service gates labs without activating archived export services", () => {
  assert.match(compose, /^name: caatuu$/m);
  assert.match(compose, /ENABLE_CAATUU_GAME_PREVIEW/);
  assert.doesNotMatch(compose, /caatuu-game-godot-(?:export|provision):/);
  assert.doesNotMatch(compose, /caatuu-godot-web-toolchain/);
});

test("the legacy archive preserves every recorded source blob", async () => {
  const base = new URL("archive/demos/caatuu-game-godot-v1/", repoRoot);
  const archive = JSON.parse(await readFile(new URL("archive.json", base), "utf8"));
  assert.equal(archive.source_checkpoint, concept.retired_prototype.source_checkpoint);
  assert.equal(archive.files.length, 23);
  assert.equal(new Set(archive.files.map((file) => file.original_path)).size, archive.files.length);
  for (const file of archive.files) {
    // These are text sources; compare Git blobs independently of checkout line endings.
    const text = await readFile(new URL(file.archived_path, base), "utf8");
    const bytes = Buffer.from(text.replace(/\r\n/g, "\n"));
    const hash = createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
    assert.equal(hash, file.git_blob, file.original_path);
  }
  const archivedCompose = await readFile(new URL("compose.godot.yaml", base), "utf8");
  assert.match(archivedCompose, /caatuu-game-godot-export:/);
  assert.match(archivedCompose, /caatuu-game-godot-provision:/);
});
