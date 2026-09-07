import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAndroidProductDelivery,
  loadAndroidCourseBundleConfiguration,
} from "../build-product-assets.mjs";
import {
  homeBootstrapAssets,
  PRODUCT_BOOTSTRAP_MAX_BYTES,
} from "../product-delivery.mjs";

const workspace = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, workspace), "utf8");
const imageReferences = (text) => [...text.matchAll(/\/(?:assets|language-runtime\/static\/assets)\/[^"'`<>?]+?\.(?:png|jpe?g|webp|svg)/gu)]
  .map(([reference]) => decodeURIComponent(reference.slice(1)))
  .filter((reference) => !reference.includes("${"));

test("the product Home renders its existing art, controls, and course flags before any download", () => {
  const bundle = loadAndroidCourseBundleConfiguration({ allowMissingSetupDeliveredRuntimeFiles: true });
  const delivery = createAndroidProductDelivery(bundle);
  const courses = bundle.configurations.map(({ course }) => course);
  const required = homeBootstrapAssets(delivery.logicalFiles, courses);
  const html = delivery.logicalFiles.get("index.html").toString("utf8");
  const nextView = /<section\b[^>]*\bid="view-(?!home)[^"]+"/u.exec(html);
  assert.ok(nextView, "The shared application retains its Home and subsequent course views");
  const home = html.slice(0, nextView.index);
  assert.match(home, /id="view-home"/u);
  const dependencySources = [
    home,
    // Chrome creates Home navigation, reward counters, and display controls.
    // Game planets and dynamic artwork remain selected-course setup assets.
    imageReferences(delivery.logicalFiles.get("language-runtime/static/source/caatuu-chrome.js").toString("utf8"))
      .filter((path) => path.startsWith("assets/icons/")).map((path) => `/${path}`).join("\n"),
    delivery.logicalFiles.get("language-runtime/static/source/app-bootstrap.mjs").toString("utf8"),
    ...[...html.matchAll(/\/language-runtime\/static\/styles\/[^"?]+\.css/gu)]
      .map(([path]) => delivery.logicalFiles.get(path.slice(1)).toString("utf8")),
  ];
  for (const source of dependencySources) {
    for (const path of imageReferences(source)) {
      assert.ok(required.has(path), `The existing Home dependency must be declared resident: ${path}`);
    }
  }
  for (const path of required) {
    assert.ok(delivery.bundledFiles.has(path), `Home must not need a download to render ${path}`);
    assert.ok(!delivery.downloadedAssets.includes(path), `Home artwork has one APK residency owner: ${path}`);
  }
  assert.ok(delivery.byteCounts.bootstrap <= PRODUCT_BOOTSTRAP_MAX_BYTES);
  assert.ok(delivery.downloadedAssets.some((path) => path.startsWith("assets/planets/")), "Larger game art remains setup-delivered");
  for (const course of courses) {
    assert.ok(delivery.downloadedAssets.some((path) => path.startsWith(`courses/${course.id}/data/`)),
      `${course.id} curriculum remains selected-course setup-delivered`);
  }
  const catalog = JSON.parse(delivery.bundledFiles.get("caatuu-course-bundle.json"));
  const languageCatalog = JSON.parse(read("apps/languages/catalog.json"));
  const enabled = languageCatalog.courses.filter(({ manifest }) => JSON.parse(read(manifest)).platforms.android.enabled);
  assert.deepEqual(catalog.courses.map(({ id }) => id).sort(), enabled.map(({ id }) => id).sort());
  assert.ok(catalog.courses.some(({ sourceLanguage, targetLanguage }) => sourceLanguage.id === "en" && targetLanguage.id === "es"),
    "English-to-Spanish must remain discoverable in the Android Home");
});
