import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_LANGUAGE_CATALOG_PATH = "apps/languages/catalog.json";
export const MODERN_LANGUAGE_CONTENT_CONTRACT = "language-content-v1";

const DEFAULT_REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const COURSE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export async function loadCatalogLanguageContentCourses({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  catalogPath = DEFAULT_LANGUAGE_CATALOG_PATH,
  courseId = null
} = {}) {
  const root = path.resolve(
    repositoryRoot instanceof URL ? fileURLToPath(repositoryRoot) : repositoryRoot
  );
  const normalizedCatalogPath = normalizeRepositoryPath(catalogPath, "catalogPath");
  const catalog = await readJson(root, normalizedCatalogPath);
  if (!isObject(catalog) || !Array.isArray(catalog.courses)) {
    throw new Error(`${normalizedCatalogPath} must contain a courses array.`);
  }
  const selectedId = courseId === null ? null : normalizeCourseId(courseId);
  const ids = new Set();
  const declarations = catalog.courses.map((entry, index) => {
    if (!isObject(entry)) {
      throw new Error(`${normalizedCatalogPath} courses[${index}] must be an object.`);
    }
    const id = normalizeCourseId(entry.id, `${normalizedCatalogPath} courses[${index}].id`);
    if (ids.has(id)) throw new Error(`${normalizedCatalogPath} contains duplicate course id ${id}.`);
    ids.add(id);
    return {
      id,
      manifestPath: normalizeRepositoryPath(
        entry.manifest,
        `${normalizedCatalogPath} course ${id} manifest`
      )
    };
  });
  if (selectedId && !ids.has(selectedId)) {
    throw new Error(`Course ${selectedId} is not declared by ${normalizedCatalogPath}.`);
  }

  const records = await Promise.all(declarations.map(async (declaration) => {
    const course = await readJson(root, declaration.manifestPath);
    if (!isObject(course) || course.id !== declaration.id) {
      throw new Error(
        `${declaration.manifestPath} must declare course id ${declaration.id}.`
      );
    }
    return Object.freeze({ ...declaration, course });
  }));
  const selectedRecords = selectedId
    ? records.filter(({ id }) => id === selectedId)
    : records;
  const modernRecords = selectedRecords.filter(
    ({ course }) => course.publication?.contract === MODERN_LANGUAGE_CONTENT_CONTRACT
  );
  if (selectedId && modernRecords.length === 0) {
    throw new Error(
      `Course ${selectedId} does not use ${MODERN_LANGUAGE_CONTENT_CONTRACT}.`
    );
  }
  if (!selectedId && modernRecords.length === 0) {
    throw new Error(
      `${normalizedCatalogPath} declares no ${MODERN_LANGUAGE_CONTENT_CONTRACT} courses.`
    );
  }

  return Object.freeze(modernRecords.map((record) => Object.freeze({
    ...record,
    conceptsPath: requireRepositoryPath(
      record.course.publication?.concepts,
      `${record.id}.publication.concepts`
    ),
    realizationsPath: requireRepositoryPath(
      record.course.publication?.realizations,
      `${record.id}.publication.realizations`
    ),
    learnerBaseRealizationsPath: optionalRepositoryPath(
      record.course.publication?.learnerBaseRealizations,
      `${record.id}.publication.learnerBaseRealizations`
    ),
    sourceLanguage: requireSourceLanguage(record.course, record.id)
  })));
}

function requireSourceLanguage(course, courseId) {
  const value = course.sourceLanguage?.locale ?? course.sourceLanguage?.id;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${courseId}.sourceLanguage must provide locale or id.`);
  }
  return value;
}

function requireRepositoryPath(value, label) {
  if (value === null || value === undefined) {
    throw new Error(`${label} is required by ${MODERN_LANGUAGE_CONTENT_CONTRACT}.`);
  }
  return normalizeRepositoryPath(value, label);
}

function optionalRepositoryPath(value, label) {
  return value === null || value === undefined ? null : normalizeRepositoryPath(value, label);
}

function normalizeCourseId(value, label = "courseId") {
  if (typeof value !== "string" || !COURSE_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a lowercase course ID.`);
  }
  return value;
}

function normalizeRepositoryPath(value, label) {
  if (
    typeof value !== "string"
    || !value
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a confined repository-relative POSIX path.`);
  }
  return value;
}

async function readJson(root, relativePath) {
  const file = await resolveRealRepositoryFile(root, relativePath);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function resolveRealRepositoryFile(root, relativePath) {
  const lexicalRoot = path.resolve(root);
  const lexicalFile = path.resolve(lexicalRoot, ...relativePath.split("/"));
  const lexicalRelative = path.relative(lexicalRoot, lexicalFile);
  if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new Error(`Repository path escapes the workspace: ${relativePath}`);
  }
  const [realRoot, realFile] = await Promise.all([realpath(lexicalRoot), realpath(lexicalFile)]);
  const expectedRealFile = path.resolve(realRoot, lexicalRelative);
  const realRelative = path.relative(realRoot, realFile);
  if (
    !realRelative
    || realRelative.startsWith("..")
    || path.isAbsolute(realRelative)
    || path.relative(expectedRealFile, realFile) !== ""
  ) {
    throw new Error(`Repository path resolves outside its canonical workspace location: ${relativePath}`);
  }
  return realFile;
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
