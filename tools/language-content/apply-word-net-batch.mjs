#!/usr/bin/env node
// Applies explicitly authored data. This tool never generates translations,
// glosses, tokens or bank rows, and never publishes runtime catalogs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, rename, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWordWorldCourses, loadWordWorldContent, validateWordWorldContent, repositoryRoot } from "./lib/word-world-course-content.mjs";
import { inspectLearnerFields } from "../czech-ml/scripts/learner-content-safety-lib.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const serialize = value => JSON.stringify(value, null, 2) + "\n";

function workspaceGuard(root) {
  const git = args => execFileSync("git", ["-c", `safe.directory=${root}`, ...args], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(git(["branch", "--show-current"]), "main");
  assert.equal(git(["for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/main");
  for (const line of git(["for-each-ref", "--format=%(refname) %(symref)", "refs/remotes"]).split("\n").filter(Boolean)) {
    const [ref, symbolic] = line.split(" ");
    assert.ok(symbolic || /^refs\/remotes\/[^/]+\/main$/u.test(ref), `Unexpected remote branch: ${ref}`);
  }
  assert.equal(git(["rev-parse", "--show-toplevel"]), root.replaceAll("\\", "/"));
}

export async function applyWordNetBatch(batchFile, { apply = false, root = repositoryRoot } = {}) {
  root = await realpath(root);
  workspaceGuard(root);
  const batchBytes = await readFile(batchFile, "utf8");
  const batch = JSON.parse(batchBytes);
  assert.equal(batch.schemaVersion, "caatuu-authored-word-net-batch-v1");
  assert.equal(batch.review.kind, "ai-author-review");
  assert.equal(batch.review.nativeReviewed, false);
  assert.ok(batch.review.notes?.trim());
  assert.ok(Array.isArray(batch.entries) && batch.entries.length);
  const bankPath = path.join(root, "apps/languages/shared/semantic-banks/word-net.json");
  const bankBytes = await readFile(bankPath, "utf8"), bankHash = hash(bankBytes);
  const bank = new Map(JSON.parse(bankBytes).map(item => [item.id, item]));
  const courses = new Map((await loadWordWorldCourses({ root })).map(({ course }) => [course.id, course]));
  const documents = new Map(), seen = new Set(), changes = [];
  const fields = [];
  for (const entry of batch.entries) {
    const key = `${entry.courseId}:${entry.semanticBankId}`;
    assert.ok(!seen.has(key), `Duplicate candidate: ${key}`);
    seen.add(key);
    const authority = bank.get(entry.semanticBankId);
    assert.ok(authority, `Unknown bank row: ${key}`);
    assert.equal(entry.englishText, authority.englishText, `English changed: ${key}`);
    const course = courses.get(entry.courseId);
    assert.ok(course, `Unknown course: ${entry.courseId}`);
    assert.equal(course.publication.contract, "language-content-v1", "This batch tool requires the modern provider; Czech needs its separate migration.");
    if (!documents.has(course.id)) {
      const { document, sourcePath } = await loadWordWorldContent(course, { root });
      const sourceBytes = await readFile(path.join(root, sourcePath), "utf8");
      assert.deepEqual(JSON.parse(sourceBytes), document, "Source changed while loading");
      documents.set(course.id, { course, document, sourcePath, sourceBytes });
    }
    const { document } = documents.get(course.id);
    const matches = document.records.filter(item => item.semanticBankId === entry.semanticBankId);
    assert.equal(matches.length, 1, `Expected one existing course row: ${key}`);
    const item = matches[0];
    for (const field of ["englishText", "difficulty", "usefulness"]) assert.equal(item[field], authority[field], `${key}.${field} differs from bank`);
    assert.deepEqual(Object.keys(entry.patch).sort(), ["targetText", "tokens", "learnerBase",
      ...(Object.hasOwn(entry.patch, "pronunciation") ? ["pronunciation"] : [])].sort());
    if (course.sourceLanguage.locale.startsWith("en")) assert.equal(entry.patch.learnerBase, null);
    else if (course.targetLanguage.locale === "en-US") assert.equal(entry.patch.targetText, authority.englishText, "English target must preserve bank wording");
    const replacement = { ...item, ...structuredClone(entry.patch) };
    delete replacement.reviewStatus;
    if (item.reviewStatus !== "untranslated") {
      assert.deepEqual(item, replacement, `Existing authored row differs: ${key}; review the live edit instead of overwriting it`);
    } else {
      Object.assign(item, replacement);
      delete item.reviewStatus;
      changes.push({ courseId: course.id, recordId: item.id, semanticBankId: item.semanticBankId,
        englishText: item.englishText, difficulty: item.difficulty, usefulness: item.usefulness });
    }
    fields.push({ file: key, contentId: item.id, field: "englishText", locale: "en", text: item.englishText });
    fields.push({ file: key, contentId: item.id, field: "targetText", locale: course.targetLanguage.locale, text: item.targetText });
    for (const [index, token] of item.tokens.entries()) {
      fields.push({ file: key, contentId: item.id, field: `tokens[${index}].gloss`, locale: "en", text: token.gloss });
    }
    if (item.learnerBase) {
      fields.push({ file: key, contentId: item.id, field: "learnerBase.text", locale: course.sourceLanguage.locale, text: item.learnerBase.text });
      for (const [index, hint] of item.learnerBase.tokenMeanings.entries()) {
        fields.push({ file: key, contentId: item.id, field: `learnerBase.tokenMeanings[${index}].text`, locale: course.sourceLanguage.locale, text: hint.text });
      }
    }
  }
  const findings = inspectLearnerFields(fields);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
  // Full-course validation happens before any live content is written.
  for (const { document, course } of documents.values()) validateWordWorldContent(document, course);
  for (const { sourcePath, sourceBytes } of documents.values()) {
    assert.equal(await readFile(path.join(root, sourcePath), "utf8"), sourceBytes, `Concurrent edit: ${sourcePath}`);
  }
  assert.equal(hash(await readFile(bankPath, "utf8")), bankHash, "Bank changed during validation");
  const report = { schemaVersion: "caatuu-content-authoring-receipt-v1", batchSha256: hash(batchBytes),
    bankSha256: bankHash, review: batch.review, apply, changes,
    safetyScope: "English/Czech automated rules plus the declared AI author review; not native review",
    courses: [...documents.values()].map(({ course, sourcePath, sourceBytes, document }) => ({
      courseId: course.id, sourcePath, beforeSha256: hash(sourceBytes), afterSha256: hash(serialize(document)),
      authored: document.records.filter(item => item.reviewStatus !== "untranslated").length,
      untranslated: document.records.filter(item => item.reviewStatus === "untranslated").length
    })) };
  if (apply && changes.length) {
    workspaceGuard(root);
    const receipts = path.join(root, "artifacts/content-authoring/receipts");
    await mkdir(receipts, { recursive: true });
    // Keep the validated intent before writes so an interrupted application is resumable.
    const receiptPath = path.join(receipts, `${Date.now()}-${hash(batchBytes).slice(0, 12)}.json`);
    await writeFile(receiptPath, serialize({ ...report, status: "validated-pending-write" }), { flag: "wx" });
    for (const { sourcePath, sourceBytes, document } of documents.values()) {
      const target = path.join(root, sourcePath), bytes = serialize(document);
      if (bytes === sourceBytes) continue;
      assert.equal(await readFile(target, "utf8"), sourceBytes, `Concurrent edit: ${sourcePath}`);
      const temporary = `${target}.authoring-${process.pid}.tmp`;
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, target);
    }
    await writeFile(receiptPath, serialize({ ...report, status: "applied" }));
    report.receiptPath = path.relative(root, receiptPath).replaceAll("\\", "/");
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), batch = args.find(arg => !arg.startsWith("--"));
  assert.ok(batch && args.every(arg => arg === batch || arg === "--apply" || arg === "--check"), "Usage: apply-word-net-batch.mjs <authored-batch.json> [--apply|--check]");
  assert.ok(!(args.includes("--apply") && args.includes("--check")), "Choose --apply or --check");
  const report = await applyWordNetBatch(path.resolve(batch), { apply: args.includes("--apply") });
  console.log(JSON.stringify({ apply: report.apply, changes: report.changes.length, courses: report.courses,
    receiptPath: report.receiptPath }, null, 2));
}
