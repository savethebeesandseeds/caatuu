import { createInterfaceContent, INTERFACE_CONTENT_SCHEMA } from "./interface-content.mjs?v=interface-runtime-2";

export const launcherLocales = Object.freeze([
  Object.freeze({ locale: "en", nativeLabel: "English" }),
  Object.freeze({ locale: "es-ES", nativeLabel: "Español" })
]);

// Landing-page copy is independent of course publication and learner preferences.
const messages = {
  "es-ES": {
    "launcher.android.loadfailed": "No se ha podido comprobar la disponibilidad de Android",
    "launcher.android.retryaria": "{message}. Volver a comprobar.",
    "launcher.footnote": "No pierdas tiempo: empieza a aprender.",
    "launcher.available": "Cursos disponibles",
    "launcher.entryoptions": "Opciones para abrir la aplicación",
    "common.browser": "Navegador",
    "languages.fr": "Francés",
    "launcher.by": "de Waajacu",
    "launcher.continue": "Continuar en línea",
    "course.direction": "De {source} a {target}",
    "launcher.android.downloadpreview": "Descargar la versión preliminar de Caatuu",
    "launcher.description": "Caatuu es una aplicación gratuita para aprender idiomas con práctica guiada de palabras, frases y traducción, y herramientas que también funcionan sin conexión.",
    "launcher.android.downloadbeta": "Descargar Caatuu",
    "launcher.welcome": "Te damos la bienvenida, viajero de los idiomas",
    "launcher.android.checking": "Comprobando la versión de Android",
    "launcher.android.unavailable": "Android no está disponible",
    "languages.zh.hans": "Chino simplificado",
    "launcher.android.temporary": "Android no está disponible temporalmente",
    "languages.ja": "Japonés",
    "launcher.android.preview": "Versión preliminar de Android",
    "languages.es": "Español",
    "languages.cs": "Checo",
    "launcher.title": "Aprende idiomas",
    "launcher.android.beta": "Aplicación Android",
    "languages.ko": "Coreano",
    "common.preview": "Vista previa",
    "launcher.continuearia": "Continuar en línea en el navegador",
    "launcher.android.unpublished": "La versión preliminar de Android aún no está publicada",
    "languages.en": "Inglés",
    "launcher.android.retry": "Volver a comprobar la descarga de Android",
    "languages.de": "Alemán",
    "languages.zh": "Chino",
    "launcher.language": "Idioma de la página"
  },
  "en": {
    "launcher.android.loadfailed": "Android availability could not be loaded",
    "launcher.android.retryaria": "{message}. Check again.",
    "launcher.footnote": "Don't lose time, let's get started learning.",
    "launcher.available": "Available courses",
    "launcher.entryoptions": "App entry options",
    "common.browser": "Browser",
    "languages.fr": "French",
    "launcher.by": "by Waajacu",
    "launcher.continue": "Continue online",
    "course.direction": "{source} to {target}",
    "launcher.android.downloadpreview": "Download Caatuu preview",
    "launcher.description": "Caatuu is a free language-learning app for guided practice with words, phrases, translation, and tools that also work offline.",
    "launcher.android.downloadbeta": "Download Caatuu",
    "launcher.welcome": "Welcome space language traveler",
    "launcher.android.checking": "Checking Android build",
    "launcher.android.unavailable": "Android not available",
    "languages.zh.hans": "Simplified Chinese",
    "launcher.android.temporary": "Android temporarily unavailable",
    "languages.ja": "Japanese",
    "launcher.android.preview": "Android preview",
    "languages.es": "Spanish",
    "languages.cs": "Czech",
    "launcher.title": "Language App",
    "launcher.android.beta": "Android app",
    "languages.ko": "Korean",
    "common.preview": "Preview",
    "launcher.continuearia": "Continue online in the browser",
    "launcher.android.unpublished": "Android preview not published",
    "languages.en": "English",
    "launcher.android.retry": "Check Android download again",
    "languages.de": "German",
    "languages.zh": "Chinese",
    "launcher.language": "Page language"
  }
};

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

export function selectLauncherCourse(registry) {
  const courses = launcherCourses(registry);
  return courses.find((course) => course.id === registry.defaultLanguage) || courses[0] || null;
}

export async function loadLauncherInterface(registry, preferredLocales = []) {
  const selected = preferredLocales.map(canonicalLocale).map((locale) => (
    launcherLocales.find((entry) => entry.locale === locale)
      || launcherLocales.find((entry) => entry.locale.split("-")[0] === locale.split("-")[0])
  )).find(Boolean) || launcherLocales[0];
  const content = createInterfaceContent({
    $schema: INTERFACE_CONTENT_SCHEMA,
    schemaVersion: 1,
    locale: selected.locale,
    direction: "ltr",
    revision: "launcher-copy-1",
    messages: messages[selected.locale]
  });
  return { course: selectLauncherCourse(registry), content };
}
