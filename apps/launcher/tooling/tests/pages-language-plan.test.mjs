import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertPagesLanguageCoverage,
  assertPagesLanguageOutputCoverage,
  createPagesLanguagePlan,
  loadPagesLanguagePlan,
} from "../pages-language-plan.mjs";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");

function fixtureCourse(id, {
  browserEnabled = true,
  pagesEnabled = browserEnabled,
  directoryName = id,
  routePrefix = `/${id}`,
  entryPath = `${routePrefix}/index.html`,
} = {}) {
  return {
    id,
    status: "active",
    directoryName,
    routePrefix,
    entryPath,
    platforms: {
      browser: {
        enabled: browserEnabled,
        pagesEnabled,
        entryPath,
        backend: "static",
      },
      android: {
        enabled: true,
        channels: [],
      },
    },
    resources: {
      staticRoot: {
        kind: "directory",
        path: `apps/languages/${id}/static`,
        scope: "course",
        state: "present",
      },
      setupCatalog: {
        kind: "file",
        path: `apps/languages/${id}/static/setup-assets.json`,
        scope: "course",
        state: "present",
      },
      courseProfile: {
        kind: "file",
        path: `apps/languages/${id}/static/source/shared/course-profile.js`,
        scope: "course",
        state: "present",
      },
    },
  };
}

function writePlanWorkspace(workspace, { course = fixtureCourse("cz") } = {}) {
  const courseRoot = join(workspace, "apps/languages", course.directoryName);
  mkdirSync(join(courseRoot, "static"), { recursive: true });
  writeFileSync(join(workspace, "apps/languages/catalog.json"), JSON.stringify({
    defaultCourseId: course.id,
    reservedRoutePrefixes: [],
    courses: [{ id: course.id, manifest: `apps/languages/${course.directoryName}/course.json` }],
  }));
  writeFileSync(join(courseRoot, "course.json"), JSON.stringify(course));
  writeFileSync(join(courseRoot, "static/setup-assets.json"), "{}");
  return courseRoot;
}

function fixturePlan(courseOptions, {
  defaultCourseId = "cz",
  reservedRoutePrefixes = [],
} = {}) {
  const catalog = {
    defaultCourseId,
    reservedRoutePrefixes,
    courses: courseOptions.map(({ id }) => ({ id, manifest: `apps/languages/${id}/course.json` })),
  };
  const courses = courseOptions.map(({ id, ...options }) => ({
    id,
    manifestPath: `apps/languages/${id}/course.json`,
    course: fixtureCourse(id, options),
  }));
  return createPagesLanguagePlan({ catalog, courses });
}

function outputFixture(plan, {
  courseSetups = plan.browserCourses,
  extraCourses = [],
  omit = [],
} = {}) {
  const publishedFiles = new Set(["index.html", "assets/site.css", ...plan.requiredOutputPaths]);
  const documents = new Map();
  for (const course of [...courseSetups, ...extraCourses]) {
    const entryFile = course.entryPath.slice(1);
    const setupFile = course.setupPath.slice(1);
    publishedFiles.add(entryFile);
    publishedFiles.add(setupFile);
    const setup = course.legacyV1
      ? { version: 1, cache_name: course.legacyCacheName ?? `caatuu-${course.id}-setup-v1` }
      : { application: { entryPath: course.entryPath } };
    if (course.includeCourseId !== false) setup.courseId = course.id;
    documents.set(setupFile, JSON.stringify(setup));
  }
  for (const path of omit) publishedFiles.delete(path);
  return {
    publishedFiles: [...publishedFiles],
    readPublishedFile(path) {
      assert.ok(documents.has(path), `Fixture has no published document for ${path}`);
      return documents.get(path);
    },
  };
}

test("the Pages language plan derives current browser route and entry coverage from the catalog", () => {
  const plan = loadPagesLanguagePlan({ workspaceRoot });
  assert.deepEqual(plan.browserCourses, [
    {
      id: "cz",
      status: "active",
      directoryName: "czech",
      manifestPath: "apps/languages/czech/course.json",
      staticRootPath: "apps/languages/czech/static",
      setupRepositoryPath: "apps/languages/czech/static/setup-assets.json",
      setupRelativePath: "setup-assets.json",
      profileRepositoryPath: "apps/languages/czech/static/source/shared/course-profile.js",
      profileRelativePath: "source/shared/course-profile.js",
      routePrefix: "/cz",
      publicRoute: "/cz/",
      entryPath: "/cz/index.html",
      setupPath: "/cz/setup-assets.json",
      profilePath: "/cz/source/shared/course-profile.js",
      pagesEnabled: true,
      androidEnabled: true,
    },
    {
      id: "zh",
      status: "development",
      directoryName: "mandarin-simplified",
      manifestPath: "apps/languages/mandarin-simplified/course.json",
      staticRootPath: "apps/languages/mandarin-simplified/static",
      setupRepositoryPath: "apps/languages/mandarin-simplified/static/setup-assets.json",
      setupRelativePath: "setup-assets.json",
      profileRepositoryPath: "apps/languages/mandarin-simplified/static/source/shared/course-profile.js",
      profileRelativePath: "source/shared/course-profile.js",
      routePrefix: "/zh",
      publicRoute: "/zh/",
      entryPath: "/zh/index.html",
      setupPath: "/zh/setup-assets.json",
      profilePath: "/zh/source/shared/course-profile.js",
      pagesEnabled: true,
      androidEnabled: true,
    },
  ]);
  assert.deepEqual(plan.requiredEntrypoints, [
    "/",
    "/cz/",
    "/cz/index.html",
    "/zh/",
    "/zh/index.html",
  ]);
  assert.equal(plan.defaultCourseId, "cz");
  assert.equal(plan.defaultCourse, plan.browserCourses[0]);
  assert.equal(assertPagesLanguageCoverage({ plan, declaredEntrypoints: plan.requiredEntrypoints }), plan);
  assert.deepEqual(plan.requiredOutputPaths, [
    "cz/index.html",
    "cz/setup-assets.json",
    "cz/source/shared/course-profile.js",
    "zh/index.html",
    "zh/setup-assets.json",
    "zh/source/shared/course-profile.js",
  ]);
  assert.deepEqual(plan.forbiddenOutputPaths, [
    "es/index.html",
    "es/setup-assets.json",
    "es/source/shared/course-profile.js",
  ]);
  assert.deepEqual(plan.forbiddenOutputPrefixes, ["es/"]);
});

test("a third browser course fails closed until both its public route and entry are declared", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "zh" }, { id: "xy" }]);
  assert.throws(
    () => assertPagesLanguageCoverage({
      plan,
      declaredEntrypoints: ["/", "/cz/", "/cz/index.html", "/zh/", "/zh/index.html"],
    }),
    /missing: \/xy\/, \/xy\/index\.html/u,
  );
  assert.throws(
    () => assertPagesLanguageCoverage({
      plan,
      declaredEntrypoints: ["/", "/cz/", "/cz/index.html", "/zh/", "/zh/index.html", "/xy/"],
    }),
    /missing: \/xy\/index\.html/u,
  );
  assert.doesNotThrow(() => assertPagesLanguageCoverage({
    plan,
    declaredEntrypoints: plan.requiredEntrypoints,
  }));
});

test("Pages entrypoint coverage rejects stale extras, duplicates, and catalog-order drift", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "zh" }]);
  assert.throws(
    () => assertPagesLanguageCoverage({
      plan,
      declaredEntrypoints: [...plan.requiredEntrypoints, "/xy/", "/xy/index.html"],
    }),
    /unexpected\/stale: \/xy\/, \/xy\/index\.html/u,
  );
  assert.throws(
    () => assertPagesLanguageCoverage({
      plan,
      declaredEntrypoints: ["/", "/cz/", "/cz/index.html", "/cz/", "/zh/", "/zh/index.html"],
    }),
    /contains duplicates: \/cz\//u,
  );
  assert.throws(
    () => assertPagesLanguageCoverage({
      plan,
      declaredEntrypoints: ["/", "/zh/", "/zh/index.html", "/cz/", "/cz/index.html"],
    }),
    /order must match the language catalog \(default course: cz\)/u,
  );
});

test("the Pages default must resolve to a browser- and Pages-enabled catalog course", () => {
  assert.throws(
    () => fixturePlan([{ id: "cz" }], { defaultCourseId: "xy" }),
    /Default course xy is not present in the language catalog/u,
  );
  assert.throws(
    () => fixturePlan([{ id: "cz", browserEnabled: false }, { id: "zh" }]),
    /Default course cz must be browser- and Pages-enabled/u,
  );
  assert.throws(
    () => fixturePlan([{ id: "cz", pagesEnabled: false }, { id: "zh" }]),
    /Default course cz must be browser- and Pages-enabled/u,
  );

  const plan = fixturePlan([{ id: "cz" }, { id: "zh" }], { defaultCourseId: "zh" });
  assert.equal(plan.defaultCourse, plan.browserCourses[1]);
  assert.doesNotThrow(() => assertPagesLanguageCoverage({
    plan,
    declaredEntrypoints: plan.requiredEntrypoints,
  }));
});

test("the Pages plan rejects deterministic route and output-path collisions", () => {
  assert.throws(
    () => fixturePlan([
      { id: "cz", routePrefix: "/shared" },
      { id: "zh", routePrefix: "/shared" },
    ]),
    /Pages course public routes contains duplicates: \/shared\//u,
  );
  assert.throws(
    () => fixturePlan([{ id: "cz", entryPath: "/cz/setup-assets.json" }]),
    /Pages course entry, setup, and profile paths contains duplicates: \/cz\/setup-assets\.json/u,
  );
});

test("a browser-disabled course does not claim a Pages route", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "xy", browserEnabled: false }]);
  assert.deepEqual(plan.browserCourses.map(({ id }) => id), ["cz"]);
  assert.deepEqual(plan.requiredEntrypoints, ["/", "/cz/", "/cz/index.html"]);
});

test("a local browser course can be withheld from Pages without course-ID logic", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "xy", pagesEnabled: false }]);
  assert.deepEqual(plan.browserCourses.map(({ id }) => id), ["cz"]);
  assert.deepEqual(plan.requiredEntrypoints, ["/", "/cz/", "/cz/index.html"]);
  assert.deepEqual(plan.forbiddenOutputPaths, [
    "xy/index.html",
    "xy/setup-assets.json",
    "xy/source/shared/course-profile.js",
  ]);
  assert.deepEqual(plan.forbiddenOutputPrefixes, ["xy/"]);
});

test("Pages output requires each planned course entry, setup catalog, and profile", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "zh" }]);
  const missingSetup = outputFixture(plan, { omit: ["zh/setup-assets.json"] });
  assert.throws(
    () => assertPagesLanguageOutputCoverage({
      plan,
      ...missingSetup,
    }),
    /missing catalog-required browser language files: zh\/setup-assets\.json/u,
  );
  const complete = outputFixture(plan);
  assert.equal(
    assertPagesLanguageOutputCoverage({
      plan,
      ...complete,
    }),
    plan,
  );
});

test("Pages output rejects files owned by a Pages-withheld catalog course", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "xy", browserEnabled: false }]);
  assert.deepEqual(plan.forbiddenOutputPaths, [
    "xy/index.html",
    "xy/setup-assets.json",
    "xy/source/shared/course-profile.js",
  ]);
  const output = outputFixture(plan);
  output.publishedFiles.push("xy/index.html", "xy/setup-assets.json", "xy/source/shared/course-profile.js");
  assert.throws(
    () => assertPagesLanguageOutputCoverage({
      plan,
      ...output,
    }),
    /Pages-withheld course file: xy\/index\.html, xy\/setup-assets\.json, xy\/source\/shared\/course-profile\.js/u,
  );

  const nestedOutput = outputFixture(plan);
  nestedOutput.publishedFiles.push("xy/unexpected/stale.txt");
  assert.throws(
    () => assertPagesLanguageOutputCoverage({
      plan,
      ...nestedOutput,
    }),
    /files below a Pages-withheld course route: xy\/unexpected\/stale\.txt/u,
  );
});

test("a removed-course setup copied from the baseline cannot survive staged Pages validation", () => {
  const plan = fixturePlan([{ id: "cz" }, { id: "zh" }]);
  const staleCourse = {
    id: "xy",
    publicRoute: "/xy/",
    entryPath: "/xy/index.html",
    setupPath: "/xy/setup-assets.json",
  };
  const output = outputFixture(plan, { extraCourses: [staleCourse] });
  assert.throws(
    () => assertPagesLanguageOutputCoverage({ plan, ...output }),
    /published course setup markers must exactly match Pages-enabled catalog courses/u,
  );
});

test("published course discovery accepts only the reviewed legacy setup and does not hide reserved stale courses", () => {
  const plan = fixturePlan([{ id: "cz" }], { reservedRoutePrefixes: ["/xy"] });
  const legacyCourse = {
    ...plan.browserCourses[0],
    includeCourseId: false,
    legacyV1: true,
    legacyCacheName: "caatuu-czech-setup-v1",
  };
  const output = outputFixture(plan, { courseSetups: [legacyCourse] });
  output.publishedFiles.push("assets/widgets/setup-assets.json");
  assert.equal(
    assertPagesLanguageOutputCoverage({ plan, ...output }),
    plan,
  );

  const unrecognizedLegacy = outputFixture(plan, {
    extraCourses: [{
      id: "xy",
      publicRoute: "/xy/",
      entryPath: "/xy/index.html",
      setupPath: "/xy/setup-assets.json",
      includeCourseId: false,
      legacyV1: true,
    }],
  });
  assert.throws(
    () => assertPagesLanguageOutputCoverage({ plan, ...unrecognizedLegacy }),
    /Pages course setup has no valid course ID: xy\/setup-assets\.json/u,
  );

  const reservedStale = outputFixture(plan, {
    extraCourses: [{
      id: "xy",
      publicRoute: "/xy/",
      entryPath: "/xy/index.html",
      setupPath: "/xy/setup-assets.json",
    }],
  });
  assert.throws(
    () => assertPagesLanguageOutputCoverage({ plan, ...reservedStale }),
    /published course setup markers must exactly match Pages-enabled catalog courses/u,
  );
});

test("the Pages plan loader pins every authority while allowing a workspace-root alias", (context) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "caatuu-pages-plan-symlink-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "caatuu-pages-plan-outside-"));
  const catalog = {
    defaultCourseId: "cz",
    reservedRoutePrefixes: [],
    courses: [{ id: "cz", manifest: "apps/languages/cz/course.json" }],
  };
  const outsideCatalog = join(outsideRoot, "catalog.json");
  const outsideManifest = join(outsideRoot, "course.json");
  writeFileSync(outsideCatalog, JSON.stringify(catalog));
  writeFileSync(outsideManifest, JSON.stringify(fixtureCourse("cz")));
  try {
    const catalogWorkspace = join(temporaryRoot, "catalog-workspace");
    mkdirSync(join(catalogWorkspace, "apps/languages"), { recursive: true });
    try {
      symlinkSync(outsideCatalog, join(catalogWorkspace, "apps/languages/catalog.json"));
    } catch (error) {
      if (["EACCES", "EPERM", "ENOSYS"].includes(error.code)) {
        context.skip(`Symbolic links are unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    assert.throws(
      () => loadPagesLanguagePlan({ workspaceRoot: catalogWorkspace }),
      /Language catalog must not be a symbolic-link alias/u,
    );

    const manifestWorkspace = join(temporaryRoot, "manifest-workspace");
    mkdirSync(join(manifestWorkspace, "apps/languages/cz"), { recursive: true });
    writeFileSync(join(manifestWorkspace, "apps/languages/catalog.json"), JSON.stringify(catalog));
    symlinkSync(outsideManifest, join(manifestWorkspace, "apps/languages/cz/course.json"));
    assert.throws(
      () => loadPagesLanguagePlan({ workspaceRoot: manifestWorkspace }),
      /cz manifest must not be a symbolic-link alias/u,
    );

    const courseRootWorkspace = join(temporaryRoot, "course-root-workspace");
    mkdirSync(join(courseRootWorkspace, "apps/languages"), { recursive: true });
    writeFileSync(join(courseRootWorkspace, "apps/languages/catalog.json"), JSON.stringify(catalog));
    symlinkSync(courseRootWorkspace, join(courseRootWorkspace, "apps/languages/cz"), "dir");
    assert.throws(
      () => loadPagesLanguagePlan({ workspaceRoot: courseRootWorkspace }),
      /cz course root must not be a symbolic-link alias/u,
    );

    const staticWorkspace = join(temporaryRoot, "static-workspace");
    const staticCourseRoot = writePlanWorkspace(staticWorkspace);
    rmSync(join(staticCourseRoot, "static"), { recursive: true, force: true });
    const outsideStatic = join(outsideRoot, "static");
    mkdirSync(outsideStatic, { recursive: true });
    writeFileSync(join(outsideStatic, "setup-assets.json"), "{}");
    symlinkSync(outsideStatic, join(staticCourseRoot, "static"), "dir");
    assert.throws(
      () => loadPagesLanguagePlan({ workspaceRoot: staticWorkspace }),
      /cz staticRoot must not be a symbolic-link alias/u,
    );

    const setupWorkspace = join(temporaryRoot, "setup-workspace");
    const setupCourseRoot = writePlanWorkspace(setupWorkspace);
    rmSync(join(setupCourseRoot, "static/setup-assets.json"));
    symlinkSync(outsideCatalog, join(setupCourseRoot, "static/setup-assets.json"));
    assert.throws(
      () => loadPagesLanguagePlan({ workspaceRoot: setupWorkspace }),
      /cz setupCatalog must not be a symbolic-link alias/u,
    );

    const realWorkspace = join(temporaryRoot, "real-workspace");
    writePlanWorkspace(realWorkspace);
    assert.throws(
      () => loadPagesLanguagePlan({
        workspaceRoot: realWorkspace,
        catalogPath: "apps/languages/cz/course.json",
      }),
      /Pages language catalog must be apps\/languages\/catalog\.json/u,
    );
    const workspaceAlias = join(temporaryRoot, "workspace-alias");
    symlinkSync(realWorkspace, workspaceAlias, "dir");
    assert.equal(loadPagesLanguagePlan({ workspaceRoot: workspaceAlias }).defaultCourseId, "cz");
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("the Pages builder preflights catalog coverage before build and validation work", () => {
  const source = readFileSync(join(testDir, "../build-pages-site.mjs"), "utf8");
  assert.match(source, /loadPagesLanguagePlan/u);
  assert.match(source, /assertPagesLanguageCoverage/u);
  assert.match(source, /assertPagesLanguageOutputCoverage\(\{[\s\S]*plan: languagePlan,[\s\S]*publishedFiles: files,[\s\S]*readPublishedFile/u);
  assert.match(source, /for \(const course of languagePlan\.browserCourses\)/u);
  assert.match(source, /baselinePublicPaths\.has\(publishedPath\)/u);
  for (const exportName of ["validatePagesSite", "compilePagesSite"]) {
    const start = source.indexOf(`export async function ${exportName}({`);
    assert.ok(start >= 0, `${exportName} must remain exported`);
    const nextExport = source.indexOf("\nexport async function ", start + 1);
    const end = nextExport >= 0 ? nextExport : source.indexOf("\nfunction parseArguments", start);
    const body = source.slice(start, end);
    assert.match(body, /await assertDeclaredPagesLanguageCoverage\(\{ workspaceRoot: workspace \}\)/u);
  }
});
