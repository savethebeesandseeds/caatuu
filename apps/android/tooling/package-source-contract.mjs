import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_COURSE_BUNDLE_PATH,
  DEFAULT_LANGUAGE_CATALOG_PATH,
  courseBundleRecord,
  resolveAndroidNativeProviders,
} from "./build-product-assets.mjs";
import { createAndroidCourseBundlePlan, createAndroidCoursePublicationPlan } from "./android-course-bundle-plan.mjs";

function repositoryPath(value) {
  assert.equal(typeof value, "string");
  assert.ok(value && !value.includes("\\") && !value.includes(":"));
  assert.ok(value.split("/").every((part) => part && part !== "." && part !== ".."));
  return value;
}

export function packageSourceReader(workspaceRoot, revision = null) {
  if (revision !== null) {
    assert.match(revision, /^[a-f0-9]{40}$/u, "Package source revision must be a full commit ID");
    execFileSync("git", ["-C", workspaceRoot, "cat-file", "-e", `${revision}^{commit}`]);
  }
  return (file) => {
    repositoryPath(file);
    return revision === null
      ? readFileSync(resolve(workspaceRoot, file))
      : execFileSync("git", ["-C", workspaceRoot, "show", `${revision}:${file}`], { maxBuffer: 32 * 1024 * 1024 });
  };
}

// Read the receipt's catalog from Git objects, without changing the shared checkout.
export function packagePublicationPlan(readSource) {
  const json = (file) => JSON.parse(readSource(file).toString("utf8"));
  const catalog = json(DEFAULT_LANGUAGE_CATALOG_PATH);
  const bundleDeclaration = json(DEFAULT_COURSE_BUNDLE_PATH);
  const courses = catalog.courses.map(({ id, manifest }) => ({
    id, manifestPath: repositoryPath(manifest), course: json(manifest),
  }));
  const input = { catalog, courses, bundleDeclaration };
  const plan = createAndroidCourseBundlePlan(input);
  const records = plan.courses.map(({ id }) => {
    const { course } = courses.find((entry) => entry.id === id);
    const assetCatalog = json(repositoryPath(course.resources.androidAssetCatalog.path));
    const staticRoot = repositoryPath(course.resources.staticRoot.path);
    const nativeProviders = resolveAndroidNativeProviders({
      course,
      assetCatalog,
      resourceAssetPath(name) {
        const resource = repositoryPath(course.resources[name].path);
        assert.ok(resource.startsWith(`${staticRoot}/`), `${id} ${name} must be inside its static root`);
        const asset = resource.slice(staticRoot.length + 1);
        assert.ok(assetCatalog.files.includes(asset), `${id} ${name} must be allowlisted`);
        return asset;
      },
    });
    return courseBundleRecord({ course, nativeProviders });
  });
  return createAndroidCoursePublicationPlan(input, records);
}
