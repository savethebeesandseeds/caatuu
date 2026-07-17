import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const staticRoot = new URL("../../../../apps/languages/czech/static/", import.meta.url);
const [themeCss, appCss, chatCss, chromeCss, chromeJs, ...pages] = await Promise.all([
  readFile(new URL("theme.css", staticRoot), "utf8"),
  readFile(new URL("app.css", staticRoot), "utf8"),
  readFile(new URL("chat.css", staticRoot), "utf8"),
  readFile(new URL("chrome.css", staticRoot), "utf8"),
  readFile(new URL("chrome.js", staticRoot), "utf8"),
  ...["home.html", "index.html", "chat.html", "word-net.html", "embedding-images.html"]
    .map((name) => readFile(new URL(name, staticRoot), "utf8").then((source) => ({ name, source })))
]);

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
  for (const { name, source } of pages) {
    const themeIndex = source.indexOf('href="theme.css');
    const chromeIndex = source.indexOf('href="chrome.css');
    assert.ok(themeIndex >= 0, `${name} must load theme.css`);
    assert.ok(chromeIndex > themeIndex, `${name} must load theme.css before chrome.css`);
  }
});

test("the update action has resolvable shared colors and readable dark tokens on every page", () => {
  assert.match(chromeJs, /class="maintenance-row-control pwa-install-action"[^>]*id="updateApp"/);
  const updateRule = ruleWithSelector(chromeCss, ".maintenance-install-actions .pwa-install-action");
  const background = updateRule.declarations.get("background") || "";
  const color = updateRule.declarations.get("color") || "";

  assert.ok(background, "the shared update control needs an explicit background");
  assert.ok(color, "the shared update control needs an explicit label color");
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
