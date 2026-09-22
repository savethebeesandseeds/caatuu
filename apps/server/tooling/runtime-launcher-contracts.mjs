// Structural checks for the repository-owned launcher HTML. This is a source
// audit, not an HTML sanitizer or a replacement for browser behavior tests.
const ORIGIN = "https://caatuu-audit.invalid";
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

function elements(html) {
  const source = String(html ?? "");
  const nodes = [];
  const stack = [];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?:\s+(?:[^"'<>]|"[^"]*"|'[^']*')*)?\s*\/?>/giu;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith("<!")) continue;
    const tag = token.match(/^<\/?([\w:-]+)/u)[1].toLowerCase();
    if (token.startsWith("</")) {
      const index = stack.findLastIndex((node) => node.tag === tag);
      if (index < 0) continue;
      for (const node of stack.splice(index)) node.content = source.slice(node.start, match.index);
      continue;
    }
    const attrs = new Map();
    const attributeText = token.slice(tag.length + 1, -1).replace(/\/$/u, "");
    for (const attribute of attributeText.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
      attrs.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const node = { tag, attrs, parent: stack.at(-1), start: match.index + token.length, content: "" };
    nodes.push(node);
    if (!VOID_TAGS.has(tag) && !token.endsWith("/>")) stack.push(node);
  }
  return nodes;
}

function text(value) {
  return String(value ?? "").replace(/<!--[\s\S]*?-->|<[^>]*>/gu, "")
    .replace(/&(?:nbsp|#160|#xa0);/giu, " ").trim();
}

function localUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function hasClass(node, name) {
  return String(node.attrs.get("class") ?? "").split(/\s+/u).includes(name);
}

function inside(node, ancestor) {
  for (let parent = node.parent; parent; parent = parent.parent) if (parent === ancestor) return true;
  return false;
}

function one(nodes, predicate, label, issues) {
  const matches = nodes.filter(predicate);
  if (matches.length !== 1) issues.push(`${label} must appear exactly once; found ${matches.length}`);
  return matches.length === 1 ? matches[0] : null;
}

function hook(nodes, name, tags, issues) {
  const node = one(nodes, (candidate) => candidate.attrs.has(name), name, issues);
  if (node && !tags.includes(node.tag)) issues.push(`${name} must use ${tags.join(" or ")}`);
  return node;
}

export function launcherEntryIssues(html) {
  const issues = [];
  const nodes = elements(html);
  const title = one(nodes, (node) => node.tag === "title", "launcher title", issues);
  if (title && !/\bCaatuu\b/iu.test(text(title.content))) issues.push("launcher title must identify Caatuu");
  const heading = one(nodes, (node) => node.tag === "h1", "launcher primary heading", issues);
  if (heading && !text(heading.content)) issues.push("launcher primary heading must have text");
  const description = one(nodes, (node) => node.tag === "meta" && node.attrs.get("name") === "description", "launcher description", issues);
  if (description && !text(description.attrs.get("content"))) issues.push("launcher description must have text");

  const script = one(nodes, (node) => node.tag === "script" && /(?:^|\/)launcher\.js(?:[?#]|$)/u.test(node.attrs.get("src") ?? ""), "launcher script", issues);
  if (script) {
    const url = localUrl(script.attrs.get("src"));
    if (!url || url.pathname !== "/launcher.js") issues.push("launcher script must load same-origin /launcher.js");
    if (!url?.searchParams.get("v")) issues.push("launcher script must declare a nonempty cache revision");
    if (!script.attrs.has("defer") || script.attrs.has("async")) issues.push("launcher script must defer until the document is parsed");
  }

  const browser = hook(nodes, "data-browser-entry", ["a"], issues);
  if (browser && (!localUrl(browser.attrs.get("href")) || !text(browser.content))) issues.push("browser entry must be a usable same-origin link with text");
  const download = hook(nodes, "data-android-download", ["a"], issues);
  if (download && (!text(download.content) || download.attrs.has("href") || download.attrs.get("aria-disabled") !== "true")) {
    issues.push("Android download must have text and remain disabled without a URL until its channel is validated");
  }
  hook(nodes, "data-language-list", ["ul", "ol"], issues);
  const dialog = hook(nodes, "data-course-dialog", ["dialog"], issues);
  if (dialog) {
    const children = nodes.filter((node) => inside(node, dialog));
    const titleNode = hook(children, "data-course-dialog-title", ["h2", "h3"], issues);
    hook(children, "data-course-dialog-flag", ["img"], issues);
    hook(children, "data-course-dialog-status", ["p", "div"], issues);
    hook(children, "data-course-dialog-browser", ["a"], issues);
    const android = hook(children, "data-course-dialog-android", ["a"], issues);
    if (android && (android.attrs.has("href") || android.attrs.get("aria-disabled") !== "true")) issues.push("course Android choice must wait for a validated channel");
    const close = hook(children, "data-course-dialog-close", ["button"], issues);
    if (close && (close.attrs.get("type") !== "button" || !text(close.attrs.get("aria-label") || close.content))) issues.push("course dialog close must be a named non-submit button");
    if (titleNode && (!titleNode.attrs.get("id") || dialog.attrs.get("aria-labelledby") !== titleNode.attrs.get("id"))) issues.push("course dialog must be labelled by its title");
  }
  return issues;
}

export function launcherCourseFallbackIssues(html, generatedRegistry) {
  const issues = [];
  const courses = generatedRegistry?.browserSetup?.courses;
  if (!Array.isArray(courses) || !courses.length) return ["generated registry must declare browser setup courses"];
  const nodes = elements(html);
  const list = hook(nodes, "data-language-list", ["ul", "ol"], issues);
  if (!list) return issues;
  const rows = nodes.filter((node) => inside(node, list) && node.attrs.has("data-language-id"));
  const expectedIds = courses.map(({ id }) => id);
  const actualIds = rows.map((row) => row.attrs.get("data-language-id"));
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) issues.push(`launcher fallback course order must match the generated registry; expected ${expectedIds.join(", ")}, got ${actualIds.join(", ")}`);
  const browser = nodes.find((node) => node.attrs.has("data-browser-entry"));
  if (browser?.attrs.get("href") !== generatedRegistry.browserSetup.entryPath) issues.push("browser fallback entry must match the generated default setup entry");
  for (const course of courses) {
    const row = rows.find((node) => node.attrs.get("data-language-id") === course.id);
    if (!row) continue;
    const label = `${course.id} fallback`;
    if (row.tag !== "li" || !text(row.attrs.get("aria-label"))) issues.push(`${label} must be a labelled list item`);
    const status = row.attrs.get("data-course-status") || "active";
    if (status !== course.status) issues.push(`${label} must retain registry status ${course.status}`);
    const descendants = nodes.filter((node) => inside(node, row));
    const entry = one(descendants, (node) => node.tag === "a" && hasClass(node, "language-choice"), `${label} entry`, issues);
    const url = localUrl(entry?.attrs.get("href"));
    if (!url || `${url.pathname}${url.search}${url.hash}` !== course.entryPath || !text(entry?.content)) issues.push(`${label} must link to its declared course entry with visible text`);
    const flag = one(descendants, (node) => node.tag === "img" && hasClass(node, "flag-icon"), `${label} flag`, issues);
    const flagUrl = localUrl(flag?.attrs.get("src"));
    if (!flagUrl || flagUrl.pathname !== course.targetLanguage?.flagSrc) issues.push(`${label} flag must match its generated target-language flag`);
    const badges = descendants.filter((node) => hasClass(node, "language-choice-status"));
    if (course.status === "development" && (badges.length !== 1 || !text(badges[0].content) || badges[0].attrs.has("hidden") || badges[0].attrs.get("aria-hidden") === "true")) issues.push(`${label} must visibly disclose its development status`);
    if (course.status === "active" && badges.length) issues.push(`${label} must not be labelled as a development preview`);
  }
  return issues;
}
