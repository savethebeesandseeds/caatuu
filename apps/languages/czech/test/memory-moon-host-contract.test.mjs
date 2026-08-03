import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../static/", import.meta.url);
const index = await readFile(new URL("index.html", staticRoot), "utf8");
const app = await readFile(new URL("app.js", staticRoot), "utf8");
const chrome = await readFile(new URL("chrome.js", staticRoot), "utf8");
const adapterFileName = "memory-moon.v1.json";
const adapter = JSON.parse(
  await readFile(new URL(`data/game-adapters/${adapterFileName}`, staticRoot), "utf8"),
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the Czech host points at the neutral game route", () => {
  assert.match(
    index,
    /id="memoryMoonGame"[\s\S]*?data-src="\/games\/memory-moon\/godot-v1\/index\.html"/,
  );
});

test("the reviewed adapter presentation mirrors the executable host", () => {
  assert.ok(index.includes(`<h2>${adapter.presentation.title}</h2>`));
  assert.ok(
    index.includes(
      `<p class="memory-moon-copy">${adapter.presentation.description}</p>`,
    ),
  );
  assert.ok(index.includes(`<strong>${adapter.presentation.loading_text}</strong>`));
  assert.match(
    index,
    new RegExp(
      `data-train-tab="${escapeRegExp(adapter.game_id)}"[\\s\\S]{0,240}<img src="${escapeRegExp(adapter.presentation.icon)}"`,
    ),
  );
  assert.match(
    chrome,
    new RegExp(
      `"${escapeRegExp(adapter.game_id)}": \\{[^}]*title: "${escapeRegExp(adapter.presentation.title)}"[^}]*iconSrc: "${escapeRegExp(adapter.presentation.icon)}"`,
    ),
  );
});

test("the Czech adapter is governance metadata, not runtime-loaded authority", () => {
  assert.equal(adapter.scope, "host-presentation-only");
  assert.equal(adapter.language_id, "cz");
  assert.equal(adapter.game_id, "memory-moon");

  const executableHostSources = `${index}\n${app}\n${chrome}`;
  assert.equal(executableHostSources.includes("data/game-adapters/"), false);
  assert.equal(executableHostSources.includes(adapterFileName), false);

  const serialized = JSON.stringify(adapter);
  for (const forbidden of ["artifact_directory", "engine", "source", "docker"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
