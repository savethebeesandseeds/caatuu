import fs from "node:fs/promises";

export async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

export async function writeJson(path, value) {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function dirname(path) {
  return path.replace(/[\\/][^\\/]*$/, "");
}

export function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function shuffle(rows, seed) {
  const rng = makeRng(seed);
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}
