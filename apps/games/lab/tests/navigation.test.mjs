import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { advanceRoute, buildNavigation, directionFor, planRoute, project, unproject } from '../scenary/navigation.mjs';

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
const fixture = (columns = 9, rows = 9, blocked = []) => buildNavigation({
  terrain: { columns, rows, cell_size: 1 }, blocked_cells: blocked,
});
const at = (nav, column, row) => nav.cellToWorld(column, row);

test('projection round-trips and heading uses screen velocity in all eight directions', () => {
  for (const p of [{ x: -4, z: 5 }, { x: 0.31, z: -2.75 }, { x: 6, z: 6 }]) {
    const restored = unproject(project(p)); close(restored.x, p.x); close(restored.z, p.z);
  }
  for (const [screen, facing] of [[{ x: 0, y: -1 }, 'N'], [{ x: 1, y: -1 }, 'NE'],
    [{ x: 1, y: 0 }, 'E'], [{ x: 1, y: 1 }, 'SE'], [{ x: 0, y: 1 }, 'S'],
    [{ x: -1, y: 1 }, 'SW'], [{ x: -1, y: 0 }, 'W'], [{ x: -1, y: -1 }, 'NW']]) {
    const velocity = unproject(screen); assert.equal(directionFor(velocity.x, velocity.z), facing);
  }
  assert.equal(directionFor(1, 0), 'SE');
});

test('open ground preserves exact clicks and chooses speed once from route length', () => {
  const nav = fixture();
  const target = { x: 1.21, z: 0.14 };
  const route = planRoute(nav, { x: 0, z: 0 }, target);
  assert.deepEqual(route.target, target); assert.equal(route.adjusted, false);
  assert.equal(route.waypoints.length, 1); assert.equal(route.action, 'walk');
  assert.equal(planRoute(nav, { x: 0, z: 0 }, { x: 2.6, z: 0 }).action, 'run');
  assert.equal(planRoute(nav, target, target).action, 'idle');
});

test('routes detour around obstacles and string pulling never cuts their corners', () => {
  const nav = fixture(9, 9, [[4, 2], [4, 3], [4, 4], [4, 5], [4, 6]]);
  const from = at(nav, 2, 4); const target = at(nav, 6, 4);
  const route = planRoute(nav, from, target);
  assert.ok(route.length > 4); assert.ok(route.waypoints.length > 1);
  assert.deepEqual(route.target, target);
  let previous = route.start;
  for (const next of route.waypoints) { assert.ok(nav.segmentWalkable(previous, next)); previous = next; }
  const corner = fixture(3, 3, [[1, 0], [0, 1]]);
  assert.equal(corner.segmentWalkable(at(corner, 0, 0), at(corner, 1, 1)), false);
  const trapped = planRoute(corner, at(corner, 0, 0), at(corner, 2, 2));
  assert.equal(trapped.action, 'idle'); assert.equal(trapped.adjusted, true);
});

test('unreachable and outside destinations resolve to safe reachable cells', () => {
  const nav = fixture(7, 7, Array.from({ length: 7 }, (_, row) => [3, row]));
  const route = planRoute(nav, at(nav, 1, 3), at(nav, 5, 3));
  assert.deepEqual(route.target, at(nav, 2, 3)); assert.equal(route.adjusted, true);
  assert.ok(route.waypoints.every((p) => nav.isWalkable(p)));
  const outside = planRoute(nav, at(nav, 1, 3), { x: -200, z: 300 });
  assert.equal(nav.isWalkable(outside.target), true); assert.equal(outside.adjusted, true);
  const allBlocked = fixture(1, 1, [[0, 0]]);
  assert.equal(allBlocked.nearestWalkable({ x: 0, z: 0 }), null);
  assert.equal(planRoute(allBlocked, { x: 0, z: 0 }, { x: 1, z: 1 }).action, 'idle');
});

test('near-obstacle clicks snap to cell center including same-cell movement', () => {
  const nav = fixture(7, 7, [[3, 3]]);
  const from = { x: -1.2, z: 0.1 };
  const route = planRoute(nav, from, { x: -0.9, z: 0.1 });
  assert.deepEqual(route.target, at(nav, 2, 3)); assert.equal(route.adjusted, true);
  assert.equal(route.waypoints.length, 1);
});

test('collision profiles apply shape offsets, visual scaling and clearance', () => {
  const catalog = { objects: {
    tree: { collision_profile: 'trunk', collision_scale_mode: 'with-visual' },
    marker: { collision_profile: 'base', collision_scale_mode: 'fixed' },
  }, collision_profiles: {
    trunk: { shapes: [{ type: 'cylinder', radius: 0.25, offset: [0.5, 0, 0] }] },
    base: { shapes: [{ type: 'box', size: [0.4, 2, 0.4], offset: [0, 0, 0] }] },
  } };
  const nav = buildNavigation({ terrain: { columns: 21, rows: 21, cell_size: 0.2 },
    placements: [{ object: 'tree', position: [-1, 0], scale: 2, collision_enabled: true },
      { object: 'marker', position: [1.6, 0], scale: 10, collision_enabled: true }],
    boundaries: [{ position: [0, 0, -2], size: [4, 1, 0.1] }],
  }, catalog);
  assert.equal(nav.isWalkable({ x: 0.6, z: 0 }), false); // scaled center=0, radius=.8
  assert.equal(nav.isWalkable({ x: -1, z: 0 }), true);
  assert.equal(nav.isWalkable({ x: 1.2, z: 0 }), false); // fixed box plus .3 clearance
  assert.equal(nav.isWalkable({ x: 1.6, z: 1 }), true); // scale10 must not inflate fixed box
  assert.equal(nav.isWalkable({ x: 0, z: -1.8 }), false);
});

test('movement normalizes diagonals, consumes segments without overshoot and idles', () => {
  const straight = { position: { x: 0, z: 0 }, waypoints: [{ x: 10, z: 0 }], action: 'walk' };
  const diagonal = { position: { x: 0, z: 0 }, waypoints: [{ x: 10, z: 10 }], action: 'walk' };
  advanceRoute(straight, 1); advanceRoute(diagonal, 1);
  close(straight.position.x, 1.55); close(Math.hypot(diagonal.position.x, diagonal.position.z), 1.55);
  const state = { position: { x: 0, z: 0 }, waypoints: [{ x: 1, z: 0 }, { x: 1, z: 1 }], action: 'run' };
  advanceRoute(state, 0.5); close(state.position.x, 1); close(state.position.z, 0.8);
  assert.equal(state.action, 'run'); // short remainder never switches animation mode
  advanceRoute(state, 1);
  assert.deepEqual(state.position, { x: 1, z: 1 }); assert.equal(state.action, 'idle');
  assert.equal(state.distanceRemaining, 0); assert.deepEqual(state.waypoints, []);
});

test('retargeting replaces the old destination without retaining its waypoints', () => {
  const nav = fixture(15, 15);
  const state = { position: { x: 0, z: 0 }, ...planRoute(nav, { x: 0, z: 0 }, { x: 5, z: 0 }) };
  advanceRoute(state, 0.25);
  const reroute = planRoute(nav, state.position, { x: -1, z: 0 });
  Object.assign(state, reroute, { distanceRemaining: reroute.length });
  assert.equal(state.action, 'walk');
  advanceRoute(state, 10);
  assert.deepEqual(state.position, { x: -1, z: 0 }); assert.equal(state.action, 'idle');
});

test('canonical Memory Grove derives a 36x36 grid and repairs its blocked spawn', async () => {
  const world = JSON.parse(await readFile(new URL('../../../launcher/static/assets/scenery/metadata/world.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(await readFile(new URL('../../../launcher/static/assets/scenery/metadata/catalog.json', import.meta.url), 'utf8'));
  const nav = buildNavigation(world, catalog);
  assert.equal(nav.columns, 36); assert.equal(nav.rows, 36);
  assert.equal(nav.isWalkable([1.9, 0, 5.4]), false);
  const spawn = nav.nearestWalkable([1.9, 0, 5.4]);
  assert.deepEqual(nav.worldToCell(spawn), { column: 23, row: 33 });
  close(spawn.x, 1.8333315); close(spawn.z, 5.1666615);
  const route = planRoute(nav, spawn, { x: 0, z: 0 });
  assert.ok(route.waypoints.length > 0);
  let previous = route.start;
  for (const next of route.waypoints) { assert.ok(nav.segmentWalkable(previous, next)); previous = next; }
});
