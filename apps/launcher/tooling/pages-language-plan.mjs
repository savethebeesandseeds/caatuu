import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";

const defaultCatalogPath = "apps/languages/catalog.json";
const courseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const routePrefixPattern = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertUniqueValues(values, label) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  assert.equal(
    duplicates.size,
    0,
    `${label} contains duplicates: ${[...duplicates].join(", ")}`,
  );
}

function isInsideOrEqual(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function samePhysicalPath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}

function requireCanonicalRepositoryEntry(realRoot, repositoryPath, label, kind) {
  const normalizedPath = normalizedRepositoryPath(repositoryPath, `${label} path`);
  const expectedPath = resolve(realRoot, ...normalizedPath.split("/"));
  assert.ok(isInsideOrEqual(realRoot, expectedPath), `${label} path escapes the workspace: ${repositoryPath}`);
  const stats = lstatSync(expectedPath);
  assert.ok(!stats.isSymbolicLink(), `${label} must not be a symbolic-link alias: ${repositoryPath}`);
  assert.ok(
    kind === "file" ? stats.isFile() : stats.isDirectory(),
    `${label} must be a ${kind}: ${repositoryPath}`,
  );
  const realPath = realpathSync(expectedPath);
  assert.ok(
    isInsideOrEqual(realRoot, realPath) && samePhysicalPath(realPath, expectedPath),
    `${label} must resolve to its exact canonical workspace location: ${repositoryPath}`,
  );
  return realPath;
}

function normalizedRepositoryPath(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string path`);
  assert.ok(value && value === value.trim(), `${label} must be a nonblank trimmed path`);
  assert.ok(!value.startsWith("/") && !value.includes("\\"), `${label} must be repository-relative and use forward slashes`);
  const segments = value.split("/");
  assert.ok(
    segments.every((segment) => segment && segment !== "." && segment !== ".."),
    `${label} must be normalized and confined`,
  );
  return value;
}

function courseResourcePublicPath(course, resourceName) {
  const staticRoot = course.resources?.staticRoot;
  const resource = course.resources?.[resourceName];
  assert.ok(isObject(staticRoot), `${course.id} course manifest has no staticRoot resource`);
  assert.ok(isObject(resource), `${course.id} course manifest has no ${resourceName} resource`);
  assert.equal(staticRoot.kind, "directory", `${course.id} staticRoot must be a directory`);
  assert.equal(staticRoot.state, "present", `${course.id} staticRoot must be present`);
  assert.equal(resource.kind, "file", `${course.id} ${resourceName} must be a file`);
  assert.equal(resource.state, "present", `${course.id} ${resourceName} must be present`);
  const staticRootPath = normalizedRepositoryPath(staticRoot.path, `${course.id} staticRoot`);
  const resourcePath = normalizedRepositoryPath(resource.path, `${course.id} ${resourceName}`);
  const relativePath = posix.relative(staticRootPath, resourcePath);
  assert.ok(
    relativePath && relativePath !== ".." && !relativePath.startsWith("../") && !posix.isAbsolute(relativePath),
    `${course.id} ${resourceName} must be inside its staticRoot`,
  );
  return Object.freeze({
    publicPath: `${course.routePrefix}/${relativePath}`,
    relativePath,
    resourcePath,
    staticRootPath,
  });
}

export function createPagesLanguagePlan({ catalog, courses }) {
  assert.ok(isObject(catalog), "Language catalog must be an object");
  assert.ok(Array.isArray(catalog.courses), "Language catalog courses must be an array");
  assert.match(String(catalog.defaultCourseId || ""), courseIdPattern, "Language catalog has an invalid default course ID");
  assert.ok(Array.isArray(catalog.reservedRoutePrefixes), "Language catalog reserved route prefixes must be an array");
  for (const routePrefix of catalog.reservedRoutePrefixes) {
    assert.match(String(routePrefix || ""), routePrefixPattern, "Language catalog has an invalid reserved route prefix");
  }
  assertUniqueValues(catalog.reservedRoutePrefixes, "Language catalog reserved route prefixes");
  const reservedRoutePrefixes = new Set(catalog.reservedRoutePrefixes);
  assert.ok(Array.isArray(courses), "Language course records must be an array");
  assert.equal(courses.length, catalog.courses.length, "Every catalog course must have one loaded manifest");

  const recordsById = new Map();
  for (const record of courses) {
    assert.ok(isObject(record), "Language course record must be an object");
    assert.match(String(record.id || ""), courseIdPattern, "Language course record has an invalid ID");
    assert.ok(!recordsById.has(record.id), `Language course manifest is repeated: ${record.id}`);
    recordsById.set(record.id, record);
  }

  const seenCatalogIds = new Set();
  const plannedCourses = [];
  const browserCourses = [];
  for (const entry of catalog.courses) {
    assert.ok(isObject(entry), "Language catalog course entry must be an object");
    assert.match(String(entry.id || ""), courseIdPattern, "Language catalog entry has an invalid ID");
    assert.ok(!seenCatalogIds.has(entry.id), `Language catalog course is repeated: ${entry.id}`);
    seenCatalogIds.add(entry.id);

    const record = recordsById.get(entry.id);
    assert.ok(record, `Language catalog course has no loaded manifest: ${entry.id}`);
    assert.equal(record.manifestPath, entry.manifest, `${entry.id} manifest path disagrees with the catalog`);
    const course = record.course;
    assert.ok(isObject(course), `${entry.id} course manifest must be an object`);
    assert.equal(course.id, entry.id, `${entry.id} course manifest ID disagrees with the catalog`);
    assert.match(String(course.directoryName || ""), courseIdPattern, `${entry.id} course directoryName is invalid`);
    const expectedManifestPath = `apps/languages/${course.directoryName}/course.json`;
    assert.equal(entry.manifest, expectedManifestPath, `${entry.id} manifest path is not its canonical course location`);

    const browser = course.platforms?.browser;
    assert.ok(isObject(browser), `${entry.id} course manifest has no browser platform declaration`);
    assert.equal(typeof browser.enabled, "boolean", `${entry.id} browser enabled flag must be boolean`);
    assert.equal(typeof browser.pagesEnabled, "boolean", `${entry.id} browser Pages flag must be boolean`);
    assert.ok(
      !browser.pagesEnabled || browser.enabled,
      `${entry.id} cannot enable Pages while its browser platform is disabled`,
    );
    assert.match(String(course.routePrefix || ""), routePrefixPattern, `${entry.id} route prefix is invalid`);
    assert.ok(
      !reservedRoutePrefixes.has(course.routePrefix),
      `${entry.id} route prefix is reserved and cannot be published as a course: ${course.routePrefix}`,
    );
    assert.equal(browser.entryPath, course.entryPath, `${entry.id} browser entry path disagrees with the course entry path`);
    assert.equal(typeof browser.entryPath, "string", `${entry.id} browser entry path must be a string`);
    assert.ok(
      browser.entryPath.startsWith(`${course.routePrefix}/`)
        && !browser.entryPath.endsWith("/")
        && !browser.entryPath.includes("\\")
        && !browser.entryPath.includes("?")
        && !browser.entryPath.includes("#")
        && browser.entryPath.slice(course.routePrefix.length + 1).split("/")
          .every((segment) => segment && segment !== "." && segment !== ".."),
      `${entry.id} browser entry path must be a file beneath ${course.routePrefix}/`,
    );

    const setup = courseResourcePublicPath(course, "setupCatalog");
    const profile = courseResourcePublicPath(course, "courseProfile");
    const expectedStaticRootPath = `apps/languages/${course.directoryName}/static`;
    assert.equal(setup.staticRootPath, expectedStaticRootPath, `${entry.id} staticRoot is not its canonical course location`);
    assert.equal(profile.staticRootPath, expectedStaticRootPath, `${entry.id} courseProfile staticRoot is not its canonical course location`);
    const expectedSetupPath = `${expectedStaticRootPath}/setup-assets.json`;
    assert.equal(setup.resourcePath, expectedSetupPath, `${entry.id} setupCatalog is not its canonical course location`);
    assert.equal(typeof course.platforms?.android?.enabled, "boolean", `${entry.id} Android enabled flag must be boolean`);
    const plannedCourse = Object.freeze({
      id: entry.id,
      status: course.status,
      directoryName: course.directoryName,
      manifestPath: entry.manifest,
      staticRootPath: setup.staticRootPath,
      setupRepositoryPath: setup.resourcePath,
      setupRelativePath: setup.relativePath,
      profileRepositoryPath: profile.resourcePath,
      profileRelativePath: profile.relativePath,
      routePrefix: course.routePrefix,
      publicRoute: `${course.routePrefix}/`,
      entryPath: browser.entryPath,
      setupPath: setup.publicPath,
      profilePath: profile.publicPath,
      pagesEnabled: browser.pagesEnabled,
      androidEnabled: course.platforms.android.enabled,
    });
    plannedCourses.push(plannedCourse);
    if (browser.enabled && browser.pagesEnabled) browserCourses.push(plannedCourse);
  }

  assert.equal(recordsById.size, seenCatalogIds.size, "Loaded language manifests must match the catalog exactly");
  const defaultCourse = plannedCourses.find(({ id }) => id === catalog.defaultCourseId);
  assert.ok(defaultCourse, `Default course ${catalog.defaultCourseId} is not present in the language catalog`);
  assert.ok(
    browserCourses.includes(defaultCourse),
    `Default course ${catalog.defaultCourseId} must be browser- and Pages-enabled`,
  );
  assertUniqueValues(
    plannedCourses.map(({ publicRoute }) => publicRoute),
    "Pages course public routes",
  );
  assertUniqueValues(
    plannedCourses.flatMap(({ entryPath, setupPath, profilePath }) => [entryPath, setupPath, profilePath]),
    "Pages course entry, setup, and profile paths",
  );

  const requiredEntrypoints = Object.freeze([
    "/",
    ...browserCourses.flatMap(({ publicRoute, entryPath }) => [publicRoute, entryPath]),
  ]);
  const requiredOutputPaths = Object.freeze(
    browserCourses.flatMap(({ entryPath, setupPath, profilePath }) => [
      entryPath.slice(1),
      setupPath.slice(1),
      profilePath.slice(1),
    ]),
  );
  const withheldCourses = plannedCourses.filter((course) => !browserCourses.includes(course));
  return Object.freeze({
    defaultCourseId: catalog.defaultCourseId,
    defaultCourse,
    reservedRoutePrefixes: Object.freeze([...catalog.reservedRoutePrefixes]),
    browserCourses: Object.freeze(browserCourses),
    requiredEntrypoints,
    requiredOutputPaths,
    forbiddenOutputPaths: Object.freeze(
      withheldCourses.flatMap(({ entryPath, setupPath, profilePath }) => [
        entryPath.slice(1),
        setupPath.slice(1),
        profilePath.slice(1),
      ]),
    ),
    forbiddenOutputPrefixes: Object.freeze(
      withheldCourses.map(({ publicRoute }) => publicRoute.slice(1)),
    ),
  });
}

export function loadPagesLanguagePlan({ workspaceRoot, catalogPath = defaultCatalogPath } = {}) {
  assert.equal(typeof workspaceRoot, "string", "Pages language plan requires a workspace root");
  const realRoot = realpathSync(resolve(workspaceRoot));
  assert.ok(lstatSync(realRoot).isDirectory(), "Pages workspace root must be a directory");
  const normalizedCatalogPath = normalizedRepositoryPath(catalogPath, "Language catalog");
  assert.equal(
    normalizedCatalogPath,
    defaultCatalogPath,
    `Pages language catalog must be ${defaultCatalogPath}`,
  );
  const realCatalogPath = requireCanonicalRepositoryEntry(
    realRoot,
    normalizedCatalogPath,
    "Language catalog",
    "file",
  );
  const catalog = JSON.parse(readFileSync(realCatalogPath, "utf8"));
  assert.ok(Array.isArray(catalog.courses), "Language catalog courses must be an array");
  const courses = catalog.courses.map((entry) => {
    assert.equal(typeof entry?.manifest, "string", `${entry?.id || "unknown"} manifest path must be a string`);
    const manifestPath = normalizedRepositoryPath(entry.manifest, `${entry.id || "unknown"} manifest`);
    const courseRootPath = posix.dirname(manifestPath);
    requireCanonicalRepositoryEntry(realRoot, courseRootPath, `${entry.id || "unknown"} course root`, "directory");
    const realManifestPath = requireCanonicalRepositoryEntry(
      realRoot,
      manifestPath,
      `${entry.id || "unknown"} manifest`,
      "file",
    );
    const course = JSON.parse(readFileSync(realManifestPath, "utf8"));
    assert.match(String(course?.directoryName || ""), courseIdPattern, `${entry.id || "unknown"} directoryName is invalid`);
    const expectedCourseRootPath = `apps/languages/${course.directoryName}`;
    assert.equal(courseRootPath, expectedCourseRootPath, `${entry.id || "unknown"} course root is not canonical`);
    const staticRootPath = normalizedRepositoryPath(course.resources?.staticRoot?.path, `${entry.id || "unknown"} staticRoot`);
    const setupPath = normalizedRepositoryPath(course.resources?.setupCatalog?.path, `${entry.id || "unknown"} setupCatalog`);
    assert.equal(staticRootPath, `${expectedCourseRootPath}/static`, `${entry.id || "unknown"} staticRoot is not canonical`);
    assert.equal(setupPath, `${staticRootPath}/setup-assets.json`, `${entry.id || "unknown"} setupCatalog is not canonical`);
    requireCanonicalRepositoryEntry(realRoot, staticRootPath, `${entry.id || "unknown"} staticRoot`, "directory");
    requireCanonicalRepositoryEntry(realRoot, setupPath, `${entry.id || "unknown"} setupCatalog`, "file");
    return {
      id: entry.id,
      manifestPath,
      course,
    };
  });
  return createPagesLanguagePlan({ catalog, courses });
}

export function assertPagesLanguageCoverage({
  plan,
  declaredEntrypoints,
  label = "Pages entrypoint declaration",
}) {
  assert.ok(isObject(plan), "Pages language plan must be an object");
  assert.ok(Array.isArray(plan.browserCourses), "Pages language plan browser courses must be an array");
  assert.ok(Array.isArray(plan.requiredEntrypoints), "Pages language plan required entrypoints must be an array");
  assert.ok(Array.isArray(declaredEntrypoints), "Pages entrypoint declaration must be an array");
  for (const entrypoint of declaredEntrypoints) {
    assert.equal(typeof entrypoint, "string", `${label} entries must be strings`);
  }
  assertUniqueValues(declaredEntrypoints, label);

  const expected = new Set(plan.requiredEntrypoints);
  const declared = new Set(declaredEntrypoints);
  const missing = plan.requiredEntrypoints.filter((entrypoint) => !declared.has(entrypoint));
  const unexpected = declaredEntrypoints.filter((entrypoint) => !expected.has(entrypoint));
  assert.equal(
    missing.length + unexpected.length,
    0,
    `${label} must exactly match catalog browser coverage; missing: ${missing.join(", ") || "none"}; unexpected/stale: ${unexpected.join(", ") || "none"}`,
  );
  assert.deepEqual(
    declaredEntrypoints,
    plan.requiredEntrypoints,
    `${label} order must match the language catalog (default course: ${plan.defaultCourseId})`,
  );
  return plan;
}

export function normalizePagesCourseSetupMarker({ setup, setupFile }) {
  assert.ok(isObject(setup), `Pages course setup must be an object: ${setupFile}`);
  assert.equal(typeof setupFile, "string", "Pages course setup path must be a string");
  const segments = setupFile.split("/");
  assert.ok(
    segments.length >= 2 && segments.at(-1) === "setup-assets.json",
    `Pages course setup path is invalid: ${setupFile}`,
  );
  const routeSegment = segments[0];
  const publicRoute = `/${routeSegment}/`;
  assert.match(`/${routeSegment}`, routePrefixPattern, `Pages course setup route is invalid: ${setupFile}`);
  const recognizedCzechLegacyV1 = setupFile === "cz/setup-assets.json"
    && setup.version === 1
    && setup.cache_name === "caatuu-czech-setup-v1";
  const id = Object.hasOwn(setup, "courseId")
    ? setup.courseId
    : (recognizedCzechLegacyV1 ? "cz" : undefined);
  assert.match(String(id || ""), courseIdPattern, `Pages course setup has no valid course ID: ${setupFile}`);
  const entryPath = setup.application?.entryPath
    ?? (recognizedCzechLegacyV1 ? "/cz/index.html" : undefined);
  assert.equal(typeof entryPath, "string", `Pages course setup has no application entry path: ${setupFile}`);
  assert.ok(
    entryPath.startsWith(publicRoute)
      && !entryPath.endsWith("/")
      && !entryPath.includes("\\")
      && !entryPath.includes("?")
      && !entryPath.includes("#")
      && entryPath.slice(publicRoute.length).split("/")
        .every((segment) => segment && segment !== "." && segment !== ".."),
    `Pages course setup entry must be a file beneath ${publicRoute}: ${setupFile}`,
  );
  return Object.freeze({ id, publicRoute, entryPath, setupPath: `/${setupFile}` });
}

export function assertPagesLanguageOutputCoverage({ plan, publishedFiles, readPublishedFile }) {
  assert.ok(isObject(plan), "Pages language plan must be an object");
  assert.ok(Array.isArray(plan.browserCourses), "Pages language plan browser courses must be an array");
  assert.ok(Array.isArray(plan.requiredOutputPaths), "Pages language plan required output paths must be an array");
  assert.ok(Array.isArray(plan.forbiddenOutputPaths), "Pages language plan forbidden output paths must be an array");
  assert.ok(Array.isArray(plan.forbiddenOutputPrefixes), "Pages language plan forbidden output prefixes must be an array");
  assert.ok(Array.isArray(plan.reservedRoutePrefixes), "Pages language plan reserved route prefixes must be an array");
  assert.ok(Array.isArray(publishedFiles), "Pages published file inventory must be an array");
  assert.equal(typeof readPublishedFile, "function", "Pages output validation requires a published-file reader");
  for (const path of publishedFiles) {
    assert.equal(typeof path, "string", "Pages published file inventory entries must be strings");
  }
  assertUniqueValues(publishedFiles, "Pages published file inventory");
  const published = new Set(publishedFiles);
  const missing = plan.requiredOutputPaths.filter((path) => !published.has(path));
  assert.equal(
    missing.length,
    0,
    `Pages output is missing catalog-required browser language files: ${missing.join(", ")}`,
  );
  const forbidden = plan.forbiddenOutputPaths.filter((path) => published.has(path));
  assert.equal(
    forbidden.length,
    0,
    `Pages output contains a Pages-withheld course file: ${forbidden.join(", ")}`,
  );
  const forbiddenByPrefix = publishedFiles.filter((path) => (
    plan.forbiddenOutputPrefixes.some((prefix) => path.startsWith(prefix))
  ));
  assert.equal(
    forbiddenByPrefix.length,
    0,
    `Pages output contains files below a Pages-withheld course route: ${forbiddenByPrefix.join(", ")}`,
  );

  const publishedCourses = publishedFiles
    .filter((path) => path.endsWith("/setup-assets.json"))
    .filter((path) => {
      const segments = path.split("/");
      return segments.length === 2 && routePrefixPattern.test(`/${segments[0]}`);
    })
    .map((setupFile) => {
      const raw = readPublishedFile(setupFile);
      assert.equal(typeof raw, "string", `Pages published-file reader must return text for ${setupFile}`);
      let setup;
      try {
        setup = JSON.parse(raw);
      } catch (error) {
        assert.fail(`Pages course setup is not valid JSON: ${setupFile}: ${error.message}`);
      }
      const marker = normalizePagesCourseSetupMarker({ setup, setupFile });
      assert.ok(
        published.has(marker.entryPath.slice(1)),
        `Pages course setup declares a missing browser entry: ${setupFile} -> ${marker.entryPath}`,
      );
      return marker;
    })
    .sort((left, right) => left.setupPath.localeCompare(right.setupPath, "en"));
  assertUniqueValues(publishedCourses.map(({ id }) => id), "Pages published course setup IDs");
  const expectedCourses = plan.browserCourses
    .map(({ id, publicRoute, entryPath, setupPath }) => ({ id, publicRoute, entryPath, setupPath }))
    .sort((left, right) => left.setupPath.localeCompare(right.setupPath, "en"));
  assert.deepEqual(
    publishedCourses,
    expectedCourses,
    "Pages published course setup markers must exactly match Pages-enabled catalog courses",
  );
  return plan;
}
