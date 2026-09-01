import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(testDir, "../../../..");
const workflow = readFileSync(join(workspaceRoot, ".github/workflows/pages.yml"), "utf8");

test("Pages publication is manual, main-only, and branchless", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\s*$/mu);
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request):/mu);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/u);
  assert.match(workflow, /git ls-remote --heads/u);
  assert.match(workflow, /Expected only remote main/u);
  assert.match(workflow, /git worktree list --porcelain/u);
  assert.match(workflow, /allow_http_certificate_bootstrap/u);
  assert.match(workflow, /default: false/u);
  assert.match(workflow, /ALLOW_HTTP_CERTIFICATE_BOOTSTRAP/u);
  assert.doesNotMatch(workflow, /gh-pages/iu);
});

test("Pages publication uses pinned artifact actions and the canonical root origin", () => {
  assert.match(workflow, /actions\/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10/u);
  assert.match(workflow, /actions\/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b/u);
  assert.match(workflow, /enablement: false/u);
  assert.match(workflow, /expected='https:\/\/caatuu\.waajacu\.com'/u);
  assert.match(workflow, /PAGES_BASE_PATH/u);
  assert.match(workflow, /actions\/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b/u);
  assert.match(workflow, /actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/u);
  assert.match(
    workflow,
    /node:24-bookworm@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2/u
  );
  assert.match(workflow, /build-pages-site\.mjs/u);
  assert.match(workflow, /--baseline-archive artifacts\/android\/pages-input\/caatuu-pages-v162\.tar/u);
  assert.doesNotMatch(workflow, /build-static-site\.mjs/u);
});

test("Pages publication downloads one exact existing-release baseline", () => {
  assert.match(
    workflow,
    /releases\/download\/caatuu-pages-v162\/caatuu-pages-v162\.tar/u
  );
  assert.match(workflow, /curl --fail --location --proto '=https' --tlsv1\.2/u);
  assert.doesNotMatch(workflow, /releases\/(?:latest|download\/latest)/iu);
  assert.doesNotMatch(workflow, /publish-public-debug|gradlew|assemble(?:Debug|Release)|bundle(?:Debug|Release)/iu);
});
