import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../", import.meta.url);
const androidRoot = new URL("apps/caatuu-android/app/src/main/", repoRoot);
const staticRoot = new URL("apps/caatuu-czech/static/", repoRoot);

const [activity, bridge, chrome, runtime] = await Promise.all([
  readFile(new URL("java/com/caatuu/android/MainActivity.kt", androidRoot), "utf8"),
  readFile(new URL("java/com/caatuu/android/CaatuuBridge.kt", androidRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  readFile(new URL("runtime.js", staticRoot), "utf8"),
]);

test("shared web theme changes reach the Android system-theme hook", () => {
  assert.match(chrome, /dark: \{ themeColor: "#151a18"/);
  assert.match(chrome, /function syncNativeSystemTheme\(theme\)/);
  assert.match(chrome, /window\.CaatuuRuntime\?\.appearance\?\.setSystemTheme\?\.\(normalizeTheme\(theme\)\)/);
  assert.match(chrome, /updateThemeControls\(normalizedTheme\);\s*syncNativeSystemTheme\(normalizedTheme\);/);
  assert.match(runtime, /setSystemTheme\(theme\)\s*\{\s*return setNativeSystemTheme\(theme\);/);
  assert.match(runtime, /window\.CaatuuAndroid\.setTheme\(normalizedTheme\)/);
  assert.match(bridge, /@JavascriptInterface\s+fun setTheme\(theme: String\)/);
  assert.match(bridge, /activity\.runOnUiThread \{ onThemeChanged\(normalizedTheme\) \}/);
});

test("Android persists the theme and paints edge-to-edge system areas", () => {
  assert.match(activity, /WindowCompat\.enableEdgeToEdge\(window\)/);
  assert.match(activity, /appRoot\.setBackgroundColor\(color\)/);
  assert.match(activity, /webView\.setBackgroundColor\(color\)/);
  assert.match(activity, /window\.isNavigationBarContrastEnforced = false/);
  assert.match(activity, /isAppearanceLightStatusBars = lightTheme/);
  assert.match(activity, /isAppearanceLightNavigationBars = lightTheme/);
  assert.match(activity, /putString\(SYSTEM_THEME_KEY, normalizedTheme\)/);
  assert.match(activity, /DARK_SYSTEM_BAR_COLOR = Color\.rgb\(21, 26, 24\)/);
  assert.match(activity, /LIGHT_SYSTEM_BAR_COLOR = Color\.rgb\(247, 244, 238\)/);
});
