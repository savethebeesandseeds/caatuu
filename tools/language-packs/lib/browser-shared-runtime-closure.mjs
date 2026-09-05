import { NON_CAMPAIGN_GAME_REGISTRY } from "../../../apps/language-runtime/static/source/shell-policy.mjs";

const SHARED_RUNTIME_SOURCE_PREFIX = "apps/language-runtime/";
const SHARED_RUNTIME_OUTPUT_PREFIX = "language-runtime/";
const INTERFACE_CATALOG_SOURCE_PREFIX =
  "apps/language-runtime/static/data/interface/";
const INTERFACE_CATALOG_OUTPUT_PREFIX =
  "language-runtime/static/data/interface/";
const INTERFACE_CATALOG_FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/u;

export const BUILD_ONLY_COURSE_SERVICE_WORKER_MAPPING = Object.freeze({
  source: "apps/language-runtime/static/source/course-service-worker.js",
  output: "language-runtime/static/source/course-service-worker.js"
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(code, message) {
  return { code, message };
}

export function browserSetupCacheNamespaceIssues({ course, setupCatalog } = {}) {
  const courseId = course?.id || "course";
  const expectedPrefix = course?.cache?.prefix;
  const offline = setupCatalog?.offline;
  if (typeof expectedPrefix !== "string" || expectedPrefix.length === 0) {
    return [issue(
      "browser.cache-namespace",
      `${courseId} cannot resolve its course.cache.prefix authority.`
    )];
  }
  if (!isObject(offline)) {
    return [issue(
      "browser.cache-namespace",
      `${courseId} cannot resolve its browser setup offline cache policy.`
    )];
  }

  const issues = [];
  if (offline.cachePrefix !== expectedPrefix) {
    issues.push(issue(
      "browser.cache-namespace",
      `${courseId} setup offline.cachePrefix ${JSON.stringify(offline.cachePrefix)} must exactly match course.cache.prefix ${JSON.stringify(expectedPrefix)}.`
    ));
  }
  const cacheName = offline.cacheName;
  if (
    typeof cacheName !== "string"
    || !cacheName.startsWith(expectedPrefix)
    || !/-v\d+$/u.test(cacheName)
  ) {
    issues.push(issue(
      "browser.cache-namespace",
      `${courseId} setup offline.cacheName ${JSON.stringify(cacheName)} must start with course.cache.prefix ${JSON.stringify(expectedPrefix)} and end in a numeric -v revision.`
    ));
  }
  return issues;
}

function publicPathname(output) {
  return new URL(`/${output}`, "https://caatuu.invalid/").pathname;
}

function setupAssetPathname(asset, routePrefix) {
  if (typeof asset !== "string" || asset.length === 0) return null;
  try {
    const base = new URL(`${String(routePrefix || "/").replace(/\/$/u, "")}/`, "https://caatuu.invalid/");
    const url = new URL(asset, base);
    return url.origin === base.origin ? url.pathname : null;
  } catch {
    return null;
  }
}

function setupAssetUrlKey(asset, routePrefix) {
  if (typeof asset !== "string" || asset.length === 0) return null;
  try {
    const base = new URL(`${String(routePrefix || "/").replace(/\/$/u, "")}/`, "https://caatuu.invalid/");
    const url = new URL(asset, base);
    return url.origin === base.origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

function interfaceCatalogMapping(mapping) {
  if (!isObject(mapping)) return false;
  const source = String(mapping.source || "");
  const output = String(mapping.output || "");
  const sourceName = source.slice(INTERFACE_CATALOG_SOURCE_PREFIX.length);
  const outputName = output.slice(INTERFACE_CATALOG_OUTPUT_PREFIX.length);
  return source.startsWith(INTERFACE_CATALOG_SOURCE_PREFIX)
    && output.startsWith(INTERFACE_CATALOG_OUTPUT_PREFIX)
    && INTERFACE_CATALOG_FILE_PATTERN.test(sourceName)
    && sourceName === outputName;
}

function setupInterfaceCatalogRecord(asset, routePrefix) {
  if (typeof asset !== "string" || asset.length === 0) return null;
  try {
    const base = new URL(
      `${String(routePrefix || "/").replace(/\/$/u, "")}/`,
      "https://caatuu.invalid/"
    );
    const url = new URL(asset, base);
    if (url.origin !== base.origin
        || !url.pathname.startsWith(`/${INTERFACE_CATALOG_OUTPUT_PREFIX}`)) return null;
    return Object.freeze({
      key: `${url.pathname}${url.search}${url.hash}`,
      pathname: url.pathname
    });
  } catch {
    return null;
  }
}

/**
 * Interface message catalogs are shared published data, but they are selected
 * per learner-base course. A browser course must cache exactly its declared
 * catalog revision, never every locale present in the shared app catalog.
 */
export function browserInterfaceContentClosureIssues({
  course,
  appAssetCatalog,
  setupCatalog
} = {}) {
  const courseId = course?.id || "course";
  const resource = course?.resources?.interfaceCatalog;
  const source = String(resource?.path || "");
  const revision = String(resource?.revision || "").trim();
  const sourceName = source.slice(INTERFACE_CATALOG_SOURCE_PREFIX.length);
  if (!source.startsWith(INTERFACE_CATALOG_SOURCE_PREFIX)
      || !INTERFACE_CATALOG_FILE_PATTERN.test(sourceName)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(revision)) {
    return [issue(
      "browser.interface-content-package",
      `${courseId} cannot resolve a revisioned shared interface catalog.`
    )];
  }

  const output = source.slice("apps/".length);
  const pathname = publicPathname(output);
  const expectedUrl = new URL(pathname, "https://caatuu.invalid/");
  expectedUrl.searchParams.set("v", revision);
  const expectedKey = `${expectedUrl.pathname}${expectedUrl.search}`;
  const issues = [];

  if (!isObject(appAssetCatalog) || !Array.isArray(appAssetCatalog.assets)) {
    issues.push(issue(
      "browser.interface-content-catalog",
      `${courseId} cannot resolve the shared app asset catalog for ${source}.`
    ));
  } else {
    const matchingMappings = appAssetCatalog.assets.filter((mapping) => (
      isObject(mapping) && (mapping.source === source || mapping.output === output)
    ));
    const exactMappings = matchingMappings.filter((mapping) => (
      mapping.source === source && mapping.output === output
    ));
    if (exactMappings.length !== 1 || matchingMappings.length !== 1) {
      issues.push(issue(
        "browser.interface-content-catalog",
        `${courseId} interface catalog must have exactly one app-assets mapping from ${source} to ${output}.`
      ));
    }
  }

  if (!isObject(setupCatalog) || !Array.isArray(setupCatalog?.offline?.assets)) {
    issues.push(issue(
      "browser.interface-content-package",
      `${courseId} cannot resolve its browser setup offline asset list for interface content.`
    ));
    return issues;
  }

  const records = setupCatalog.offline.assets
    .map((asset) => setupInterfaceCatalogRecord(asset, course?.routePrefix))
    .filter(Boolean);
  const selected = records.filter((record) => record.pathname === pathname);
  if (selected.length === 0) {
    issues.push(issue(
      "browser.interface-content-package",
      `${courseId} setup offline assets omit the exact interface catalog URL ${expectedKey}.`
    ));
  } else if (selected.length !== 1) {
    issues.push(issue(
      "browser.interface-content-package",
      `${courseId} setup offline assets repeat interface catalog pathname ${pathname} ${selected.length} times.`
    ));
  } else if (selected[0].key !== expectedKey) {
    issues.push(issue(
      "browser.interface-content-package",
      `${courseId} setup offline assets must cache exact interface catalog URL ${expectedKey}; found ${selected[0].key}.`
    ));
  }

  const unrelated = records.filter((record) => record.pathname !== pathname);
  if (unrelated.length > 0) {
    issues.push(issue(
      "browser.interface-content-package",
      `${courseId} setup offline assets include undeclared interface catalogs: ${[
        ...new Set(unrelated.map(({ key }) => key))
      ].join(", ")}.`
    ));
  }
  return issues;
}

function courseGameResourceUrlKey(course, resourceName) {
  const staticRoot = String(course?.resources?.staticRoot?.path || "").replace(/\/+$/u, "");
  const resource = course?.resources?.[resourceName];
  const resourcePath = String(resource?.path || "");
  if (!staticRoot || !resourcePath.startsWith(`${staticRoot}/`)) return null;
  const relativePath = resourcePath.slice(staticRoot.length + 1);
  const revision = String(resource?.revision || "").trim();
  const browserUrl = revision ? `${relativePath}?v=${revision}` : relativePath;
  return setupAssetUrlKey(browserUrl, course?.routePrefix);
}

/**
 * Every enabled authored game must cache the exact course-owned JSON URL that
 * the generated course profile gives its shared host. Query revisions are part
 * of the identity: caching an unversioned or stale URL does not make the game
 * available offline.
 */
export function browserCourseGameContentClosureIssues({ course, setupCatalog } = {}) {
  const courseId = course?.id || "course";
  if (!isObject(setupCatalog) || !Array.isArray(setupCatalog?.offline?.assets)) {
    return [issue(
      "browser.game-content-package",
      `${courseId} cannot resolve its browser setup offline asset list for game content.`
    )];
  }

  const cachedCounts = new Map();
  for (const asset of setupCatalog.offline.assets) {
    const key = setupAssetUrlKey(asset, course?.routePrefix);
    if (key) cachedCounts.set(key, (cachedCounts.get(key) || 0) + 1);
  }

  const issues = [];
  for (const gameId of course?.games ?? []) {
    const requirements = NON_CAMPAIGN_GAME_REGISTRY[gameId]?.resources ?? [];
    for (const { name: resourceName } of requirements) {
      const expected = courseGameResourceUrlKey(course, resourceName);
      if (!expected) {
        issues.push(issue(
          "browser.game-content-package",
          `${courseId}.${gameId} cannot project resources.${resourceName} into its course browser route.`
        ));
        continue;
      }
      const count = cachedCounts.get(expected) || 0;
      if (count === 0) {
        issues.push(issue(
          "browser.game-content-package",
          `${courseId} setup offline assets omit the exact ${gameId}.${resourceName} URL ${expected}.`
        ));
      } else if (count !== 1) {
        issues.push(issue(
          "browser.game-content-package",
          `${courseId} setup offline assets repeat the exact ${gameId}.${resourceName} URL ${expected} ${count} times.`
        ));
      }
    }
  }
  return issues;
}

export function browserSharedRuntimeClosureIssues({
  appAssetCatalog,
  setupCatalog,
  courseId = "course",
  routePrefix = "/"
} = {}) {
  const issues = [];
  if (!isObject(appAssetCatalog) || !Array.isArray(appAssetCatalog.assets)) {
    return [issue(
      "browser.shared-runtime-catalog",
      `${courseId} cannot resolve the shared app asset catalog.`
    )];
  }
  if (!isObject(setupCatalog) || !Array.isArray(setupCatalog?.offline?.assets)) {
    return [issue(
      "browser.shared-runtime-package",
      `${courseId} cannot resolve its browser setup offline asset list.`
    )];
  }

  const expectedByPathname = new Map();
  const mappedPathnames = new Set();
  for (const [index, mapping] of appAssetCatalog.assets.entries()) {
    if (!isObject(mapping)) {
      issues.push(issue(
        "browser.shared-runtime-catalog",
        `Shared app asset mapping ${index} is not an object.`
      ));
      continue;
    }
    const source = mapping.source;
    const output = mapping.output;
    if (typeof source !== "string" || typeof output !== "string") {
      issues.push(issue(
        "browser.shared-runtime-catalog",
        `Shared app asset mapping ${index} must declare string source and output paths.`
      ));
      continue;
    }

    const sourceIsSharedRuntime = source.startsWith(SHARED_RUNTIME_SOURCE_PREFIX);
    const outputIsSharedRuntime = output.startsWith(SHARED_RUNTIME_OUTPUT_PREFIX);
    if (outputIsSharedRuntime && !sourceIsSharedRuntime) {
      issues.push(issue(
        "browser.shared-runtime-catalog",
        `Shared runtime output ${output} is remapped from non-runtime source ${source}.`
      ));
      continue;
    }
    if (!sourceIsSharedRuntime || !outputIsSharedRuntime) continue;

    const canonicalOutput = source.slice("apps/".length);
    if (output !== canonicalOutput) {
      issues.push(issue(
        "browser.shared-runtime-catalog",
        `Shared runtime source ${source} is remapped to ${output} instead of ${canonicalOutput}.`
      ));
      continue;
    }
    const pathname = publicPathname(output);
    if (mappedPathnames.has(pathname)) {
      issues.push(issue(
        "browser.shared-runtime-catalog",
        `Shared app asset catalog repeats browser runtime pathname ${pathname}.`
      ));
      continue;
    }
    mappedPathnames.add(pathname);
    if (
      source === BUILD_ONLY_COURSE_SERVICE_WORKER_MAPPING.source
      && output === BUILD_ONLY_COURSE_SERVICE_WORKER_MAPPING.output
    ) continue;
    if (interfaceCatalogMapping(mapping)) continue;
    expectedByPathname.set(pathname, { source, output });
  }

  const counts = new Map([...expectedByPathname.keys()].map((pathname) => [pathname, 0]));
  for (const asset of setupCatalog.offline.assets) {
    const pathname = setupAssetPathname(asset, routePrefix);
    if (counts.has(pathname)) counts.set(pathname, counts.get(pathname) + 1);
  }
  for (const [pathname, count] of counts) {
    if (count === 0) {
      issues.push(issue(
        "browser.shared-runtime-package",
        `${courseId} setup offline assets omit shared runtime pathname ${pathname}.`
      ));
    } else if (count !== 1) {
      issues.push(issue(
        "browser.shared-runtime-package",
        `${courseId} setup offline assets repeat shared runtime pathname ${pathname} ${count} times.`
      ));
    }
  }
  return issues;
}
