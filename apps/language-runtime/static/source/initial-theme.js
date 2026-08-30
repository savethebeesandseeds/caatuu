(function applyInitialCaatuuTheme(root) {
  "use strict";

  const course = root.CaatuuCourse;
  const html = root.document?.documentElement;
  if (!course || !html) return;
  try {
    const storedTheme = root.localStorage.getItem(course.storage.theme) || "dark";
    html.dataset.theme = ["light", "dark"].includes(storedTheme) ? storedTheme : "dark";
    const storedFontSize = root.localStorage.getItem(course.storage.fontSize) || "largest";
    html.dataset.fontSize = ["standard", "large", "largest"].includes(storedFontSize)
      ? storedFontSize
      : "largest";
  } catch {
    html.dataset.theme = "dark";
    html.dataset.fontSize = "largest";
  }
})(globalThis);
