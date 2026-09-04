import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkCourseSelectorAssetView,
  CourseContractError,
  generateCourseProfileSource,
  generateLauncherRegistry,
  validateCourseCatalog
} from "./course-contract.mjs";

export const GENERATED_LAUNCHER_VIEW_PATH = "apps/launcher/static/languages.json";

export async function syncGeneratedViews(loaded) {
  await validateCourseCatalog(loaded, {
    checkExistence: true,
    allowMissingGeneratedViews: true
  });
  await checkCourseSelectorAssetView(loaded);

  const browserRecords = loaded.courses.filter(
    ({ course }) => course.platforms?.browser?.enabled === true
  );
  const launcher = await generateLauncherRegistry(loaded);
  const views = [
    {
      relativePath: GENERATED_LAUNCHER_VIEW_PATH,
      content: `${JSON.stringify(launcher, null, 2)}\n`
    },
    ...browserRecords.map(({ course }) => ({
      relativePath: course.resources.courseProfile.path,
      content: generateCourseProfileSource(course, loaded.courses)
    }))
  ];

  return writeGeneratedViewsAtomically({
    repoRoot: loaded.repoRoot,
    views
  });
}

export async function writeGeneratedViewsAtomically({ repoRoot, views }) {
  const root = path.resolve(repoRoot instanceof URL ? fileURLToPath(repoRoot) : repoRoot);
  const realRoot = await realpath(root);
  if (!Array.isArray(views) || views.length === 0) {
    throw viewError("Generated-view synchronization requires at least one output.");
  }

  const seen = new Set();
  const targets = [];
  for (const [index, view] of views.entries()) {
    if (!view || typeof view !== "object" || Array.isArray(view)) {
      throw viewError(`Generated view ${index} must be an object.`);
    }
    const relativePath = normalizeViewPath(view.relativePath, `Generated view ${index}`);
    if (seen.has(relativePath)) {
      throw viewError(`Generated view output is declared more than once: ${relativePath}.`);
    }
    seen.add(relativePath);
    if (typeof view.content !== "string") {
      throw viewError(`Generated view ${relativePath} content must be a string.`);
    }
    const file = path.resolve(root, ...relativePath.split("/"));
    assertInside(root, file, relativePath);
    const inspection = await inspectTarget({ root, realRoot, file, relativePath });
    targets.push({
      relativePath,
      file,
      parent: path.dirname(file),
      content: view.content,
      current: inspection.current,
      existed: inspection.existed
    });
  }

  const changed = targets.filter(({ current, content }) => current !== content);
  const unchanged = targets.filter(({ current, content }) => current === content);
  if (changed.length === 0) return freezeReport([], unchanged, targets.length);

  for (const target of changed) {
    await mkdir(target.parent, { recursive: true });
    await assertCanonicalDirectory(root, realRoot, target.parent, target.relativePath);
  }

  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const transaction = changed.map((target, index) => ({
    ...target,
    temporary: `${target.file}.caatuu-view-sync-${nonce}-${index}.tmp`,
    backup: `${target.file}.caatuu-view-sync-${nonce}-${index}.bak`,
    backedUp: false,
    installed: false
  }));
  try {
    for (const target of transaction) {
      await writeFile(target.temporary, target.content, { encoding: "utf8", flag: "wx" });
    }
    for (const target of transaction) {
      if (target.existed) {
        await rename(target.file, target.backup);
        target.backedUp = true;
      }
      await rename(target.temporary, target.file);
      target.installed = true;
    }
    for (const target of transaction) {
      const installed = await readFile(target.file, "utf8");
      if (installed !== target.content) {
        throw new Error(`Installed bytes differ for ${target.relativePath}.`);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const target of [...transaction].reverse()) {
      try {
        if (target.installed) await rm(target.file, { force: true });
        if (target.backedUp) await rename(target.backup, target.file);
      } catch (rollbackError) {
        rollbackErrors.push(`${target.relativePath}: ${rollbackError.message}`);
      }
      await rm(target.temporary, { force: true }).catch(() => {});
    }
    const rollback = rollbackErrors.length > 0
      ? ` Rollback failures: ${rollbackErrors.join("; ")}`
      : "";
    throw viewError(`Generated-view synchronization failed: ${error.message}.${rollback}`);
  } finally {
    for (const target of transaction) {
      await rm(target.temporary, { force: true }).catch(() => {});
    }
  }

  const cleanupErrors = [];
  for (const target of transaction) {
    if (!target.backedUp) continue;
    try {
      await rm(target.backup, { force: true });
    } catch (error) {
      cleanupErrors.push(`${target.relativePath}: ${error.message}`);
    }
  }
  if (cleanupErrors.length > 0) {
    throw viewError(
      `Generated views were installed, but backup cleanup failed: ${cleanupErrors.join("; ")}`
    );
  }

  return freezeReport(changed, unchanged, targets.length);
}

async function inspectTarget({ root, realRoot, file, relativePath }) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw viewError(`${relativePath} must be a regular file when it exists.`);
    }
    const realFile = await realpath(file);
    const expectedRealFile = path.resolve(realRoot, path.relative(root, file));
    if (!samePath(realFile, expectedRealFile) || !isInside(realRoot, realFile)) {
      throw viewError(`${relativePath} resolves outside its canonical repository location.`);
    }
    await assertCanonicalDirectory(root, realRoot, path.dirname(file), relativePath);
    return { existed: true, current: await readFile(file, "utf8") };
  } catch (error) {
    if (error instanceof CourseContractError) throw error;
    if (error?.code !== "ENOENT") throw error;
    await assertNearestExistingAncestor(root, realRoot, path.dirname(file), relativePath);
    return { existed: false, current: null };
  }
}

async function assertNearestExistingAncestor(root, realRoot, directory, relativePath) {
  let candidate = directory;
  while (isInside(root, candidate)) {
    try {
      const info = await lstat(candidate);
      if (!info.isDirectory()) {
        throw viewError(`Parent authority for ${relativePath} is not a directory.`);
      }
      const realCandidate = await realpath(candidate);
      const expected = path.resolve(realRoot, path.relative(root, candidate));
      if (!samePath(realCandidate, expected) || !isInside(realRoot, realCandidate)) {
        throw viewError(`Parent authority for ${relativePath} resolves outside the repository.`);
      }
      return;
    } catch (error) {
      if (error instanceof CourseContractError) throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    if (samePath(candidate, root)) break;
    candidate = path.dirname(candidate);
  }
  throw viewError(`No canonical repository parent exists for ${relativePath}.`);
}

async function assertCanonicalDirectory(root, realRoot, directory, relativePath) {
  const [info, realDirectory] = await Promise.all([lstat(directory), realpath(directory)]);
  const expected = path.resolve(realRoot, path.relative(root, directory));
  if (
    !info.isDirectory()
    || (!samePath(directory, root) && info.isSymbolicLink())
    || !samePath(realDirectory, expected)
    || !isInside(realRoot, realDirectory)
  ) {
    throw viewError(`Parent authority for ${relativePath} is not canonical.`);
  }
}

function normalizeViewPath(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw viewError(`${label} path must be a confined repository-relative POSIX path.`);
  }
  return value;
}

function assertInside(root, file, relativePath) {
  if (!isInside(root, file) || samePath(root, file)) {
    throw viewError(`Generated view path escapes the repository: ${relativePath}.`);
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function freezeReport(changed, unchanged, total) {
  return Object.freeze({
    changed: Object.freeze(changed.map(({ relativePath }) => relativePath)),
    unchanged: Object.freeze(unchanged.map(({ relativePath }) => relativePath)),
    total
  });
}

function viewError(message) {
  return new CourseContractError([{ code: "view.sync", message }]);
}
