import { readFile } from "node:fs/promises";

import {
  createInterfaceContent,
  installInterfaceContent
} from "../../static/source/interface-content.mjs";

const englishInterfaceCatalog = JSON.parse(await readFile(
  new URL("../../static/data/interface/en.v1.json", import.meta.url),
  "utf8"
));

export const englishInterfaceContent = createInterfaceContent(englishInterfaceCatalog);

export function installEnglishInterfaceContent(scopeOrHarness) {
  const scope = scopeOrHarness?.context || scopeOrHarness;
  if (!scope || (typeof scope !== "object" && typeof scope !== "function")) {
    throw new TypeError("A test scope is required to install English interface content.");
  }
  installInterfaceContent(englishInterfaceContent, scope);
  if (scope.window && scope.window !== scope) {
    installInterfaceContent(englishInterfaceContent, scope.window);
  }
  return englishInterfaceContent;
}
