// Structural checks complement the real Axum routing tests in routes/mod.rs.
// Ignore comments and the Rust test module so negative fixtures cannot pass an
// active route check, or make a retired route look mounted in production.
function rustTokens(source) {
  const tokens = [];
  for (let i = 0; i < source.length;) {
    if (/\s/u.test(source[i])) { i += 1; continue; }
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth += 1; i += 2; }
        else if (source.startsWith("*/", i)) { depth -= 1; i += 2; }
        else i += 1;
      }
      continue;
    }
    const raw = source.slice(i).match(/^r(#{0,})"/u);
    if (raw) {
      const start = i + raw[0].length;
      const closing = `"${raw[1]}`;
      const end = source.indexOf(closing, start);
      tokens.push({ value: source.slice(start, end < 0 ? source.length : end), string: true });
      i = end < 0 ? source.length : end + closing.length;
      continue;
    }
    if (source[i] === '"') {
      const start = i++;
      while (i < source.length) {
        if (source[i] === "\\") i += 2;
        else if (source[i++] === '"') break;
      }
      const literal = source.slice(start, i);
      let value;
      try { value = JSON.parse(literal); } catch { value = literal.slice(1, -1); }
      tokens.push({ value, string: true });
      continue;
    }
    const identifier = source.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/u)?.[0];
    tokens.push({ value: identifier || source[i], string: false });
    i += identifier?.length || 1;
  }
  const testModule = tokens.findIndex((_, index) => matches(tokens, index, ["#", "[", "cfg", "(", "test", ")", "]", "mod", "tests"]));
  return testModule < 0 ? tokens : tokens.slice(0, testModule);
}

function matches(tokens, index, values) {
  return values.every((value, offset) => tokens[index + offset]?.value === value);
}

function closingBrace(tokens, opening) {
  let depth = 0;
  for (let i = opening; i < tokens.length; i += 1) {
    if (tokens[i].string) continue;
    if (tokens[i].value === "{") depth += 1;
    if (tokens[i].value === "}" && --depth === 0) return i;
  }
  return -1;
}

function activeComposeLines(source) {
  // Preserve quoted scalars, including '#' within them, while removing comments.
  return source.split(/\r?\n/u).map((line) => {
    let quote = "";
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "\\" && quote === '"') { i += 1; continue; }
      if (quote) { if (line[i] === quote) quote = ""; }
      else if (line[i] === '"' || line[i] === "'") quote = line[i];
      else if (line[i] === "#" && (i === 0 || /\s/u.test(line[i - 1]))) return line.slice(0, i);
    }
    return line;
  }).join("\n");
}

function localService(compose) {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => /^  ["']?caatuu["']?:\s*$/u.test(line));
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^ {3,}/u.test(lines[end]))) end += 1;
  return lines.slice(start, end).join("\n");
}

export function standalonePreviewIssues({ routesSource, composeSource }) {
  const issues = [];
  const tokens = rustTokens(routesSource);
  const mountPrefix = [".", "nest", "(", "/games", ","];
  const labCall = ["game_lab", ":", ":", "build_router", "(", "&", "workspace", ")"];
  const mounts = tokens.flatMap((_, i) => matches(tokens, i, mountPrefix) ? [i] : []);
  const calls = tokens.flatMap((_, i) => matches(tokens, i, labCall) && !tokens[i].string ? [i] : []);
  const mount = mounts[0];
  if (mounts.length !== 1 || calls.length !== 1 || !matches(tokens, mount, [...mountPrefix, ...labCall, ")"])) {
    issues.push("runtime must mount the source-backed art labs exactly once at /games");
  }
  const gated = tokens.some((_, i) => {
    if (!matches(tokens, i, ["if", "features", ".", "caatuu_game_preview", "{"]) || tokens[i].string) return false;
    const end = closingBrace(tokens, i + 4);
    return mount > i + 4 && mount < end;
  });
  if (!gated) issues.push("art lab routes must remain inside the enabled preview branch");
  if (tokens.some((token) => token.string && /(?:^\/caatuu-game(?:\/|$)|\/games\/(?:caatuu-game|memory-moon)(?:\/|$)|artifacts\/games\/caatuu-game\/web\/godot-v1)/u.test(token.value))) {
    issues.push("runtime must not mount retired Godot game entries or generated bundle artifacts");
  }
  const compose = activeComposeLines(composeSource);
  if (/^\s*["']?caatuu-game-godot-(?:export|provision)["']?\s*:/mu.test(compose)) {
    issues.push("active Compose must not restore retired Godot export or provisioning services");
  }
  if (/caatuu-godot-web-toolchain|artifacts\/games\/caatuu-game\/web\/godot-v1\s*:\s*\/output/u.test(compose)) {
    issues.push("active Compose must not restore retired Godot export mounts or toolchain volumes");
  }
  const service = localService(compose);
  const previewSetting = service.match(/^\s+ENABLE_CAATUU_GAME_PREVIEW:\s*(.+)$/mu)?.[1]?.replace(/^["']|["']$/gu, "").trim();
  // A configurable flag can be enabled even when its default is false.
  if (previewSetting && !/^(?:0|false|no|off)$/iu.test(previewSetting)) {
    for (const source of ["apps/games/lab", "apps/games/caatuu-game/character-workshop"]) {
      const expected = `./${source}:/workspace/${source}:ro`;
      const mounts = service.split("\n").map((line) => line.trim().replace(/^-\s*/u, "").replace(/^["']|["']$/gu, ""));
      if (!mounts.includes(expected)) issues.push(`preview-enabled local service must mount ${source} read-only at its canonical workspace path`);
    }
  }
  return issues;
}
