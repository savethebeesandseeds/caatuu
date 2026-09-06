import { loadInterfaceContent } from "./interface-content.mjs?v=interface-runtime-2";

function canonicalLocale(value) {
  try { return Intl.getCanonicalLocales(String(value || ""))[0] || ""; } catch { return ""; }
}

export function launcherCourses(registry) {
  if (registry?.browserSetup?.schemaVersion !== 1 || !Array.isArray(registry.browserSetup.courses)) return [];
  return registry.browserSetup.courses.filter((course) => (
    ["active", "development"].includes(course?.status)
    && canonicalLocale(course.sourceLanguage?.locale)
    && course.targetLanguage
    && typeof course.entryPath === "string"
    && course.entryPath.startsWith("/") && !course.entryPath.startsWith("//")
  ));
}

export function selectLauncherCourse(registry, preferredLocales = []) {
  const courses = launcherCourses(registry);
  for (const preference of preferredLocales) {
    const locale = canonicalLocale(preference);
    if (!locale) continue;
    const matching = courses.find((course) => canonicalLocale(course.sourceLanguage.locale) === locale)
      || courses.find((course) => canonicalLocale(course.sourceLanguage.locale).split("-")[0] === locale.split("-")[0]);
    if (matching) return matching;
  }
  return courses.find((course) => course.id === registry.defaultLanguage) || courses[0] || null;
}

export async function loadLauncherInterface(registry, preferredLocales = [], options = {}) {
  const course = selectLauncherCourse(registry, preferredLocales);
  if (!course) throw new Error("No browser course is available.");
  const content = await loadInterfaceContent(course, options);
  return { course, content };
}
