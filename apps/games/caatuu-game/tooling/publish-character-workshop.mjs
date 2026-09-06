import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tooling = path.dirname(fileURLToPath(import.meta.url));
export const sourceRoot = path.resolve(tooling, '../character-workshop');
const outputRoot = path.resolve(tooling, '../../../../artifacts/games/lab/motion');
const viewFiles = ['index.html','review.js','review.css','animation-clock.mjs'];
const expected = new Map(['S','N','E','NE','SE'].flatMap(direction => [
  [`${direction}-idle`, {direction,action:'idle',phase:0}],
  ...[1,2,3,4].map(phase => [`${direction}-walk-0${phase}`, {direction,action:'walk',phase}]),
  ...[1,2,3,4,5,6].map(phase => [`${direction}-run-0${phase}`, {direction,action:'run',phase}]),
]));
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export async function validateWorkshop(root = sourceRoot) {
  const manifestBytes = await fs.readFile(path.join(root,'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.frames?.length !== 55 || manifest.expected_frames !== 55 || manifest.complete !== true ||
      new Set(manifest.frames.map(f=>f?.id)).size !== 55 || [...expected.keys()].some(id=>!manifest.frames.some(f=>f?.id===id))) {
    throw Error('Expected the complete 55-frame set: 25 walking/standing frames and 30 running frames across five authored directions');
  }
  const files = new Map([['manifest.json',manifestBytes]]);
  const seen = new Set();
  for (const frame of manifest.frames) {
    const metadata = expected.get(frame.id);
    if (frame.direction !== metadata.direction || frame.action !== metadata.action || frame.phase !== metadata.phase) {
      throw Error(`Frame metadata mismatch: ${frame.id}`);
    }
    const imagePath = new RegExp(`^images/${frame.id.toLowerCase()}-sheet-v[12]\\.png$`);
    if (typeof frame.file !== 'string' || !imagePath.test(frame.file) || seen.has(frame.file)) throw Error(`Unsafe or duplicate image path: ${frame.id}`);
    seen.add(frame.file);
    const bytes = await fs.readFile(path.join(root,frame.file));
    if (digest(bytes) !== frame.sha256) throw Error(`Frame hash mismatch: ${frame.id}`);
    if (!bytes.subarray(0,8).equals(pngSignature) || bytes.readUInt32BE(16)!==512 || bytes.readUInt32BE(20)!==512 || bytes[25]!==6 ||
        frame.width!==512 || frame.height!==512 || !frame.alpha?.has_alpha_channel || !(frame.alpha.transparent_fraction>0 && frame.alpha.transparent_fraction<1)) {
      throw Error(`Invalid transparent canvas: ${frame.id}`);
    }
    files.set(frame.file, bytes);
  }
  for (const file of viewFiles) files.set(file,await fs.readFile(path.join(root,file)));
  if (!files.get('index.html').toString().includes('noindex,nofollow')) throw Error('Workshop must remain a local review');
  return {manifest,files};
}

export async function publishWorkshop({source = sourceRoot, destination = outputRoot} = {}) {
  // Validate the entire curated input before writing any served output.
  const {manifest,files} = await validateWorkshop(source);
  await fs.mkdir(path.join(destination,'images'),{recursive:true});
  const order = [...files.keys()].filter(file=>file.startsWith('images/'))
    .concat(['animation-clock.mjs','review.css','review.js','index.html','manifest.json']);
  // Advertise the new hashes only after their image bytes and UI are available.
  for (const file of order) await fs.writeFile(path.join(destination,file),files.get(file));
  return {frames:manifest.frames.length,walking_directions:8,running_directions:8,
    url:'http://127.0.0.1:8765/games/lab/motion'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg=>arg!=='--check')) throw Error('Supported option: --check');
  console.log(JSON.stringify(process.argv.includes('--check')
    ? {frames:(await validateWorkshop()).manifest.frames.length,valid:true}
    : await publishWorkshop()));
}
