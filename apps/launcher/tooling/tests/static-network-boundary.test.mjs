import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertStaticNetworkBoundary,
  assertWordWorldRuntimeBoundary
} from "../build-static-site.mjs";

const fixtures = [
  {
    name: "remote JavaScript module",
    path: "main.mjs",
    source: 'import "https://cdn.example.invalid/module.mjs";\n'
  },
  {
    name: "remote HTML script",
    path: "index.html",
    source: '<!doctype html><script src="https://cdn.example.invalid/app.js"></script>\n'
  },
  {
    name: "remote CSS asset",
    path: "app.css",
    source: '.hero { background-image: url("https://cdn.example.invalid/hero.png"); }\n'
  },
  {
    name: "remote web-manifest icon",
    path: "manifest.webmanifest",
    source: '{"name":"Fixture","icons":[{"src":"https://cdn.example.invalid/icon.png"}]}\n'
  }
];

for (const fixture of fixtures) {
  test(`static boundary rejects ${fixture.name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "caatuu-static-network-"));
    try {
      writeFileSync(join(root, fixture.path), fixture.source, "utf8");
      assert.throws(
        () => assertStaticNetworkBoundary(root, [fixture.path]),
        /requires a network resource/u
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("static boundary rejects a missing local runtime resource", () => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-static-network-"));
  try {
    writeFileSync(join(root, "main.js"), 'fetch("./missing.json");\n', "utf8");
    assert.throws(
      () => assertStaticNetworkBoundary(root, ["main.js"]),
      /missing runtime resource/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Word World runtime manifest rejects a data-driven remote corpus", () => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-static-network-"));
  const manifestDir = join(root, "cz/data/games/word-world");
  try {
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, "manifest.json"),
      `${JSON.stringify({
        schemaVersion: "caatuu-word-world-runtime-manifest-v1",
        mode: "standard",
        runtimeFile: "https://cdn.example.invalid/records.json"
      })}\n`,
      "utf8"
    );
    assert.throws(
      () => assertWordWorldRuntimeBoundary(root),
      /requires a network resource/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
