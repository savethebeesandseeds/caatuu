import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CourseContractError,
  isAllowedMissingGeneratedViewResource
} from "../lib/course-contract.mjs";
import { writeGeneratedViewsAtomically } from "../lib/generated-views.mjs";

function hasIssue(error, code, messagePattern) {
  return error instanceof CourseContractError && error.issues.some((issue) => (
    issue.code === code && (!messagePattern || messagePattern.test(issue.message))
  ));
}

test("only a missing browser course profile qualifies for bootstrap", () => {
  const browserCourse = { platforms: { browser: { enabled: true } } };
  assert.equal(isAllowedMissingGeneratedViewResource({
    course: browserCourse,
    resourceName: "courseProfile",
    errorCode: "ENOENT"
  }), true);
  assert.equal(isAllowedMissingGeneratedViewResource({
    course: browserCourse,
    resourceName: "launcherFlag",
    errorCode: "ENOENT"
  }), false);
  assert.equal(isAllowedMissingGeneratedViewResource({
    course: { platforms: { browser: { enabled: false } } },
    resourceName: "courseProfile",
    errorCode: "ENOENT"
  }), false);
  assert.equal(isAllowedMissingGeneratedViewResource({
    course: browserCourse,
    resourceName: "courseProfile",
    errorCode: "EACCES"
  }), false);
});

test("generated-view writer bootstraps parents and is idempotent", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-view-sync-"));
  try {
    const launcherPath = "apps/launcher/static/languages.json";
    const profilePath = "apps/languages/spanish/static/source/shared/course-profile.js";
    const launcherFile = path.join(temporaryRoot, ...launcherPath.split("/"));
    const profileFile = path.join(temporaryRoot, ...profilePath.split("/"));
    await mkdir(path.dirname(launcherFile), { recursive: true });
    await writeFile(launcherFile, "stale\n", "utf8");

    const views = [
      { relativePath: launcherPath, content: "launcher\n" },
      { relativePath: profilePath, content: "profile\n" }
    ];
    const first = await writeGeneratedViewsAtomically({ repoRoot: temporaryRoot, views });
    assert.deepEqual(first.changed, [launcherPath, profilePath]);
    assert.deepEqual(first.unchanged, []);
    assert.equal(first.total, 2);
    assert.equal(await readFile(launcherFile, "utf8"), "launcher\n");
    assert.equal(await readFile(profileFile, "utf8"), "profile\n");

    const second = await writeGeneratedViewsAtomically({ repoRoot: temporaryRoot, views });
    assert.deepEqual(second.changed, []);
    assert.deepEqual(second.unchanged, [launcherPath, profilePath]);
    assert.equal(second.total, 2);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("generated-view writer preflights every output before changing one", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-view-sync-preflight-"));
  try {
    const safePath = "apps/launcher/static/languages.json";
    const invalidPath = "apps/languages/spanish/static/source/shared/course-profile.js";
    const safeFile = path.join(temporaryRoot, ...safePath.split("/"));
    const invalidFile = path.join(temporaryRoot, ...invalidPath.split("/"));
    await mkdir(path.dirname(safeFile), { recursive: true });
    await mkdir(invalidFile, { recursive: true });
    await writeFile(safeFile, "original\n", "utf8");

    await assert.rejects(
      writeGeneratedViewsAtomically({
        repoRoot: temporaryRoot,
        views: [
          { relativePath: safePath, content: "replacement\n" },
          { relativePath: invalidPath, content: "profile\n" }
        ]
      }),
      (error) => hasIssue(error, "view.sync", /regular file/u)
    );
    assert.equal(await readFile(safeFile, "utf8"), "original\n");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("generated-view writer rejects duplicate and escaping outputs", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "caatuu-view-sync-paths-"));
  try {
    await assert.rejects(
      writeGeneratedViewsAtomically({
        repoRoot: temporaryRoot,
        views: [
          { relativePath: "views/profile.js", content: "one" },
          { relativePath: "views/profile.js", content: "two" }
        ]
      }),
      (error) => hasIssue(error, "view.sync", /more than once/u)
    );
    await assert.rejects(
      writeGeneratedViewsAtomically({
        repoRoot: temporaryRoot,
        views: [{ relativePath: "../outside.js", content: "outside" }]
      }),
      (error) => hasIssue(error, "view.sync", /confined repository-relative/u)
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
