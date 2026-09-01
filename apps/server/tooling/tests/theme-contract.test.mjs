import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const languageRuntimeStatic = new URL("../../../../apps/language-runtime/static/", import.meta.url);
const pageNames = [
  "chat.html",
  "conjugation-comet.html",
  "embedding-images.html",
  "verb-difficulty.html",
  "audio-lab.html"
];
const themeCss = await readFile(new URL("styles/caatuu-theme.css", languageRuntimeStatic), "utf8");
const appCss = await readFile(new URL("styles/caatuu-workspace.css", languageRuntimeStatic), "utf8");
const chatCss = await readFile(new URL("source/features/chat/chat.css", staticRoot), "utf8");
const chromeCss = await readFile(new URL("styles/caatuu-chrome.css", languageRuntimeStatic), "utf8");
const chromeJs = await readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8");
const initialThemeJs = await readFile(new URL("source/initial-theme.js", languageRuntimeStatic), "utf8");
const canonicalShell = await readFile(new URL("app/index.html", languageRuntimeStatic), "utf8");
const pages = await Promise.all(
  pageNames.map((name) => readFile(new URL(name, staticRoot), "utf8").then((source) => ({ name, source })))
);
const allPages = [{ name: "canonical app", source: canonicalShell }, ...pages];
const embeddedWorkspacePages = await Promise.all(
  ["conjugation-comet.html", "case-cosmos.html", "agreement-aurora.html"]
    .map((name) => readFile(new URL(name, staticRoot), "utf8").then((source) => ({ name, source })))
);
const homeCss = await readFile(new URL("styles/caatuu-home.css", languageRuntimeStatic), "utf8");
const launcherCss = await readFile(new URL("../../../launcher/static/app.css", staticRoot), "utf8");

test("Home and Games share one cached application shell", () => {
  assert.match(canonicalShell, /id="view-home"/);
  assert.match(canonicalShell, /href="\/language-runtime\/static\/styles\/caatuu-home\.css\?v=home-32"/);
  assert.match(canonicalShell, /href="\/language-runtime\/static\/styles\/caatuu-workspace\.css\?v=shell-93"/);
});

test("embedded Czech games request the exact cached shared workspace stylesheet", () => {
  for (const { name, source } of embeddedWorkspacePages) {
    assert.match(
      source,
      /href="\/language-runtime\/static\/styles\/caatuu-workspace\.css\?v=shell-93"/u,
      `${name} must use the owned workspace stylesheet query`
    );
  }
});

function cssRules(source) {
  const rules = [];
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of withoutComments.matchAll(pattern)) {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    const declarations = new Map();
    for (const declaration of match[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      declarations.set(declaration[1], declaration[2].trim());
    }
    rules.push({ selectors, body: match[2], declarations });
  }
  return rules;
}

function ruleWithSelector(source, selector) {
  const rule = cssRules(source).find((candidate) => candidate.selectors.includes(selector));
  assert.ok(rule, `missing CSS rule for ${selector}`);
  return rule;
}

function declarationsForSelector(source, selector) {
  const declarations = new Map();
  for (const rule of cssRules(source)) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [name, value] of rule.declarations) declarations.set(name, value);
  }
  assert.ok(declarations.size > 0, `missing CSS declarations for ${selector}`);
  return declarations;
}

function hex(value, label) {
  const match = String(value).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(match, `${label} should be a plain hex color, received ${value}`);
  const digits = match[1].length === 3
    ? [...match[1]].map((part) => part + part).join("")
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16));
}

function luminance(value, label) {
  const channels = hex(value, label).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second, label) {
  const a = luminance(first, `${label} foreground`);
  const b = luminance(second, `${label} background`);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function variableCalls(value) {
  const calls = [];
  let cursor = 0;
  while (cursor < value.length) {
    const start = value.indexOf("var(", cursor);
    if (start < 0) break;
    let depth = 1;
    let end = start + 4;
    for (; end < value.length && depth > 0; end += 1) {
      if (value[end] === "(") depth += 1;
      if (value[end] === ")") depth -= 1;
    }
    assert.equal(depth, 0, `unclosed var() in ${value}`);
    const inner = value.slice(start + 4, end - 1);
    let innerDepth = 0;
    let comma = -1;
    for (let index = 0; index < inner.length; index += 1) {
      if (inner[index] === "(") innerDepth += 1;
      if (inner[index] === ")") innerDepth -= 1;
      if (inner[index] === "," && innerDepth === 0) {
        comma = index;
        break;
      }
    }
    calls.push({
      name: (comma < 0 ? inner : inner.slice(0, comma)).trim(),
      fallback: comma < 0 ? "" : inner.slice(comma + 1).trim()
    });
    cursor = end;
  }
  return calls;
}

function assertVariablesResolve(value, variables, label, trail = []) {
  for (const call of variableCalls(value)) {
    if (variables.has(call.name)) {
      assert.ok(!trail.includes(call.name), `${label} contains a custom-property cycle through ${call.name}`);
      assertVariablesResolve(variables.get(call.name), variables, label, [...trail, call.name]);
    } else {
      assert.ok(call.fallback, `${label} references unresolved ${call.name}`);
      assertVariablesResolve(call.fallback, variables, label, trail);
    }
  }
}

const requiredSemanticTokens = [
  "--theme-ink", "--theme-muted", "--theme-quiet",
  "--theme-paper", "--theme-panel", "--theme-panel-raised", "--theme-input",
  "--theme-line", "--theme-line-strong",
  "--theme-green", "--theme-green-strong", "--theme-green-hover", "--theme-green-filled",
  "--theme-blue", "--theme-blue-hover", "--theme-blue-filled", "--theme-red",
  "--theme-soft-blue", "--theme-soft-green", "--theme-selection", "--theme-focus-ring",
  "--theme-shadow", "--theme-surface-1", "--theme-surface-2", "--theme-surface-3",
  "--theme-control-bg", "--theme-control-border",
  "--theme-chip-bg", "--theme-chip-ink",
  "--theme-entry-bg", "--theme-entry-ink", "--theme-entry-muted", "--theme-entry-accent",
  "--theme-panel-head-bg", "--theme-panel-head-ink", "--theme-amber", "--theme-page-background"
];

const lightTheme = declarationsForSelector(themeCss, ":root");
const darkOverrides = declarationsForSelector(themeCss, 'html[data-theme="dark"]');
const darkTheme = new Map([
  ...lightTheme,
  ...darkOverrides
]);

test("light mode provides a complete, warm semantic palette with accessible text", () => {
  assert.equal(lightTheme.get("color-scheme"), "light");
  for (const name of requiredSemanticTokens) {
    assert.ok(lightTheme.has(name), `light mode is missing shared token ${name}`);
    assertVariablesResolve(lightTheme.get(name), lightTheme, `light token ${name}`);
  }

  const primarySurfaces = [
    "--theme-paper", "--theme-panel", "--theme-panel-raised", "--theme-input",
    "--theme-surface-1", "--theme-surface-2", "--theme-surface-3",
    "--theme-control-bg", "--theme-chip-bg", "--theme-entry-bg", "--theme-panel-head-bg"
  ];
  for (const name of primarySurfaces) {
    const value = lightTheme.get(name);
    assert.doesNotMatch(value, /^#(?:fff|ffffff)$/i, `${name} should retain a softly tinted surface`);
    assert.ok(luminance(value, name) >= 0.72, `${name} should remain recognizably light`);
  }

  const readablePairs = [
    ["--theme-ink", "--theme-paper"],
    ["--theme-ink", "--theme-panel"],
    ["--theme-ink", "--theme-control-bg"],
    ["--theme-muted", "--theme-panel"],
    ["--theme-green", "--theme-panel"],
    ["--theme-blue", "--theme-panel"],
    ["--theme-red", "--theme-panel"],
    ["--theme-chip-ink", "--theme-chip-bg"],
    ["--theme-entry-ink", "--theme-entry-bg"],
    ["--theme-entry-muted", "--theme-entry-bg"],
    ["--theme-panel-head-ink", "--theme-panel-head-bg"]
  ];
  for (const [foreground, background] of readablePairs) {
    const ratio = contrast(lightTheme.get(foreground), lightTheme.get(background), `${foreground} on ${background}`);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has only ${ratio.toFixed(2)}:1 contrast`);
  }
});

test("the approved dark palette stays stable while light mode evolves", () => {
  const stableDarkTokens = {
    "--theme-ink": "#e7ece8",
    "--theme-muted": "#aab5ae",
    "--theme-quiet": "#85938b",
    "--theme-paper": "#151a18",
    "--theme-panel": "#1b2320",
    "--theme-panel-raised": "#222b27",
    "--theme-input": "#181f1c",
    "--theme-line": "#313c37",
    "--theme-line-strong": "#45534c",
    "--theme-green": "#8fb9a3",
    "--theme-green-strong": "#a3cbb7",
    "--theme-green-hover": "#afd5c1",
    "--theme-green-filled": "#456f5d",
    "--theme-blue": "#98b3c4",
    "--theme-blue-hover": "#aac2d1",
    "--theme-blue-filled": "#4d6d80",
    "--theme-red": "#d79a8f",
    "--theme-soft-blue": "#212d32",
    "--theme-soft-green": "#22312b",
    "--theme-selection": "#334640",
    "--theme-focus-ring": "#87aa9b",
    "--theme-surface-1": "#222b27",
    "--theme-surface-2": "#1b2320",
    "--theme-surface-3": "#202a25",
    "--theme-control-bg": "#181f1c",
    "--theme-control-border": "#45534c",
    "--theme-chip-bg": "#22312b",
    "--theme-chip-ink": "#a9cdbb",
    "--theme-entry-bg": "#181f1c",
    "--theme-entry-ink": "#e7ece8",
    "--theme-entry-muted": "#aab5ae",
    "--theme-entry-accent": "#dea69b",
    "--theme-panel-head-bg": "#202925",
    "--theme-panel-head-ink": "#a9bfcc",
    "--theme-amber": "#c9ad78"
  };

  assert.equal(darkOverrides.get("color-scheme"), "dark");
  for (const name of requiredSemanticTokens) {
    assert.ok(darkOverrides.has(name), `dark mode must explicitly define shared token ${name}`);
    assertVariablesResolve(darkOverrides.get(name), darkTheme, `dark token ${name}`);
  }
  for (const [name, expected] of Object.entries(stableDarkTokens)) {
    assert.equal(darkOverrides.get(name), expected, `${name} is part of the approved dark palette`);
  }
  assert.equal(darkOverrides.get("--theme-shadow"), "0 20px 48px rgba(0, 0, 0, 0.24)");
  assert.equal(
    darkOverrides.get("--theme-page-background"),
    "radial-gradient(circle at 50% -18%, #202925 0%, #151a18 44%, #121614 100%)"
  );
});

test("dark mode keeps its calm surfaces and readable semantic pairs", () => {

  const primarySurfaces = [
    "--theme-paper", "--theme-panel", "--theme-panel-raised", "--theme-input",
    "--theme-surface-1", "--theme-surface-2", "--theme-surface-3",
    "--theme-control-bg", "--theme-chip-bg", "--theme-entry-bg", "--theme-panel-head-bg"
  ];
  for (const name of primarySurfaces) {
    const value = darkTheme.get(name);
    assert.doesNotMatch(value, /^#(?:000|000000|fff|ffffff)$/i, `${name} must not be pure black or white`);
    assert.ok(luminance(value, name) < 0.08, `${name} should remain a restrained dark surface`);
  }

  const readablePairs = [
    ["--theme-ink", "--theme-paper"],
    ["--theme-ink", "--theme-panel"],
    ["--theme-ink", "--theme-control-bg"],
    ["--theme-muted", "--theme-panel"],
    ["--theme-chip-ink", "--theme-chip-bg"],
    ["--theme-entry-ink", "--theme-entry-bg"],
    ["--theme-panel-head-ink", "--theme-panel-head-bg"]
  ];
  for (const [foreground, background] of readablePairs) {
    const ratio = contrast(darkTheme.get(foreground), darkTheme.get(background), `${foreground} on ${background}`);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has only ${ratio.toFixed(2)}:1 contrast`);
  }
});

test("dark settings separate the canvas, expanded section, and nested cards", () => {
  const settingsCanvas = ruleWithSelector(chromeCss, 'html[data-theme="dark"] .settings-sheet-body');
  assert.equal(
    settingsCanvas.declarations.get("background"),
    "color-mix(in srgb, var(--theme-panel-raised) 72%, var(--theme-panel))"
  );

  const expandedSection = ruleWithSelector(chromeCss, 'html[data-theme="dark"] .settings-section-body');
  assert.equal(expandedSection.declarations.get("background"), "var(--theme-panel-raised)");
});

test("theme.css resolves the shared aliases used by Chrome in both themes", () => {
  const sharedAliases = [
    "--ink", "--muted", "--quiet", "--paper", "--panel", "--panel-raised", "--line",
    "--green", "--green-dark", "--blue", "--red", "--control-bg", "--control-border",
    "--chip-bg", "--chip-ink"
  ];
  for (const name of sharedAliases) {
    assertVariablesResolve(`var(${name})`, lightTheme, `light shared alias ${name}`);
    assertVariablesResolve(`var(${name})`, darkTheme, `dark shared alias ${name}`);
  }
});

test("dark primary surfaces avoid hard-coded pure black and white backgrounds", () => {
  for (const [name, source] of [["app.css", appCss], ["chat.css", chatCss], ["chrome.css", chromeCss]]) {
    const darkRules = cssRules(source).filter((rule) =>
      rule.selectors.some((selector) => selector.includes('html[data-theme="dark"]'))
    );
    assert.ok(darkRules.length > 0, `${name} should contain explicit dark-theme contracts`);
    for (const rule of darkRules) {
      const background = rule.declarations.get("background") || rule.declarations.get("background-color") || "";
      assert.doesNotMatch(
        background,
        /^#(?:000|000000|fff|ffffff)(?:\s|$)/i,
        `${name} uses a glaring primary background in ${rule.selectors.join(", ")}`
      );
    }
  }
});

test("every settings surface receives shared theme tokens before shared Chrome", () => {
  for (const { name, source } of allPages) {
    const themeIndex = source.indexOf('href="/language-runtime/static/styles/caatuu-theme.css');
    const chromeIndex = source.indexOf('href="/language-runtime/static/styles/caatuu-chrome.css');
    assert.ok(themeIndex >= 0, `${name} must load theme.css`);
    assert.ok(chromeIndex > themeIndex, `${name} must load theme.css before chrome.css`);
  }
});

test("text-size preferences are persistent, immediate, and shared by every HTML screen", () => {
  const standard = declarationsForSelector(themeCss, "html");
  const large = declarationsForSelector(themeCss, 'html[data-font-size="large"]');
  const largest = declarationsForSelector(themeCss, 'html[data-font-size="largest"]');
  assert.equal(standard.get("font-size"), "100%");
  assert.equal(standard.get("-webkit-text-size-adjust"), "100%");
  assert.equal(standard.get("text-size-adjust"), "100%");
  assert.equal(large.get("font-size"), "112.5%");
  assert.equal(largest.get("font-size"), "125%");

  assert.match(chromeJs, /const fontSizeStorageKey = course\.storage\.fontSize/);
  assert.match(chromeJs, /standard: \{ label: "Smaller" \}/);
  assert.match(chromeJs, /large: \{ label: "Small" \}/);
  assert.match(chromeJs, /largest: \{ label: "Standard" \}/);
  assert.match(chromeJs, /hasOwnProperty\.call\(fontSizeOptions, value\) \? value : "largest"/);
  assert.match(chromeJs, /function readStoredFontSize\(\)[\s\S]*?catch \(error\) \{[\s\S]*?return "largest"/);
  assert.match(chromeJs, /document\.documentElement\.dataset\.fontSize = normalizedFontSize/);
  assert.match(chromeJs, /localStorage\.setItem\(fontSizeStorageKey, normalizedFontSize\)/);
  assert.match(chromeJs, /data-font-size-option="standard"/);
  assert.match(chromeJs, /data-font-size-option="large"/);
  assert.match(chromeJs, /data-font-size-option="largest"/);
  assert.match(chromeJs, /data-font-size-option="largest" aria-label="Use standard text size"[\s\S]*?<b>Standard<\/b>/);
  assert.match(chromeJs, /data-font-size-option="large" aria-label="Use small text size"[\s\S]*?<b>Small<\/b>/);
  assert.match(chromeJs, /data-font-size-option="standard" aria-label="Use smaller text size"[\s\S]*?<b>Smaller<\/b>/);
  assert.match(chromeJs, /const lightModeIconSrc = "\/assets\/icons\/light_mode_ui\.png"/);
  assert.match(chromeJs, /data-theme-option="light"[\s\S]*?src="\$\{lightModeIconSrc\}"[\s\S]*?<b>Light<\/b>/);
  assert.doesNotMatch(chromeJs, /<h3>Pronunciation<\/h3>/);
  assert.doesNotMatch(chromeJs, /Choose the installed voice that reads Czech sentences aloud\./);
  assert.match(chromeJs, /Automatic will use the best available \$\{targetLanguage\.label\} voice\./);
  assert.match(chromeJs, /updateFontSizeControls\(readStoredFontSize\(\)\);[\s\S]*?setSettingsView\(panel, readRememberedBackpackView\(\), \{ persist: false \}\)/);

  const canonicalProfileIndex = canonicalShell.indexOf('src="source/shared/course-profile.js?v=course-26"');
  const canonicalInitialThemeIndex = canonicalShell.indexOf('src="/language-runtime/static/source/initial-theme.js?v=theme-1"');
  const canonicalThemeCssIndex = canonicalShell.indexOf('href="/language-runtime/static/styles/caatuu-theme.css?v=theme-5"');
  assert.ok(canonicalProfileIndex >= 0, "the canonical app must load its route-local course profile");
  assert.ok(canonicalInitialThemeIndex > canonicalProfileIndex, "the canonical app must initialize appearance after its course profile");
  assert.ok(canonicalThemeCssIndex > canonicalInitialThemeIndex, "the canonical app must initialize appearance before loading theme CSS");
  assert.match(initialThemeJs, /root\.localStorage\.getItem\(course\.storage\.fontSize\) \|\| "largest"/);
  assert.match(initialThemeJs, /\["standard", "large", "largest"\]\.includes\(storedFontSize\)/);
  assert.match(initialThemeJs, /html\.dataset\.fontSize = "largest"/);

  const appearance = ruleWithSelector(chromeCss, ".appearance-card");
  const appearanceControls = ruleWithSelector(chromeCss, ".appearance-controls");
  const appearanceRow = ruleWithSelector(chromeCss, ".appearance-control-row");
  const appearanceDivider = ruleWithSelector(chromeCss, ".appearance-control-row + .appearance-control-row");
  const themeTray = ruleWithSelector(chromeCss, ".theme-control");
  const appearanceButton = ruleWithSelector(chromeCss, ".theme-control button");
  const activeAppearanceButton = ruleWithSelector(chromeCss, ".theme-control button.is-active");
  const activeAppearanceSample = ruleWithSelector(chromeCss, ".settings-sheet .font-size-control button.is-active .font-size-sample");
  const darkAppearanceButton = ruleWithSelector(chromeCss, 'html[data-theme="dark"] .theme-control button');
  const darkActiveAppearanceButton = ruleWithSelector(chromeCss, 'html[data-theme="dark"] .theme-control button.is-active');
  const fontSizeButton = ruleWithSelector(chromeCss, ".settings-sheet .font-size-control button");
  const speechPaceControl = ruleWithSelector(chromeCss, ".speech-pace-control");
  const speechPaceSlider = ruleWithSelector(chromeCss, '.speech-pace-control input[type="range"]');
  const speechPaceTrack = ruleWithSelector(chromeCss, '.speech-pace-control input[type="range"]::-webkit-slider-runnable-track');
  const speechPaceThumb = ruleWithSelector(chromeCss, '.speech-pace-control input[type="range"]::-webkit-slider-thumb');
  const speechPaceTicks = ruleWithSelector(chromeCss, ".speech-pace-ticks");
  assert.equal(appearance.declarations.get("grid-template-columns"), "1fr");
  assert.equal(appearance.declarations.get("padding"), "0");
  assert.equal(appearance.declarations.get("gap"), "0");
  assert.equal(appearanceControls.declarations.get("grid-template-columns"), "1fr");
  assert.equal(appearanceControls.declarations.get("gap"), "0");
  assert.equal(appearanceControls.declarations.get("border-radius"), "10px");
  assert.equal(appearanceControls.declarations.get("overflow"), "hidden");
  assert.match(appearanceRow.declarations.get("grid-template-columns") || "", /minmax\(92px/);
  assert.equal(appearanceRow.declarations.get("align-items"), "center");
  assert.equal(appearanceRow.declarations.get("border"), "0");
  assert.equal(appearanceRow.declarations.get("border-radius"), "0");
  assert.match(appearanceDivider.declarations.get("border-top") || "", /^1px solid /);
  assert.equal(themeTray.declarations.get("padding"), "0");
  assert.equal(themeTray.declarations.get("border"), "0");
  assert.equal(themeTray.declarations.get("gap"), "6px");
  assert.equal(themeTray.declarations.get("background"), "transparent");
  assert.match(appearanceButton.declarations.get("border") || "", /^1px solid /);
  assert.equal(appearanceButton.declarations.get("border-bottom-width"), "3px");
  assert.equal(appearanceButton.declarations.get("border-radius"), "8px");
  assert.equal(appearanceButton.declarations.get("box-shadow"), "none");
  assert.match(appearanceButton.declarations.get("background") || "", /--theme-amber/);
  assert.equal(activeAppearanceButton.declarations.get("background"), "var(--theme-green-filled, var(--green, #376a5a))");
  assert.equal(activeAppearanceButton.declarations.get("color"), "#fffaf0");
  assert.equal(activeAppearanceSample.declarations.get("color"), "#fffaf0");
  assert.match(darkAppearanceButton.declarations.get("background") || "", /--theme-amber/);
  assert.equal(darkActiveAppearanceButton.declarations.get("background"), "var(--theme-green-filled, var(--green, #456f5d))");
  assert.equal(darkActiveAppearanceButton.declarations.get("color"), "#fffaf0");
  assert.equal(fontSizeButton.declarations.get("flex-direction"), "column");
  assert.equal(speechPaceControl.declarations.get("display"), "grid");
  assert.equal(speechPaceControl.declarations.get("gap"), "2px");
  assert.equal(speechPaceSlider.declarations.get("appearance"), "none");
  assert.equal(speechPaceSlider.declarations.get("touch-action"), "pan-y");
  assert.match(speechPaceTrack.declarations.get("background") || "", /--speech-pace-position/);
  assert.equal(speechPaceThumb.declarations.get("width"), "22px");
  assert.match(speechPaceThumb.declarations.get("border") || "", /--theme-green-filled/);
  assert.equal(speechPaceTicks.declarations.get("display"), "flex");
  assert.equal(speechPaceTicks.declarations.get("justify-content"), "space-between");
  assert.doesNotMatch(chromeCss, /\.speech-pace-follow/);

  for (const { name, source } of pages) {
    const profileIndex = source.indexOf('src="source/shared/course-profile.js?v=course-26"');
    const bootstrapIndex = source.indexOf("document.documentElement.dataset.fontSize");
    const themeIndex = source.indexOf('href="/language-runtime/static/styles/caatuu-theme.css?v=theme-5"');
    assert.ok(profileIndex >= 0, `${name} must load course-scoped font-size storage`);
    assert.ok(bootstrapIndex > profileIndex, `${name} must read its font size after the course profile`);
    assert.ok(themeIndex > bootstrapIndex, `${name} must apply font size before loading CSS`);
    assert.match(source, /storage\.fontSize\) \|\| "largest"/, `${name} must default to the new Standard size`);
    assert.match(source, /includes\(storedFontSize\) \? storedFontSize : "largest"/, `${name} must reject invalid sizes safely`);
    assert.match(source, /dataset\.fontSize = "largest"/, `${name} must keep first paint stable when storage is blocked`);
  }
});

test("Standard size gives dense Mandarin glyphs and pinyin extra legibility without scaling English", () => {
  const wordWorldGlyph = ruleWithSelector(
    appCss,
    'html[data-font-size="largest"] body[data-course-id="zh"] .word-net-target-text-glyph'
  );
  const wordWorldPinyin = ruleWithSelector(
    appCss,
    'html[data-font-size="largest"] body[data-course-id="zh"] .word-net-target-text-notation'
  );
  const trailGlyph = ruleWithSelector(
    appCss,
    'html[data-font-size="largest"] body[data-course-id="zh"] #wordNetTrail .word-net-trail-target'
  );
  const verbHeadingGlyph = ruleWithSelector(
    appCss,
    'html[data-font-size="largest"] body[data-course-id="zh"] .verb-match-column-heading-cz #verbTargetColumnHeading'
  );
  const verbGlyph = ruleWithSelector(
    appCss,
    'html[data-font-size="largest"] body[data-course-id="zh"] .verb-match-card-cz .verb-match-card-copy'
  );

  assert.equal(wordWorldGlyph.declarations.get("font-size"), "1.38em");
  assert.equal(wordWorldPinyin.declarations.get("font-size"), "max(0.56em, 0.7rem)");
  assert.equal(trailGlyph.declarations.get("font-size"), "1.13rem");
  assert.equal(verbHeadingGlyph.declarations.get("font-size"), "clamp(1.08rem, 1.66vw, 1.21rem)");
  assert.equal(verbGlyph.declarations.get("font-size"), "clamp(1.38rem, 3.24vw, 1.62rem)");
  assert.doesNotMatch(appCss, /data-font-size="large"[^{}]*data-course-id="zh"/u);
});

test("the update action has resolvable shared colors and readable dark tokens on every page", () => {
  assert.match(chromeJs, /class="maintenance-row-control pwa-install-action"[^>]*id="updateApp"/);
  const updateRule = ruleWithSelector(chromeCss, ".maintenance-install-actions .pwa-install-action");
  const background = updateRule.declarations.get("background") || "";
  const color = updateRule.declarations.get("color") || "";

  assert.ok(background, "the shared update control needs an explicit background");
  assert.ok(color, "the shared update control needs an explicit label color");
  assert.equal(background, "var(--theme-green-filled, var(--green, #376a5a))");
  assert.equal(color, "#fffaf0");
  assertVariablesResolve(background, lightTheme, "light update background");
  assertVariablesResolve(color, lightTheme, "light update label");
  assertVariablesResolve(background, darkTheme, "dark update background");
  assertVariablesResolve(color, darkTheme, "dark update label");

  const ratio = contrast(
    darkTheme.get("--theme-chip-ink"),
    darkTheme.get("--theme-chip-bg"),
    "dark update action"
  );
  assert.ok(ratio >= 4.5, `dark update action tokens have only ${ratio.toFixed(2)}:1 contrast`);
});

test("setup failures expand instead of clipping long update diagnostics", () => {
  const zone = ruleWithSelector(homeCss, ".native-setup-card.is-error .setup-message-zone");
  const message = ruleWithSelector(homeCss, ".native-setup-card.is-error .setup-message");
  assert.equal(zone.declarations.get("overflow"), "visible");
  assert.equal(message.declarations.get("overflow"), "visible");
  assert.equal(message.declarations.get("display"), "block");
  assert.equal(message.declarations.get("-webkit-line-clamp"), "unset");
  assert.equal(message.declarations.get("overflow-wrap"), "anywhere");
});

test("the shared Waajacu trademark stays legible in language and launcher footers", () => {
  for (const [name, source] of [["Czech Chrome", chromeCss], ["launcher", launcherCss]]) {
    const mark = ruleWithSelector(source, ".brand-trademark");
    assert.equal(mark.declarations.get("display"), "inline-block", `${name} trademark should have a stable box`);
    assert.equal(mark.declarations.get("font-size"), "1em", `${name} trademark should match the surrounding scale`);
    assert.equal(mark.declarations.get("font-weight"), "900", `${name} trademark should remain visible`);
  }
});

test("the backpack progression hub has a distinct reward-focused surface", () => {
  const card = ruleWithSelector(chromeCss, ".backpack-card");
  assert.match(card.declarations.get("background") || "", /var\(--theme-amber/);
  assert.match(card.declarations.get("background") || "", /var\(--green\)/);
  assert.match(card.declarations.get("border") || "", /var\(--theme-amber/);
  const xp = ruleWithSelector(chromeCss, ".wallet-token-xp");
  assert.match(xp.declarations.get("background") || "", /url\("\/assets\/icons\/icon_gem\.png"\)/);
  const coin = ruleWithSelector(chromeCss, ".wallet-token-coin");
  assert.equal(coin.declarations.get("background"), "transparent");
  assert.match(chromeJs, /class="wallet-token wallet-token-coin"[\s\S]*?coin_icon_ui\.png/);
  const sheet = ruleWithSelector(chromeCss, ".settings-sheet");
  assert.match(sheet.declarations.get("grid-template-rows") || "", /auto minmax\(0, 1fr\) auto/);
  const sectionNav = ruleWithSelector(chromeCss, ".settings-section-switcher");
  assert.match(sectionNav.declarations.get("grid-template-columns") || "", /repeat\(3/);
  assert.match(sectionNav.declarations.get("border") || "", /^1px solid /);
  assert.match(sectionNav.declarations.get("margin") || "", /--settings-section-edge/);
  assert.equal(sectionNav.declarations.get("padding"), "4px 0 5px");
  assert.equal(sectionNav.declarations.get("gap"), "6px");
  assert.equal(sectionNav.declarations.get("border-radius"), "12px");
  assert.match(sectionNav.declarations.get("box-shadow") || "", /inset 0 1px 0/);
  assert.equal(sectionNav.declarations.get("--submenu-item-icon-size"), "34px");
  const sectionIcon = ruleWithSelector(chromeCss, ".settings-section-switcher button img");
  assert.equal(sectionIcon.declarations.get("width"), "var(--submenu-item-icon-size, 42px)");
  assert.equal(sectionIcon.declarations.get("height"), "var(--submenu-item-icon-size, 42px)");
  const sectionButton = ruleWithSelector(chromeCss, ".settings-section-switcher button");
  assert.equal(sectionButton.declarations.get("border-radius"), "8px");
  const activeSectionButton = ruleWithSelector(chromeCss, ".settings-section-switcher button.is-active");
  assert.equal(activeSectionButton.declarations.get("background"), "var(--games-menu-surface)");
  assert.match(activeSectionButton.declarations.get("color") || "", /var\(--green/);
  const backpackButton = ruleWithSelector(chromeCss, 'body.settings-open #openSettings[aria-expanded="true"]');
  assert.equal(backpackButton.declarations.get("border-radius"), "0 0 10px 10px");
  const navIcon = ruleWithSelector(chromeCss, ".bottom-app-nav .app-nav-icon");
  assert.equal(navIcon.declarations.get("position"), "relative");
  const submenuIcon = ruleWithSelector(chromeCss, ".bottom-app-nav .app-nav-submenu-icon");
  assert.equal(submenuIcon.declarations.get("position"), "absolute");
  assert.equal(submenuIcon.declarations.get("right"), "-2px");
  assert.equal(submenuIcon.declarations.get("bottom"), "-2px");
  assert.equal(submenuIcon.declarations.get("width"), "18px");
  assert.equal(submenuIcon.declarations.get("height"), "18px");
  assert.match(chromeCss, /\.settings-section-switcher::after\s*\{/);
  assert.match(chromeCss, /body\.settings-open #openSettings\[aria-expanded="true"\]::before/);
  assert.doesNotMatch(chromeCss, /body\.settings-open \.bottom-app-nav::before\s*\{/);
  const dock = ruleWithSelector(chromeCss, ".app-bottom-dock");
  assert.equal(dock.declarations.get("border-top"), "1px solid var(--line)");
  const dockMenu = ruleWithSelector(chromeCss, ".app-bottom-dock-menu");
  assert.match(dockMenu.declarations.get("max-height") || "", /44dvh/);
  const dockNav = ruleWithSelector(chromeCss, ".app-bottom-dock > .bottom-app-nav");
  assert.equal(dockNav.declarations.get("grid-template-columns"), "repeat(3, minmax(0, 1fr))");
  assert.equal(dockNav.declarations.get("background"), "transparent");
  const settingsBody = ruleWithSelector(chromeCss, ".settings-sheet-body");
  assert.equal(settingsBody.declarations.get("display"), "flex");
  assert.equal(settingsBody.declarations.get("flex-direction"), "column");
  const settingsFooter = ruleWithSelector(chromeCss, ".settings-sheet-footer");
  assert.equal(settingsFooter.declarations.get("margin-top"), "auto");
});

test("the skill compass uses shared theme tokens and keeps exact values beside the chart", () => {
  const compass = ruleWithSelector(chromeCss, ".skill-compass");
  assert.match(compass.declarations.get("border") || "", /var\(--green\)/);
  const practice = declarationsForSelector(chromeCss, ".skill-compass-practice-shape");
  assert.match(practice.get("stroke") || "", /var\(--theme-amber/);
  const strength = declarationsForSelector(chromeCss, ".skill-compass-strength-shape");
  assert.match(strength.get("stroke") || "", /var\(--green/);
  assert.match(chromeCss, /\.skill-compass-map \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.doesNotMatch(chromeCss, /\.skill-compass-map \{[\s\S]*?grid-template-columns: minmax\(230px/);
  assert.match(chromeCss, /\.skill-compass-axis-metrics \{[\s\S]*?grid-template-columns: minmax\(86px, 1\.15fr\)/);
  assert.match(chromeCss, /\.skill-compass-emblem-mark \{[\s\S]*?stroke: currentColor/);
  assert.match(chromeCss, /\.skill-compass-emblem-ring \{[\s\S]*?stroke:/);
  assert.match(chromeCss, /\.skill-compass-axis-list li \{[\s\S]*?grid-template-columns: minmax\(150px/);
  assert.match(chromeCss, /\.skill-compass-axis-heading \.skill-compass-axis-emblem \{[\s\S]*?width: 28px/);
  assert.match(chromeCss, /\.skill-compass-axis-practice-meter::after \{[\s\S]*?var\(--axis-practice/);
  assert.match(
    chromeCss,
    /@media screen and \(max-width: 560px\) \{[\s\S]*?\.skill-compass-axis-list li \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/
  );
  for (const axisId of ["people", "home-school", "food-shopping", "places-travel", "actions-abilities", "time-plans", "world-description"]) {
    assert.match(chromeCss, new RegExp(`data-axis-id="${axisId}"`));
  }
});

test("settings expose Appearance and About immediately while Advanced stays collapsed", () => {
  const appearanceStart = chromeJs.indexOf('aria-label="Appearance"');
  const advancedStart = chromeJs.indexOf('aria-label="Advanced app settings"');
  const advancedBodyStart = chromeJs.indexOf('<div class="settings-section-body">', advancedStart);
  assert.ok(appearanceStart >= 0 && advancedStart > appearanceStart);
  assert.match(chromeJs, /<section class="settings-card side-card settings-section-card app-controls-card" aria-label="Advanced app settings">/);
  assert.match(chromeJs, /<strong>Advanced<\/strong>[\s\S]*?<small>AI, developer, storage<\/small>/);
  assert.match(chromeJs, /<details class="settings-section-details">/);
  assert.doesNotMatch(chromeJs, /<details class="settings-section-details" open>/);
  assert.match(chromeJs, /<section class="settings-card side-card about-card" aria-label="About">/);
  assert.ok(advancedBodyStart > advancedStart);
  assert.ok(chromeJs.indexOf('aria-label="Chat settings"', advancedBodyStart) > advancedBodyStart);
  assert.ok(chromeJs.indexOf('aria-label="App settings"', advancedBodyStart) > advancedBodyStart);
});

test("browser freshness notices remain visible, themed, and dismiss only when current", () => {
  const notice = ruleWithSelector(chromeCss, ".app-freshness-notice");
  assert.match(notice.declarations.get("position") || "", /fixed/);
  assert.match(notice.declarations.get("background") || "", /var\(--theme-panel-raised/);
  assert.match(chromeCss, /\.app-freshness-notice\[hidden\] \{[\s\S]*?display: none/);
  assert.match(chromeCss, /\.app-freshness-notice\[data-state="update-ready"\]/);
  assert.match(chromeCss, /\.app-freshness-notice\[data-state="refreshing"\]/);
});
