(function applyInitialCaatuuTheme(root) {
  "use strict";

  const course = root.CaatuuCourse;
  const html = root.document?.documentElement;
  if (!course || !html) return;
  const sharedThemeStorageKey = "caatuu.appearance.theme.v1";
  const sharedFontSizeStorageKey = "caatuu.appearance.font-size.v1";
  const themeValues = ["light", "dark"];
  const fontSizeValues = ["standard", "large", "largest"];
  try {
    const sharedTheme = root.localStorage.getItem(sharedThemeStorageKey);
    const courseTheme = root.localStorage.getItem(course.storage.theme);
    const theme = themeValues.includes(sharedTheme)
      ? sharedTheme
      : (themeValues.includes(courseTheme) ? courseTheme : "light");
    const sharedFontSize = root.localStorage.getItem(sharedFontSizeStorageKey);
    const courseFontSize = root.localStorage.getItem(course.storage.fontSize);
    const fontSize = fontSizeValues.includes(sharedFontSize)
      ? sharedFontSize
      : (fontSizeValues.includes(courseFontSize) ? courseFontSize : "largest");
    html.dataset.theme = theme;
    html.dataset.fontSize = fontSize;
    try {
      root.localStorage.setItem(sharedThemeStorageKey, theme);
      root.localStorage.setItem(course.storage.theme, theme);
      root.localStorage.setItem(sharedFontSizeStorageKey, fontSize);
      root.localStorage.setItem(course.storage.fontSize, fontSize);
    } catch {
      // Appearance still applies when this environment permits reads but not writes.
    }
  } catch {
    html.dataset.theme = "light";
    html.dataset.fontSize = "largest";
  }
})(globalThis);
