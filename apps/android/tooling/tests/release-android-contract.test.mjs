import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../release-android.ps1", import.meta.url), "utf8");
const orchestration = await readFile(new URL("../release-orchestration.psm1", import.meta.url), "utf8");
// Operation boundaries, not human messages or the spelling of local variables.
// The accompanying PowerShell suite executes the actual orchestration.
test("the Windows entrypoint delegates only to the guarded build and receipt-only deployer", () => {
  assert.match(source, /C:\\Work\\caatuu/u);
  assert.match(source, /release-orchestration\.psm1/u);
  assert.match(source, /Invoke-CaatuuReleasePipeline/u);
  assert.match(source, /docker exec --workdir \/workspace caatuu-dev bash/u);
  assert.match(source, /-ReadFinalizedState/u);
  assert.match(source, /-BuildStage[\s\S]*-DeployStage/u);
  assert.equal(source.match(/publish-release\.sh --build-once/gu)?.length, 1);
  assert.equal(source.match(/deploy-pages-release\.ps1/gu)?.length, 1);
  assert.match(source, /-CandidateReceipt/u);
  assert.doesNotMatch(source + orchestration, /Wait-CaatuuReleaseSourceCI|SourceCheckStage|\bgh\b/u);
  assert.doesNotMatch(source, /assembleRelease|bundleRelease|\bgh\b|git push|workflow run|release upload/iu);
});
