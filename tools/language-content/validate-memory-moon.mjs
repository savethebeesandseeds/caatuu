#!/usr/bin/env node
import { loadMemoryMoonCatalogs, memoryMoonContentSummary } from './lib/memory-moon-content.mjs';

const args = process.argv.slice(2);
let courseId = null;
if (args.length && args[0] !== '--all') {
  if (args[0] !== '--course' || args.length !== 2 || !args[1]) throw new Error('Usage: validate-memory-moon.mjs [--all | --course <id>]');
  courseId = args[1];
} else if (args.length > 1) throw new Error('Usage: validate-memory-moon.mjs [--all | --course <id>]');
try {
  const catalogs = await loadMemoryMoonCatalogs({ courseId });
  console.log(JSON.stringify({ schemaVersion: 'caatuu-memory-moon-inventory-v1', courses: catalogs.map(({ document, path }) =>
    ({ ...memoryMoonContentSummary(document), path })) }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
