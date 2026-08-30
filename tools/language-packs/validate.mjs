#!/usr/bin/env node

import {
  checkCourseProfileView,
  checkGeneratedViews,
  checkLauncherView,
  CourseContractError,
  generateCourseProfileSource,
  generateLauncherRegistry,
  loadAndValidateCourseCatalog
} from "./lib/course-contract.mjs";

function usage() {
  return `Usage: node tools/language-packs/validate.mjs [action] [options]

Actions (choose at most one):
  --check-views              Check the launcher registry and every present course profile
  --check-launcher           Check apps/launcher/static/languages.json
  --check-profile <id>       Check one present course-profile.js view
  --emit-launcher            Print the generated public launcher registry to stdout
  --emit-profile <id>        Print a generated course-profile.js view to stdout

Options:
  --catalog <path>           Repository-relative internal catalog path
  --repo-root <path>         Repository root (defaults to this checkout)
  --help                     Show this help

With no action, the command validates the internal catalog and all manifests.
No action writes files.`;
}

function parseArguments(argv) {
  const result = { action: "validate" };
  const setAction = (action, value) => {
    if (result.action !== "validate") throw new Error("Choose only one action.");
    result.action = action;
    if (value !== undefined) result.courseId = value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      result.help = true;
    } else if (argument === "--catalog") {
      result.catalogPath = argv[++index];
      if (!result.catalogPath) throw new Error("--catalog requires a path.");
    } else if (argument === "--repo-root") {
      result.repoRoot = argv[++index];
      if (!result.repoRoot) throw new Error("--repo-root requires a path.");
    } else if (argument === "--check-views") {
      setAction("check-views");
    } else if (argument === "--check-launcher") {
      setAction("check-launcher");
    } else if (argument === "--check-profile") {
      const courseId = argv[++index];
      if (!courseId) throw new Error("--check-profile requires a course ID.");
      setAction("check-profile", courseId);
    } else if (argument === "--emit-launcher") {
      setAction("emit-launcher");
    } else if (argument === "--emit-profile") {
      const courseId = argv[++index];
      if (!courseId) throw new Error("--emit-profile requires a course ID.");
      setAction("emit-profile", courseId);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }

  const loaded = await loadAndValidateCourseCatalog({
    catalogPath: options.catalogPath,
    repoRoot: options.repoRoot
  });
  if (options.action === "emit-launcher") {
    console.log(`${JSON.stringify(await generateLauncherRegistry(loaded), null, 2)}\n`);
    return;
  }
  if (options.action === "emit-profile") {
    const record = loaded.courses.find(({ course }) => course.id === options.courseId);
    if (!record) throw new CourseContractError([{ code: "view.profile", message: `Unknown course ID ${options.courseId}.` }]);
    process.stdout.write(generateCourseProfileSource(record.course, loaded.courses));
    return;
  }
  if (options.action === "check-launcher") {
    await checkLauncherView(loaded);
    console.log("Launcher registry matches the active course manifests.");
    return;
  }
  if (options.action === "check-profile") {
    await checkCourseProfileView(loaded, options.courseId);
    console.log(`${options.courseId} course profile matches its manifest.`);
    return;
  }
  if (options.action === "check-views") {
    await checkGeneratedViews(loaded);
    console.log("Launcher registry and present course profiles match the course manifests.");
    return;
  }

  const counts = loaded.courses.reduce((result, { course }) => {
    result[course.status] = (result[course.status] ?? 0) + 1;
    return result;
  }, {});
  const detail = Object.entries(counts).map(([status, count]) => `${count} ${status}`).join(", ");
  console.log(`Validated ${loaded.courses.length} course packs (${detail}).`);
}

main().catch((error) => {
  console.error(error instanceof CourseContractError ? error.message : error.stack ?? error.message);
  process.exitCode = 1;
});
