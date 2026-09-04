import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const languageRuntimeStatic = new URL("../../../../apps/language-runtime/static/", import.meta.url);
const themeCss = await readFile(new URL("styles/caatuu-theme.css", languageRuntimeStatic), "utf8");
const chromeCss = await readFile(new URL("styles/caatuu-chrome.css", languageRuntimeStatic), "utf8");
const chromeJs = await readFile(new URL("source/caatuu-chrome.js", languageRuntimeStatic), "utf8");

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
  "--theme-panel-head-bg", "--theme-panel-head-ink", "--theme-amber", "--theme-amber-ink",
  "--theme-page-background"
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
    ["--theme-panel-head-ink", "--theme-panel-head-bg"],
    ["--theme-amber-ink", "--theme-panel"]
  ];
  for (const [foreground, background] of readablePairs) {
    const ratio = contrast(lightTheme.get(foreground), lightTheme.get(background), `${foreground} on ${background}`);
    assert.ok(ratio >= 4.5, `${foreground} on ${background} has only ${ratio.toFixed(2)}:1 contrast`);
  }
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
    ["--theme-panel-head-ink", "--theme-panel-head-bg"],
    ["--theme-amber-ink", "--theme-panel"]
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
