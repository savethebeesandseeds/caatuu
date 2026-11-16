import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectBrowserGameFrames } from "../browser-view-projection.mjs";
import {
  assertStaticCorpusMetadata,
  transformDictionaryUi,
  transformLanguageIndex,
  transformLauncherIndex,
  transformSharedWorkspace,
  transformStaticInterfaceCatalog,
  usesStaticDictionaryProvider,
} from "../build-static-site.mjs";

const root = new URL("../../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const declarations = [
  ["dictionary.full.subtitle", "small"], ["dictionary.full.title", "h2"],
  ["dictionary.full.description", "p"], ["dictionary.full.controls", "section", "aria-label"],
  ["dictionary.full.label", "section", "aria-label"], ["dictionary.full.search.label", "input", "aria-label"],
  ["dictionary.full.search.help", "small"], ["dictionary.full.download", "button"],
];

test("static dictionary projection follows translation keys despite copy, quotes, ordering and spacing changes", () => {
  const catalog = JSON.parse(read("apps/language-runtime/static/data/interface/en.v1.json"));
  for (const [key] of declarations) catalog.messages[key] = "Different copy; new punctuation — traducción";
  catalog.messages["wordworld.dictionary.missingqueued"] = "Different notice";
  catalog.revision = "interface-en-test-next";
  const projected = JSON.parse(transformStaticInterfaceCatalog(JSON.stringify(catalog)));
  assert.equal(projected.revision, catalog.revision);
  for (const [key, value] of Object.entries(catalog.messages)) {
    if (!declarations.some(([id]) => id === key) && key !== "wordworld.dictionary.missingqueued") {
      assert.deepEqual(projected.messages[key], value, `${key} remains untouched`);
    }
  }
  const parts = declarations.map(([key, tag, attribute]) => {
    const opening = `<${tag} title='1 > 0' data-i18n${attribute ? `-${attribute}` : ""} = '${key}' class='new-layout'${attribute ? ` ${attribute} = 'Nuevas palabras'` : ""}>`;
    return tag === "input" ? opening : `${opening}Una descripción nueva</${tag}>`;
  });
  const output = transformLanguageIndex(parts.join("\n"));
  for (const [key] of declarations) assert.ok(output.includes(projected.messages[key]), `${key} matches its catalog projection`);
  assert.ok(output.includes("title='1 > 0'"));
  assert.throws(() => transformLanguageIndex(parts.slice(1).join("\n")), /structural anchor/u);
  assert.throws(() => transformLanguageIndex([...parts, parts[0]].join("\n")), /structural anchor/u);
  delete catalog.messages[declarations[0][0]];
  assert.throws(() => transformStaticInterfaceCatalog(JSON.stringify(catalog)), /message is missing/u);
});

test("launcher projection keeps the download control but removes development translation bindings independently of text", () => {
  const source = `<a data-android-download><small title='a > b' data-i18n = 'launcher.android.beta'>Aplicación móvil</small><b data-i18n='launcher.android.downloadbeta' class='new'>Otra frase</b></a>`;
  const output = transformLauncherIndex(source);
  assert.match(output, /data-android-download/u);
  assert.match(output, /title='a > b'/u);
  assert.doesNotMatch(output, /data-i18n|Aplicación móvil|Otra frase/u);
  assert.throws(() => transformLauncherIndex(source.replace("launcher.android.beta", "missing.key")), /structural anchor/u);
});

test("workspace and dictionary adaptation follows semantic setters, never English message spelling", () => {
  const source = '  repoLink.href = `https://huggingface.co/${model.repoId}`;\n'
    + 'setText("#dictionaryFullTitle", `Otra; frase ${targetLabel}`);\n'
    + 'setText("#dictionaryFullDescription", "New; description");\n'
    + "fullSearch.setAttribute('aria-label', 'New; accessible label');\n";
  const output = transformSharedWorkspace(source);
  assert.doesNotMatch(output, /huggingface|Otra;|New;/u);
  assert.match(output, /setText\("#dictionaryFullTitle",/u);
  assert.throws(() => transformSharedWorkspace(source.replace("#dictionaryFullTitle", "#renamed")), /expected exactly one|expected 1|anchor/u);
  const dictionary = '  const dictionaryApi = window.CaatuuRuntime?.dictionary;\nfunction setAvailability( text, state ) {\nconsole.log(text);\n}\nsetAvailability("Ready in another language", "ready");\n';
  const projected = transformDictionaryUi(dictionary);
  assert.ok(projected.includes('setAvailability("Ready in another language", "ready")'));
  assert.match(projected, /state === "ready"/u);
});

test("corpus counts follow reviewed records and reject inconsistent metadata without freezing curriculum size", () => {
  for (const difficulties of [[0, 1], [1], [2, 2, 3, 1]]) {
    const corpus = { records: difficulties.map((difficulty) => ({ difficulty })) };
    const distribution = {};
    for (const difficulty of difficulties) distribution[difficulty] = (distribution[difficulty] || 0) + 1;
    const manifest = { recordCount: difficulties.length, difficultyDistribution: distribution };
    assert.equal(assertStaticCorpusMetadata(corpus, manifest), corpus.records);
    assert.throws(() => assertStaticCorpusMetadata(corpus, { ...manifest, recordCount: 99 }), /record count/u);
    assert.throws(() => assertStaticCorpusMetadata(corpus, { ...manifest, difficultyDistribution: {} }), /difficulty counts/u);
  }
  assert.throws(() => assertStaticCorpusMetadata({ records: [] }, {}), /must contain records/u);
});


test("static dictionary adaptation follows an enabled present provider, never the course ID", () => {
  const course = { id: "ordinary-course", capabilities: { dictionary: true },
    resources: { dictionaryProvider: { state: "present", providerId: "czech-full-dictionary-v1" } } };
  assert.equal(usesStaticDictionaryProvider(course), true);
  assert.equal(usesStaticDictionaryProvider({ ...course, capabilities: { dictionary: false } }), false);
  assert.equal(usesStaticDictionaryProvider({ ...course, resources: {
    dictionaryProvider: { ...course.resources.dictionaryProvider, state: "planned" },
  } }), false);
  assert.equal(usesStaticDictionaryProvider({ ...course, resources: {} }), false);
});
test("browser game frames follow declared games and routes independently of course identity", () => {
  const source = read("apps/language-runtime/static/app/index.html");
  const course = { id: "other-course", games: ["case-cosmos"],
    routes: { caseCosmos: "other-case.html", memoryMoon: "unused.html" } };
  const output = projectBrowserGameFrames({ source, course });
  const frames = [...output.matchAll(/<iframe\b[^>]*data-embedded-game="([^"]+)"[^>]*>/gu)];
  assert.equal(frames.length, 5);
  for (const [frame, id] of frames) {
    if (id === "case-cosmos") assert.match(frame, /data-src="other-case.html"/u);
    else assert.doesNotMatch(frame, /\s(?:data-src|src)=/u);
  }
  const spanish = JSON.parse(read("apps/languages/spanish/course.json"));
  const inactive = projectBrowserGameFrames({ source, course: spanish });
  const inactiveCase = inactive.match(/<iframe\b[^>]*data-embedded-game="case-cosmos"[^>]*>/u)?.[0];
  assert.ok(inactiveCase);
  assert.doesNotMatch(inactiveCase, /\s(?:data-src|src)=/u);
  assert.throws(() => projectBrowserGameFrames({ source, course: { games: ["case-cosmos"] } }),
    /Enabled game has no browser route/u);
});
