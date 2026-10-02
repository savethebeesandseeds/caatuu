import {walkingMetrics} from './locomotion.mjs';

export const WALKING_MOTION_BASE = '/games/lab/assets/macaw/walk/';
const FACINGS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const IMAGE_PATH = /^images\/[a-z]+-(?:walk-\d{2}|idle-v[1-9]\d*)\.png$/;

export function parseWalkingMotion(manifest) {
  if (manifest?.format_version !== 1 || manifest.preview_only !== true
    || manifest.canvas?.join(',') !== '512,512' || manifest.baseline_y !== 480
    || !Number.isFinite(manifest.fps) || manifest.fps <= 0 || manifest.fps > 24
    || !Array.isArray(manifest.frames) || manifest.frames.length !== 45 || !Array.isArray(manifest.directions)
    || manifest.standing_complete !== true) {
    throw new Error('Invalid walking source.');
  }
  const profile = manifest.locomotion?.walk;
  walkingMetrics(profile);
  if (profile.canvas_pixels !== 512 || profile.frames_per_cycle !== 8 || profile.steps_per_cycle !== 2
    || profile.fps !== manifest.fps) throw new Error('Walking calibration disagrees with the source frames.');
  const frames = new Map();
  for (const frame of manifest.frames) {
    const action = frame.action ?? 'walk';
    const idle = action === 'idle';
    const identity = idle ? `${frame.direction}-idle` : `${frame.direction}-walk-${String(frame.slot).padStart(2, '0')}`;
    if (!FACINGS.includes(frame.direction) || !['walk', 'idle'].includes(action)
      || !Number.isInteger(frame.slot) || (idle ? frame.slot !== 0 : frame.slot < 1 || frame.slot > 16)
      || frame.id !== identity || !IMAGE_PATH.test(frame.file)
      || (idle ? !frame.file.startsWith(`images/${frame.direction.toLowerCase()}-idle-v`) : frame.file !== `images/${frame.direction.toLowerCase()}-walk-${String(frame.slot).padStart(2, '0')}.png`)
      || !/^[a-f0-9]{64}$/.test(frame.sha256) || frames.has(frame.id)) {
      throw new Error('Invalid walking draft frame.');
    }
    frames.set(frame.id, frame);
  }
  const directions = new Map(), cycles = new Map(), standing = new Map();
  for (const mapping of manifest.directions) {
    if (!FACINGS.includes(mapping.id) || !FACINGS.includes(mapping.source)
      || typeof mapping.mirror !== 'boolean' || directions.has(mapping.id)) {
      throw new Error('Invalid walking draft direction.');
    }
    const cycle = manifest.frames.filter(frame => frame.direction === mapping.source && (frame.action ?? 'walk') === 'walk').sort((a, b) => a.slot - b.slot);
    if (cycle.length !== profile.frames_per_cycle || cycle.some((frame, index) => frame.slot !== index + 1)) {
      throw new Error(`Incomplete walking draft: ${mapping.id}.`);
    }
    directions.set(mapping.id, mapping);
    cycles.set(mapping.id, cycle);
    const idle = frames.get(`${mapping.source}-idle`);
    if (manifest.standing_complete === true && !idle) throw new Error(`Missing standing pose: ${mapping.id}.`);
    if (idle) standing.set(mapping.id, idle);
  }
  if (directions.size !== FACINGS.length
    || manifest.frames.some(frame => !manifest.directions.some(mapping => mapping.source === frame.direction))) {
    throw new Error('Walking draft must cover all eight directions.');
  }
  const sources = {S:'S',SW:'SW',E:'E',NE:'NE',N:'N',W:'E',SE:'SW',NW:'NE'};
  for (const [id, mapping] of directions) {
    if (mapping.source !== sources[id] || mapping.mirror !== (id !== sources[id])) throw new Error('Incorrect walking source direction mapping.');
  }
  return {frames, directions, cycles, standing, fps: manifest.fps, profile};
}

export function walkingMotionURL(frame) {
  if (!IMAGE_PATH.test(frame.file) || !/^[a-f0-9]{64}$/.test(frame.sha256)) {
    throw new Error('Invalid walking draft image.');
  }
  return `${WALKING_MOTION_BASE}${frame.file}?v=${frame.sha256}`;
}

export function walkingMotionPose(draft, direction, action, completedCycles) {
  const cycle = draft.cycles.get(direction), mapping = draft.directions.get(direction);
  if (!cycle || !Number.isFinite(completedCycles) || completedCycles < 0) throw new Error('Invalid walking distance playback.');
  if (action === 'idle' && draft.standing.has(direction)) return {frame: draft.standing.get(direction), mapping, slot: 0};
  const index = action === 'idle' ? 0 : Math.floor(completedCycles * cycle.length) % cycle.length;
  return {frame: cycle[index], mapping, slot: index + 1};
}
