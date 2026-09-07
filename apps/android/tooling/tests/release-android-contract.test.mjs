import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../release-android.ps1", import.meta.url), "utf8");
// Operation boundaries, not human messages or the spelling of local variables.
// The accompanying PowerShell suite executes the actual orchestration.
test("the Windows entrypoint delegates only to the guarded build and receipt-only deployer", () => {
  assert.match(source, /C:\\Work\\caatuu/u);
  assert.match(source, /release-orchestration\.psm1/u);
  assert.match(source, /Invoke-CaatuuReleasePipeline/u);
  assert.equal(source.match(/publish-release\.sh --build-once/gu)?.length, 1);
  assert.equal(source.match(/deploy-pages-release\.ps1/gu)?.length, 1);
  assert.match(source, /-CandidateReceipt/u);
  assert.doesNotMatch(source, /assembleRelease|bundleRelease|\bgh\b|git push|workflow run|release upload/iu);
});
