import assert from "node:assert/strict";
import test from "node:test";

import { validateSceneryPackage } from "../tooling/validate-scenery-package.mjs";

test("the complete scenery evidence inventory matches its hashes, lengths, and PNG dimensions", async () => {
  const report = await validateSceneryPackage({ profile: "evidence" });

  assert.equal(report.valid, true, JSON.stringify(report.issues, null, 2));
});
