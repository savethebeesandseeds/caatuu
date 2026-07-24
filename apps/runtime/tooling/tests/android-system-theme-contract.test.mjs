import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../../../../", import.meta.url);
const androidRoot = new URL("apps/android/app/src/main/", repoRoot);
const staticRoot = new URL("apps/languages/czech/static/", repoRoot);

const [activity, manifest, bridge, chrome, runtime] = await Promise.all([
  readFile(new URL("java/com/caatuu/android/MainActivity.kt", androidRoot), "utf8"),
  readFile(new URL("AndroidManifest.xml", androidRoot), "utf8"),
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
  assert.match(activity, /ViewCompat\.setOnApplyWindowInsetsListener\(appRoot\)/);
  assert.match(activity, /WindowInsetsCompat\.Type\.systemBars\(\) or\s+WindowInsetsCompat\.Type\.displayCutout\(\)/);
  assert.match(activity, /webView\.updateLayoutParams<FrameLayout\.LayoutParams>/);
  assert.match(activity, /topMargin = safeArea\.top/);
  assert.match(activity, /bottomMargin = safeArea\.bottom/);
  assert.match(activity, /ViewCompat\.requestApplyInsets\(appRoot\)/);
  assert.match(activity, /appRoot\.setBackgroundColor\(color\)/);
  assert.match(activity, /webView\.setBackgroundColor\(color\)/);
  assert.match(activity, /window\.isNavigationBarContrastEnforced = false/);
  assert.match(activity, /isAppearanceLightStatusBars = lightTheme/);
  assert.match(activity, /isAppearanceLightNavigationBars = lightTheme/);
  assert.match(activity, /putString\(SYSTEM_THEME_KEY, normalizedTheme\)/);
  assert.match(activity, /DARK_SYSTEM_BAR_COLOR = Color\.rgb\(21, 26, 24\)/);
  assert.match(activity, /LIGHT_SYSTEM_BAR_COLOR = Color\.rgb\(247, 244, 238\)/);
});

test("Android system back gestures use the lifecycle-aware dispatcher and shared game back control", () => {
  assert.match(activity, /class MainActivity : ComponentActivity\(\)/);
  assert.match(activity, /onBackPressedDispatcher\.addCallback\(this, object : OnBackPressedCallback\(true\)/);
  assert.match(activity, /window\.CaatuuChrome\.handleAndroidBack/);
  assert.doesNotMatch(activity, /OnBackInvokedDispatcher/);
  assert.match(manifest, /android:enableOnBackInvokedCallback="true"/);
});
