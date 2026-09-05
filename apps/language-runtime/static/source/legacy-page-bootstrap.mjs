import {
  installInterfaceContent,
  loadInterfaceContent
} from "./interface-content.mjs?v=interface-runtime-1";

const BOOTSTRAP_PATH = "/language-runtime/static/source/legacy-page-bootstrap.mjs";
const CHROME_SCRIPT = "/language-runtime/static/source/caatuu-chrome.js?v=chrome-143";
const MAINTENANCE_SCRIPT = "/language-runtime/static/source/maintenance-ui.js?v=maintenance-18";
const FEATURE_MODULE_PATTERN = /^source\/(?:features|games)\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.js\?v=[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ROUTE_PREFIX_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function declaredFeatureModule(documentRef, origin) {
  const declarations = [...documentRef.scripts].filter((script) => {
    if (!script?.src || !script.hasAttribute?.("data-caatuu-feature-module")) return false;
    try {
      return new URL(script.src, origin).pathname === BOOTSTRAP_PATH;
    } catch {
      return false;
    }
  });
  if (declarations.length !== 1) {
    throw new Error("A legacy page must declare exactly one feature bootstrap.");
  }
  return String(declarations[0].dataset.caatuuFeatureModule || "").trim();
}

export function confinedLegacyFeatureUrl(featureModule, {
  course,
  locationHref
} = {}) {
  const declared = String(featureModule || "").trim();
  if (!FEATURE_MODULE_PATTERN.test(declared)) {
    throw new Error("The legacy feature module must be a confined, revisioned route-relative JavaScript path.");
  }
  const routePrefix = String(course?.routePrefix || "").replace(/\/$/u, "");
  if (!ROUTE_PREFIX_PATTERN.test(routePrefix)) {
    throw new Error("The legacy feature module requires a confined course route prefix.");
  }
  const pageUrl = new URL(String(locationHref || ""));
  const courseBase = new URL(`${routePrefix}/`, pageUrl.origin);
  const resolved = new URL(declared, courseBase);
  if (
    resolved.origin !== pageUrl.origin
    || !resolved.pathname.startsWith(`${routePrefix}/source/`)
    || resolved.hash
  ) {
    throw new Error("The legacy feature module escaped its course route.");
  }
  return resolved.href;
}

function loadClassicScript(src, {
  documentRef = globalThis.document,
  origin = globalThis.location?.origin
} = {}) {
  const url = new URL(src, origin);
  if (url.origin !== origin || ![CHROME_SCRIPT, MAINTENANCE_SCRIPT].includes(`${url.pathname}${url.search}`)) {
    throw new Error("The legacy page requested an unsupported shared script.");
  }
  return new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.src = url.href;
    script.async = false;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener("error", () => reject(new Error(`Could not load ${url.pathname}.`)), { once: true });
    documentRef.body.append(script);
  });
}

export async function bootstrapLegacyPage({
  course = globalThis.CaatuuCourse,
  documentRef = globalThis.document,
  locationHref = globalThis.location?.href,
  featureModule,
  loadInterface = loadInterfaceContent,
  installInterface = installInterfaceContent,
  loadShared = (src) => loadClassicScript(src, {
    documentRef,
    origin: new URL(locationHref).origin
  }),
  importFeature = (url) => import(url)
} = {}) {
  if (!course || typeof course !== "object") {
    throw new Error("The course profile must load before a legacy page.");
  }
  if (!documentRef || typeof documentRef !== "object") {
    throw new Error("A legacy page requires a document.");
  }
  const declared = featureModule ?? declaredFeatureModule(documentRef, new URL(locationHref).origin);
  const featureUrl = confinedLegacyFeatureUrl(declared, { course, locationHref });
  const interfaceContent = await loadInterface(course);
  installInterface(interfaceContent);
  interfaceContent.apply(documentRef);
  documentRef.documentElement.lang = course.sourceLanguage?.locale || course.sourceLanguage?.id || "en";
  documentRef.documentElement.dir = course.sourceLanguage?.direction || "ltr";
  await loadShared(CHROME_SCRIPT);
  await loadShared(MAINTENANCE_SCRIPT);
  await importFeature(featureUrl);
  documentRef.documentElement.dataset.caatuuLegacyPageReady = "true";
}

if (typeof document !== "undefined") {
  bootstrapLegacyPage().catch((error) => {
    document.documentElement.dataset.caatuuLegacyPageReady = "error";
    console.error(error);
  });
}
