import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createAndroidProductDelivery, loadAndroidCourseBundleConfiguration } from "../build-product-assets.mjs";
import { wordWorldLicenseArtifact } from "../../../language-runtime/static/source/license-catalog.mjs";

test("product delivery retains exact offline legal texts and each course's actual corpus attribution", () => {
  const bundle = loadAndroidCourseBundleConfiguration({ allowMissingSetupDeliveredRuntimeFiles: true });
  const delivery = createAndroidProductDelivery(bundle);
  for (const { source, output } of bundle.sharedAssets.filter(({ output }) => output.startsWith("language-runtime/static/legal/"))) {
    assert.deepEqual(delivery.bundledFiles.get(output), readFileSync(source), `${output} must be readable before a setup download`);
  }
  const chromePath = "language-runtime/static/source/caatuu-chrome.js";
  const about = (source) => {
    const start = source.indexOf('<section class="settings-card side-card about-card"');
    const end = source.indexOf('<footer class="settings-sheet-footer">', start);
    assert.ok(start >= 0 && end > start, "About must retain its shared component boundaries");
    return source.slice(start, end);
  };
  assert.equal(about(delivery.bundledFiles.get(chromePath).toString()), about(readFileSync(join(bundle.workspaceRoot, "apps", chromePath), "utf8")));
  for (const configuration of bundle.configurations) {
    const { course } = configuration;
    const context = { window: {} };
    runInNewContext(readFileSync(join(bundle.workspaceRoot, course.resources.courseProfile.path), "utf8"), context);
    const path = context.window.CaatuuCourse.gameContent["word-net"].wordWorldManifest.split("?")[0];
    const browserManifest = JSON.parse(readFileSync(join(configuration.languageStaticDir, path), "utf8"));
    const androidManifest = JSON.parse(delivery.logicalFiles.get(`courses/${course.id}/${path}`));
    const args = { courseId: course.id, sourceUrl: path };
    assert.deepEqual(wordWorldLicenseArtifact(androidManifest, args), wordWorldLicenseArtifact(browserManifest, args));
  }
});
