import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../deploy-pages-release.ps1", import.meta.url), "utf8");

test("receipt-only deployer plan mode makes no tracked descriptor, commit, release, or deployment mutation", () => {
  assert.match(source, /\[Parameter\(Mandatory\s*=\s*\$true\)\][\s\S]*\[string\]\$CandidateReceipt/u);
  assert.match(source, /\[switch\]\$PlanOnly/u);
  assert.match(source, /artifacts\/android\/releases\/\(\[1-9\]\[0-9\]\*\)\/caatuu-release-candidate/u);
  assert.match(source, /mode\s*=\s*"plan-only"/u);
  assert.match(source, /willBuild\s*=\s*\$false/u);
  assert.match(source, /may refresh origin\/main[\s\S]*never changes the[\s\S]*tracked descriptor/u);
});

test("deployer fails closed on concurrency, repository identity, and shared-tree state", () => {
  assert.match(source, /System\.Threading\.Mutex/u);
  assert.match(source, /WaitOne\(0\)/u);
  assert.match(source, /C:\\Work\\caatuu/u);
  assert.match(source, /https:\/\/github\.com\/savethebeesandseeds\/caatuu\.git/u);
  assert.match(source, /symbolic-ref",\s*"--short",\s*"HEAD"/u);
  assert.match(source, /refs\/heads\/main/u);
  assert.match(source, /refs\/remotes\/origin\/main/u);
  assert.match(source, /"worktree",\s*"list",\s*"--porcelain"/u);
  assert.match(source, /"fetch",\s*"--no-tags",\s*"origin"/u);
  assert.match(source, /"ls-remote",\s*"--heads",\s*"origin"/u);
  assert.match(source, /pending-descriptor/u);
  assert.match(source, /pending-commit/u);
  assert.match(source, /Assert-ExactDescriptorAdvance/u);
  assert.ok((source.match(/Assert-MainOnlyInvariant\s+-CheckRemote/gu) || []).length >= 6);
  assert.ok((source.match(/Get-WorktreeState/gu) || []).length >= 8);
});

test("deployer requires the canonical running tool container and validates without building", () => {
  assert.match(source, /"docker"[\s\S]*"inspect",\s*"caatuu-dev"/u);
  assert.match(source, /State\.Running/u);
  assert.match(source, /Destination\s*-eq\s*"\/workspace"/u);
  assert.match(source, /Type\s*-ne\s*"bind"/u);
  assert.match(source, /pages-current-release\.mjs"[\s\S]*"advance"/u);
  assert.match(source, /merge-base",\s*"--is-ancestor"/u);
  assert.doesNotMatch(source, /gradlew|assembleRelease|bundleRelease|build-release-aab\.sh|publish-release\.sh/u);
});

test("new descriptor publication is bound to the exact source commit while retries can reuse history", () => {
  assert.match(source, /function Assert-ExactCandidateSource/u);
  assert.match(source, /Kind\s*-eq\s*"clean"\s*-and\s*\$script:candidate\.action\s*-eq\s*"append"/u);
  assert.match(source, /\$reconstruction\.action\s*-eq\s*"append"/u);
  assert.match(source, /"rev-list",\s*"--parents",\s*"-n",\s*"1",\s*"HEAD"/u);
  assert.match(source, /Assert-ExactCandidateSource\s+\$parents\[1\]/u);
  assert.match(source, /publishing a stale candidate/u);
});

test("deployer scopes the only source commit and uses ordinary main pushes", () => {
  assert.match(source, /"add",\s*"--",\s*\$DescriptorRelativePath/u);
  assert.match(source, /"diff",\s*"--cached",\s*"--name-only"/u);
  assert.match(source, /"commit",\s*"--only"/u);
  assert.match(source, /"push",\s*"origin",\s*"HEAD:refs\/heads\/main"/u);
  assert.doesNotMatch(source, /--force|push[^\r\n]*\s-f(?:\s|"|')/u);
  assert.doesNotMatch(source, /"(?:reset|restore|stash|switch|checkout)"/u);
  assert.doesNotMatch(source, /Get-GitOutput\s+@\("clean"/u);
  assert.doesNotMatch(source, /"worktree",\s*"add"|"branch",/u);
});

test("GitHub publication is draft-first, immutable, digest-checked, and resumable", () => {
  assert.match(source, /"gh"[\s\S]*"auth",\s*"status",\s*"--hostname",\s*"github\.com"/u);
  assert.doesNotMatch(source, /"auth",\s*"login"/u);
  assert.match(source, /"release",\s*"create"[\s\S]*"--verify-tag"[\s\S]*"--draft"/u);
  assert.match(source, /"release",\s*"upload"/u);
  assert.match(source, /ContainsKey\(\$name\)/u);
  assert.match(source, /remote\.digest/u);
  assert.match(source, /remote\.size/u);
  assert.match(source, /"release",\s*"edit"[\s\S]*"--draft=false"/u);
  assert.match(source, /Assert-MainOnlyInvariant\s+-CheckRemote[\s\S]*?HEAD before draft release creation[\s\S]*?GitHub main before draft release creation[\s\S]*?\$create = Invoke-NativeResult[\s\S]*?"release", "create"/u);
  assert.match(source, /Assert-MainOnlyInvariant\s+-CheckRemote[\s\S]*?HEAD before uploading \$name[\s\S]*?GitHub main before uploading \$name[\s\S]*?\$upload = Invoke-NativeResult[\s\S]*?"release", "upload"/u);
  assert.match(source, /Assert-MainOnlyInvariant\s+-CheckRemote[\s\S]*?HEAD before publishing the GitHub Release[\s\S]*?GitHub main before publishing the GitHub Release[\s\S]*?"release", "edit"/u);
  assert.doesNotMatch(source, /--clobber|"release",\s*"delete"|(?:-X|--method)\s*DELETE/u);
});

test("Pages dispatch is pinned to the handoff revision and ends with public verification", () => {
  assert.match(source, /"workflow",\s*"run",\s*\$Workflow/u);
  assert.match(source, /expected_revision=\$Head/u);
  assert.match(source, /allow_http_certificate_bootstrap=false/u);
  assert.match(source, /headSha\s*-eq\s*\$Head/u);
  assert.match(source, /"run",\s*"watch"/u);
  assert.match(source, /verify-public-pages-release\.mjs/u);
  assert.match(source, /reportingVersion/u);
  assert.match(source, /System\.Diagnostics\.Stopwatch/u);
});
