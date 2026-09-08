import { createInterfaceContent, INTERFACE_CONTENT_SCHEMA } from "./interface-content.mjs?v=interface-runtime-2";

export const launcherLocales = Object.freeze([
  Object.freeze({ locale: "en", nativeLabel: "English" }),
  Object.freeze({ locale: "es-ES", nativeLabel: "Español" })
]);

// Landing-page copy is independent of course publication and learner preferences.
const messages = {
  "es-ES": {
    "common.audio.settings": "Configuración de audio",
    "music.volume": "Volumen de la música",
    "music.settings": "Música",
    "music.song": "Canción",
    "music.summary": "Suena mientras Caatuu está en primer plano.",
    "music.credits": "Créditos de música",
    "music.off": "Desactivada",
    "music.muted": "Todo el audio está silenciado.",
    "music.pending": "La música estará disponible después de la configuración.",
    "music.blocked": "Toca para reproducir música.",
    "music.play": "Reproducir música",
    "music.unavailable": "No se pudo reproducir la música. Inténtalo de nuevo.",
    "launcher.skip": "Ir al contenido",
    "launcher.nav.learn": "Aprender",
    "launcher.nav.courses": "Cursos",
    "launcher.nav.tools": "Herramientas",
    "launcher.nav.about": "Acerca de",
    "launcher.navigation": "Navegación principal",
    "launcher.hero.title": "Aprende idiomas.",
    "launcher.hero.worlds": "Explora nuevos mundos.",
    "launcher.start": "Empezar",
    "launcher.choose.close": "Cerrar",
    "launcher.choose.prompt": "¿Cómo quieres aprender?",
    "launcher.choose.android": "Aplicación Android",
    "launcher.choose.download": "Descargar Caatuu",
    "launcher.choose.unavailable": "La descarga de Android no está disponible temporalmente. Puedes continuar en el navegador.",
    "launcher.getstarted": "Comenzar la aventura",
    "launcher.viewcourses": "Explorar los cursos",
    "launcher.courses.previous": "Cursos anteriores",
    "launcher.courses.next": "Más cursos",
    "launcher.android.detail": "Aprende donde quieras, incluso sin conexión.",
    "launcher.browser.detail": "Sin instalar nada.",
    "launcher.feature.practice": "Práctica guiada",
    "launcher.feature.practice.detail": "Palabras y frases",
    "launcher.feature.translation": "Herramientas de traducción",
    "launcher.feature.translation.detail": "Comprende y explora",
    "launcher.feature.progress": "Sigue tu progreso",
    "launcher.feature.progress.detail": "Descubre cuánto has aprendido",
    "launcher.feature.free": "100% Gratis",
    "launcher.feature.free.detail": "Toda la aplicación. Sin pagar nada.\nSin registro, sin tarjetas de crédito, sin cookies. Código abierto. De verdad gratis.",
    "launcher.feature.offline": "Modo sin conexión",
    "launcher.feature.offline.detail": "Aprende donde quieras",
    "launcher.feature.safety": "Segura para los niños",
    "launcher.feature.safety.detail": "Sin ideología, sin propaganda, sin agendas ocultas, sin publicidad ni contenido dañino.",
    "launcher.about": "Un idioma, todo un mundo por descubrir.",
    "launcher.about.detail": "Caatuu combina la práctica guiada, los juegos y las herramientas de idiomas en una experiencia gratuita que también funciona sin conexión.",
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
    "common.audio.settings": "Audio settings",
    "music.volume": "Music volume",
    "music.settings": "Music",
    "music.song": "Song",
    "music.summary": "Plays while Caatuu is in focus.",
    "music.credits": "Music credits",
    "music.off": "Off",
    "music.muted": "All audio is muted.",
    "music.pending": "Music will be available after setup.",
    "music.blocked": "Tap to play music.",
    "music.play": "Play music",
    "music.unavailable": "Music could not play. Try again.",
    "launcher.skip": "Skip to content",
    "launcher.nav.learn": "Learn",
    "launcher.nav.courses": "Courses",
    "launcher.nav.tools": "Tools",
    "launcher.nav.about": "About",
    "launcher.navigation": "Main navigation",
    "launcher.hero.title": "Learn languages.",
    "launcher.hero.worlds": "Explore new worlds.",
    "launcher.start": "Start",
    "launcher.choose.close": "Close",
    "launcher.choose.prompt": "How would you like to learn?",
    "launcher.choose.android": "Android app",
    "launcher.choose.download": "Download Caatuu",
    "launcher.choose.unavailable": "The Android download is temporarily unavailable. You can continue in your browser.",
    "launcher.getstarted": "Get started",
    "launcher.viewcourses": "Explore the courses",
    "launcher.courses.previous": "Previous courses",
    "launcher.courses.next": "Next courses",
    "launcher.android.detail": "Learn on the go, even offline.",
    "launcher.browser.detail": "No installation needed.",
    "launcher.feature.practice": "Guided practice",
    "launcher.feature.practice.detail": "Words and phrases",
    "launcher.feature.translation": "Translation tools",
    "launcher.feature.translation.detail": "Understand and explore",
    "launcher.feature.progress": "Track progress",
    "launcher.feature.progress.detail": "See your improvement",
    "launcher.feature.free": "100% Free",
    "launcher.feature.free.detail": "The whole app. No payment needed.\nNo registration, no credit cards, no cookies. Open source. Truly free.",
    "launcher.feature.offline": "Offline mode",
    "launcher.feature.offline.detail": "Learn anywhere",
    "launcher.feature.safety": "Safe for children",
    "launcher.feature.safety.detail": "No ideology, no propaganda, no hidden agenda, no advertisements, no harmful content.",
    "launcher.about": "A language to learn. A world to discover.",
    "launcher.about.detail": "Caatuu brings guided practice, games, and language tools together in a free learning experience that also works offline.",
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
    revision: "launcher-copy-2",
    messages: messages[selected.locale]
  });
  return { course: selectLauncherCourse(registry), content };
}
