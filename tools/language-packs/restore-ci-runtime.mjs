// Reconstruct ignored course compatibility copies from the already verified
// shared runtime downloads. Every output must match its course's exact pin.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const confined = (path) => {
  const output = resolve(root, path);
  const local = relative(root, output);
  assert.ok(local && !local.startsWith("..") && !isAbsolute(local));
  return output;
};
const json = (path) => JSON.parse(readFileSync(confined(path), "utf8"));
const shared = json("apps/language-runtime/embedding-runtimes.json").runtimes.flatMap(({ artifacts }) => artifacts);
let restored = 0;
for (const { manifest } of json("apps/languages/catalog.json").courses) {
  const course = json(manifest);
  if (!course.platforms.browser.enabled) continue;
  const setup = json(course.resources.setupCatalog.path);
  for (const artifact of setup.artifacts.filter(({ artifact_kind }) => artifact_kind === "embedding-runtime")) {
    assert.ok(artifact.url.startsWith(`${course.routePrefix}/`));
    const local = artifact.url.slice(course.routePrefix.length + 1);
    assert.ok(!local.includes("\\") && local.split("/").every((part) => part && part !== "." && part !== ".."));
    const destination = confined(`${course.resources.staticRoot.path}/${local}`);
    let bytes;
    const identical = shared.find(({ sha256 }) => sha256 === artifact.sha256);
    if (identical) bytes = readFileSync(confined(`apps/language-runtime/${identical.path}`));
    else {
      // Compatibility notices name the course's historical Transformers URL.
      assert.ok(local.endsWith("/THIRD_PARTY_NOTICES.json"), `No verified shared runtime source for ${artifact.key}`);
      const notices = shared.filter(({ path }) => path.endsWith("/THIRD_PARTY_NOTICES.json"));
      assert.equal(notices.length, 1);
      bytes = Buffer.from(readFileSync(confined(`apps/language-runtime/${notices[0].path}`), "utf8")
        .replaceAll("/language-runtime/vendor/transformers/LICENSE", `${course.routePrefix}/vendor/transformers/LICENSE`));
    }
    assert.equal(bytes.length, artifact.bytes, `${artifact.key} byte count`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256, `${artifact.key} SHA-256`);
    if (existsSync(destination)) {
      assert.ok(readFileSync(destination).equals(bytes), `${artifact.key} existing bytes differ`);
    } else {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: "wx" });
      restored++;
    }
  }
}
console.log(`Restored ${restored} pinned compatibility runtime files; existing files verified.`);
