import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

const CONTRACT_SPECIFIER = '"/language-runtime/contract.mjs"';
const CONTRACT_URL = new URL("../contract.mjs", import.meta.url).href;

export async function importBrowserLanguageAdapter(relativeUrl) {
  const moduleUrl = relativeUrl instanceof URL
    ? relativeUrl
    : new URL(relativeUrl, import.meta.url);
  const source = await readFile(moduleUrl, "utf8");
  const contractImports = source.split(CONTRACT_SPECIFIER).length - 1;

  if (contractImports !== 1) {
    throw new Error(
      `Expected ${moduleUrl.href} to import the canonical browser contract exactly once; found ${contractImports}.`
    );
  }

  const nodeLoadableSource = source.replace(CONTRACT_SPECIFIER, JSON.stringify(CONTRACT_URL));
  const dataUrl = `data:text/javascript;base64,${Buffer.from(nodeLoadableSource).toString("base64")}`;
  return (await import(dataUrl)).default;
}
