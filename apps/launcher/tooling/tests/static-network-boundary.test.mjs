import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertStaticNetworkBoundary,
  transformStaticFeedbackOutbox,
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
      () => assertWordWorldRuntimeBoundary(root, "/cz"),
      /requires a network resource/u
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only declared landing-page course links may wait for final Pages staging", () => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-static-network-"));
  const options = { deferredCourseEntries: ["/es/index.html"] };
  try {
    writeFileSync(join(root, "index.html"), '<a href="/es/index.html">Spanish</a>');
    assert.doesNotThrow(() => assertStaticNetworkBoundary(root, ["index.html"], options));
    assert.throws(() => assertStaticNetworkBoundary(root, ["index.html"]), /missing HTML href/u);
    writeFileSync(join(root, "index.html"), '<a href="/unknown/index.html">Unknown</a>');
    assert.throws(() => assertStaticNetworkBoundary(root, ["index.html"], options), /missing HTML href/u);
    writeFileSync(join(root, "index.html"), '<img src="/es/index.html">');
    assert.throws(() => assertStaticNetworkBoundary(root, ["index.html"], options), /missing HTML src/u);
    mkdirSync(join(root, "es"));
    writeFileSync(join(root, "es/index.html"), "Spanish course");
    writeFileSync(join(root, "index.html"), '<a href="/es/index.html">Spanish</a>');
    assert.doesNotThrow(() => assertStaticNetworkBoundary(root, ["index.html"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("course feedback compatibility wrapper resolves to the shared published outbox", () => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-static-outbox-"));
  const wrapperPath = "other-course/source/shared/feedback-outbox.mjs";
  const sharedPath = "language-runtime/static/source/feedback-outbox.mjs";
  try {
    mkdirSync(dirname(join(root, wrapperPath)), { recursive: true });
    mkdirSync(dirname(join(root, sharedPath)), { recursive: true });
    const wrapper = readFileSync(new URL("../../../languages/czech/static/source/shared/feedback-outbox.mjs", import.meta.url), "utf8");
    const shared = readFileSync(new URL("../../../language-runtime/static/source/feedback-outbox.mjs", import.meta.url), "utf8");
    writeFileSync(join(root, wrapperPath), transformStaticFeedbackOutbox(wrapper));
    writeFileSync(join(root, sharedPath), shared);
    assert.doesNotThrow(() => assertStaticNetworkBoundary(root, [wrapperPath, sharedPath]));
    rmSync(join(root, sharedPath));
    assert.throws(() => assertStaticNetworkBoundary(root, [wrapperPath]), /missing module import/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("canonical publisher metadata is local-page evidence, never a remote resource exemption", () => {
  const root = mkdtempSync(join(tmpdir(), "caatuu-static-canonical-"));
  const page = join(root, "index.html");
  const check = (source) => {
    writeFileSync(page, source);
    assertStaticNetworkBoundary(root, ["index.html"]);
  };
  try {
    assert.doesNotThrow(() => check('<link href="https://caatuu.waajacu.com/" rel="canonical">'));
    for (const rel of ["stylesheet", "preload", "canonical stylesheet", "canonical preload"]) {
      assert.throws(() => check('<link rel="' + rel + '" href="https://caatuu.waajacu.com/">'),
        /requires a network resource/u);
    }
    assert.throws(() => check('<link rel="canonical" href="https://unapproved.example/">'),
      /metadata origin is not the publisher/u);
    assert.throws(() => check('<link rel="canonical" href="https://caatuu.waajacu.com/missing.html">'),
      /missing canonical page/u);
    assert.throws(() => check('<link rel="canonical" rel="stylesheet" href="https://caatuu.waajacu.com/">'),
      /requires a network resource/u);
    for (const attributes of ['rel=stylesheet rel="canonical"', 'rel="canonical" rel=preload', 'rel rel="canonical"']) {
      assert.throws(() => check('<link ' + attributes + ' href="https://caatuu.waajacu.com/">'),
        /requires a network resource/u);
    }
    assert.doesNotThrow(() => check('<link data-note="rel=stylesheet" rel="canonical" href="https://caatuu.waajacu.com/">'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
