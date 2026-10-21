import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInContext } from "node:vm";
import test from "node:test";
import { createBrowserHarness } from "../../../language-runtime/tests/helpers/fake-browser.mjs";
import { installEnglishInterfaceContent } from "../../../language-runtime/tests/helpers/english-interface-content.mjs";
import {
  createAndroidProductDelivery,
  loadAndroidCourseBundleConfiguration,
  transformWebViewEmbeddingCatalog,
} from "../build-product-assets.mjs";
import {
  homeBootstrapAssets,
  nativeBootstrapCatalogAssets,
  PRODUCT_BOOTSTRAP_MAX_BYTES,
} from "../product-delivery.mjs";

const workspace = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, workspace), "utf8");
const imageReferences = (text) => [...text.matchAll(/\/(?:assets|language-runtime\/static\/assets)\/[^"'`<>?]+?\.(?:png|jpe?g|webp|svg)/gu)]
  .map(([reference]) => decodeURIComponent(reference.slice(1)))
  .filter((reference) => !reference.includes("${"));

test("the product Home renders its existing art, controls, and course flags before any download", (t) => {
  const bundle = loadAndroidCourseBundleConfiguration({ allowMissingSetupDeliveredRuntimeFiles: true });
  const delivery = createAndroidProductDelivery(bundle);
  t.diagnostic(`Bootstrap assets ${delivery.byteCounts.bootstrap} bytes of ${PRODUCT_BOOTSTRAP_MAX_BYTES}; ${PRODUCT_BOOTSTRAP_MAX_BYTES - delivery.byteCounts.bootstrap} bytes remain.`);
  assert.ok(delivery.byteCounts.bootstrap <= PRODUCT_BOOTSTRAP_MAX_BYTES);
  let metadataSavings = 0;
  for (const path of nativeBootstrapCatalogAssets(delivery.logicalFiles, bundle.courseCatalog)) {
    const configuration = bundle.configurations.find(({ course }) => path.startsWith(`courses/${course.id}/`));
    const relativePath = path.slice(`courses/${configuration.course.id}/`.length);
    const authored = readFileSync(configuration.languageFileSources[relativePath], "utf8");
    const provider = configuration.nativeProviders.providers.embeddings;
    const projected = provider?.implementation === "webview-english-minilm-v1" && relativePath === provider.catalogAsset
      ? transformWebViewEmbeddingCatalog(authored) : authored;
    const packaged = delivery.bundledFiles.get(path).toString("utf8");
    assert.deepEqual(JSON.parse(packaged), JSON.parse(projected), `${path} retains every native metadata value`);
    assert.equal(packaged, `${JSON.stringify(JSON.parse(projected))}\n`, `${path} omits authoring indentation`);
    metadataSavings += Buffer.byteLength(projected) - Buffer.byteLength(packaged);
  }
  assert.ok(metadataSavings > 0, "Native metadata compaction recovers APK residency without deleting fields");
  t.diagnostic(`Native metadata compaction saves ${metadataSavings} bytes.`);
  const legalPath = "language-runtime/static/legal/android-dependencies.json";
  const legalSource = read(`apps/${legalPath}`);
  const packagedLegal = delivery.bundledFiles.get(legalPath).toString("utf8");
  assert.deepEqual(JSON.parse(packagedLegal), JSON.parse(legalSource), "Every dependency notice and license identity is preserved");
  assert.equal(packagedLegal, `${JSON.stringify(JSON.parse(legalSource))}\n`, "Dependency metadata omits only JSON indentation");
  const courses = bundle.configurations.map(({ course }) => course);
  const required = homeBootstrapAssets(delivery.logicalFiles, courses);
  const html = delivery.logicalFiles.get("index.html").toString("utf8");
  const nextView = /<section\b[^>]*\bid="view-(?!home)[^"]+"/u.exec(html);
  assert.ok(nextView, "The shared application retains its Home and subsequent course views");
  const home = html.slice(0, nextView.index);
  assert.match(home, /id="view-home"/u);
  const setupShips = [...home.matchAll(/<img\b(?=[^>]*\bdata-setup-ship\b)[^>]*>/gu)]
    .flatMap(([element]) => imageReferences(element));
  assert.ok(setupShips.length > 1, "First-install setup has multiple ships to rotate before downloading");
  assert.equal(new Set(setupShips).size, setupShips.length, "The setup gallery uses distinct artwork");
  for (const path of imageReferences(home)) {
    assert.ok(delivery.bundledFiles.get(path)?.equals(delivery.logicalFiles.get(path)),
      `First-install artwork must be bundled intact: ${path}`);
    assert.ok(!delivery.downloadedAssets.includes(path), `First-install artwork must not depend on download order: ${path}`);
  }
  // These modules own the Home and shared shell. Stylesheets for hidden game
  // views are linked in the same document, but their art belongs to setup.
  const homeStylesheets = new Set([
    "caatuu-theme.css", "caatuu-workspace.css", "caatuu-home.css", "caatuu-chrome.css", "music-controls.css",
  ]);
  const browser = createBrowserHarness({ course: bundle.defaultCourse.course });
  const header = browser.document.createElement("header");
  header.className = "app-header";
  const navigation = browser.document.createElement("nav");
  navigation.dataset.caatuuBottomNav = "";
  navigation.dataset.activeSection = "home";
  browser.document.body.append(header, navigation);
  installEnglishInterfaceContent(browser);
  runInContext(delivery.logicalFiles.get("language-runtime/static/source/caatuu-chrome.js").toString("utf8"), browser.context);
  const chromeImages = [header, navigation].flatMap(element => element.querySelectorAll("img").map(image => image.src));
  assert.ok(chromeImages.length > 0, "The actual Home header and navigation render their artwork");
  const dependencySources = [
    home,
    // Inspect rendered Home chrome, excluding unopened Backpack/game menus.
    chromeImages.join("\n"),
    delivery.logicalFiles.get("language-runtime/static/source/app-bootstrap.mjs").toString("utf8"),
    ...[...html.matchAll(/\/language-runtime\/static\/styles\/[^"?]+\.css/gu)]
      .filter(([path]) => homeStylesheets.has(path.split("/").at(-1)))
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
  assert.ok(delivery.downloadedAssets.some((path) => path.startsWith("assets/planets/")), "Larger game art remains setup-delivered");
  for (const course of courses) {
    assert.ok(delivery.downloadedAssets.some((path) => path.startsWith(`courses/${course.id}/data/`)),
      `${course.id} curriculum remains selected-course setup-delivered`);
  }
  const catalog = JSON.parse(delivery.bundledFiles.get("caatuu-course-bundle.json"));
  assert.deepEqual(catalog, bundle.courseCatalog, "APK residency preserves complete course and native-provider metadata");
  const languageCatalog = JSON.parse(read("apps/languages/catalog.json"));
  const enabled = languageCatalog.courses.filter(({ manifest }) => JSON.parse(read(manifest)).platforms.android.enabled);
  assert.deepEqual(catalog.courses.map(({ id }) => id).sort(), enabled.map(({ id }) => id).sort());
  assert.ok(catalog.courses.some(({ sourceLanguage, targetLanguage }) => sourceLanguage.id === "en" && targetLanguage.id === "es"),
    "English-to-Spanish must remain discoverable in the Android Home");
});
