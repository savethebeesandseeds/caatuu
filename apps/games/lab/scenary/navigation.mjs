// Pure navigation for the scenery lab. Geometry follows world_scenery.gd and
// click_navigation.gd; rendering and frame-pause policy belong to the caller.
const EPSILON = 1e-9;
const SHAPE_CLEARANCE = 0.3;
const ACTOR_CLEARANCE = 0.28;
const SQRT_HALF = Math.SQRT1_2;
const FACINGS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

function point(value) {
  const result = Array.isArray(value)
    ? { x: value[0], z: value[value.length === 3 ? 2 : 1] }
    : { x: value?.x, z: value?.z };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.z)) {
    throw new TypeError('A world point needs finite x and z coordinates.');
  }
  return result;
}

const distance = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function project(value) {
  const { x, z } = point(value);
  return { x: (x - z) * SQRT_HALF, y: (x + z) * SQRT_HALF * 0.5 };
}

export function unproject({ x, y }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Invalid screen point.');
  return { x: (x + 2 * y) * SQRT_HALF, z: (2 * y - x) * SQRT_HALF };
}

// Arguments are world velocity, while the result is a screen-facing sprite ID.
export function directionFor(dx, dz) {
  if (Math.hypot(dx, dz) <= EPSILON) return 'S';
  const screen = project({ x: dx, z: dz });
  return FACINGS[(Math.round(Math.atan2(screen.y, screen.x) / (Math.PI / 4)) + 8) % 8];
}

function collisionShapes(world, catalog) {
  const shapes = (world.boundaries ?? []).map((boundary) => ({
    type: 'box', center: point(boundary.position),
    halfX: boundary.size[0] * 0.5 + SHAPE_CLEARANCE,
    halfZ: boundary.size[2] * 0.5 + SHAPE_CLEARANCE,
  }));
  for (const placement of world.placements ?? []) {
    if (!placement.collision_enabled) continue;
    const definition = catalog.objects?.[placement.object];
    const profile = catalog.collision_profiles?.[definition?.collision_profile];
    if (!definition || !profile) throw new Error(`Missing collision profile for ${placement.object}.`);
    const scale = definition.collision_scale_mode === 'with-visual' ? placement.scale : 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid collision scale.');
    const position = point(placement.position);
    for (const descriptor of profile.shapes) {
      const offset = point(descriptor.offset ?? [0, 0, 0]);
      const center = { x: position.x + offset.x * scale, z: position.z + offset.z * scale };
      if (descriptor.type === 'cylinder') {
        shapes.push({ type: 'cylinder', center, radius: descriptor.radius * scale + SHAPE_CLEARANCE });
      } else if (descriptor.type === 'box') {
        shapes.push({ type: 'box', center,
          halfX: descriptor.size[0] * scale * 0.5 + SHAPE_CLEARANCE,
          halfZ: descriptor.size[2] * scale * 0.5 + SHAPE_CLEARANCE });
      } else {
        throw new Error(`Unsupported collision shape: ${descriptor.type}.`);
      }
    }
  }
  return shapes;
}

/** Build the catalog-derived grid; blocked is a row-major Uint8Array. */
export function buildNavigation(world, catalog = {}) {
  const terrain = world.terrain ?? world;
  const columns = world.navigation_columns ?? terrain.columns;
  const rows = world.navigation_rows ?? terrain.rows;
  const cellSize = world.navigation_cell_size ?? terrain.cell_size;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(rows) || rows <= 0
    || !Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Invalid navigation grid.');
  const origin = point(world.navigation_origin ?? [-columns * cellSize / 2, -rows * cellSize / 2]);
  const blocked = new Uint8Array(columns * rows);
  const shapes = collisionShapes(world, catalog);
  const cellToWorld = (column, row) => ({
    x: origin.x + (column + 0.5) * cellSize, z: origin.z + (row + 0.5) * cellSize,
  });
  const worldToCell = (value) => {
    const p = point(value);
    return { column: Math.floor((p.x - origin.x) / cellSize), row: Math.floor((p.z - origin.z) / cellSize) };
  };
  const inBounds = (column, row) => column >= 0 && row >= 0 && column < columns && row < rows;
  const isCellWalkable = (column, row) => inBounds(column, row) && !blocked[row * columns + column];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const p = cellToWorld(column, row);
      if (shapes.some((shape) => shape.type === 'cylinder'
        ? distance(p, shape.center) <= shape.radius
        : Math.abs(p.x - shape.center.x) <= shape.halfX && Math.abs(p.z - shape.center.z) <= shape.halfZ)) {
        blocked[row * columns + column] = 1;
      }
    }
  }
  for (const cell of world.navigation_blocked_cells ?? world.blocked_cells ?? terrain.blocked_cells ?? []) {
    const [column, row] = cell;
    if (!Number.isInteger(column) || !Number.isInteger(row) || !inBounds(column, row)) {
      throw new Error('Blocked cell is outside the navigation grid.');
    }
    blocked[row * columns + column] = 1;
  }
  const blockedCells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (blocked[row * columns + column]) blockedCells.push([column, row]);
    }
  }
  const nav = { columns, rows, cellSize, origin, blocked, blockedCells, clearance: SHAPE_CLEARANCE,
    cellToWorld, worldToCell, isCellWalkable,
    isWalkable(value) { const cell = worldToCell(value); return isCellWalkable(cell.column, cell.row); },
    nearestWalkable(value) {
      const p = point(value);
      if (this.isWalkable(p)) return p;
      const cell = nearestCell(this, worldToCell(p));
      return cell ? cellToWorld(cell.column, cell.row) : null;
    },
    segmentWalkable(from, to) { return segmentWalkable(this, point(from), point(to)); },
  };
  return nav;
}

function nearestCell(nav, seed) {
  const column = clamp(seed.column, 0, nav.columns - 1);
  const row = clamp(seed.row, 0, nav.rows - 1);
  for (let radius = 0; radius < Math.max(nav.columns, nav.rows); radius += 1) {
    let best = null;
    let bestDistance = Infinity;
    for (let y = Math.max(0, row - radius); y <= Math.min(nav.rows - 1, row + radius); y += 1) {
      for (let x = Math.max(0, column - radius); x <= Math.min(nav.columns - 1, column + radius); x += 1) {
        if (Math.max(Math.abs(x - column), Math.abs(y - row)) !== radius || !nav.isCellWalkable(x, y)) continue;
        const squared = (x - column) ** 2 + (y - row) ** 2;
        if (squared < bestDistance) { bestDistance = squared; best = { column: x, row: y }; }
      }
    }
    if (best) return best;
  }
  return null;
}

function segmentWalkable(nav, from, to) {
  if (!nav.isWalkable(from) || !nav.isWalkable(to)) return false;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  for (const [column, row] of nav.blockedCells) {
    const center = nav.cellToWorld(column, row);
    const t = lengthSquared > EPSILON ? clamp(((center.x - from.x) * dx + (center.z - from.z) * dz) / lengthSquared, 0, 1) : 0;
    if ((from.x + dx * t - center.x) ** 2 + (from.z + dz * t - center.z) ** 2 <= ACTOR_CLEARANCE ** 2 + EPSILON) return false;
  }
  const start = nav.worldToCell(from);
  const end = nav.worldToCell(to);
  let { column, row } = start;
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const tDeltaX = stepX ? nav.cellSize / Math.abs(dx) : Infinity;
  const tDeltaZ = stepZ ? nav.cellSize / Math.abs(dz) : Infinity;
  let tX = stepX ? (nav.origin.x + (column + (stepX > 0 ? 1 : 0)) * nav.cellSize - from.x) / dx : Infinity;
  let tZ = stepZ ? (nav.origin.z + (row + (stepZ > 0 ? 1 : 0)) * nav.cellSize - from.z) / dz : Infinity;
  while (column !== end.column || row !== end.row) {
    if (Math.abs(tX - tZ) <= EPSILON) {
      if (!nav.isCellWalkable(column + stepX, row) || !nav.isCellWalkable(column, row + stepZ)) return false;
      column += stepX; row += stepZ; tX += tDeltaX; tZ += tDeltaZ;
    } else if (tX < tZ) { column += stepX; tX += tDeltaX;
    } else { row += stepZ; tZ += tDeltaZ; }
    if (!nav.isCellWalkable(column, row)) return false;
  }
  return true;
}

const octile = (a, b) => {
  const x = Math.abs(a.column - b.column);
  const y = Math.abs(a.row - b.row);
  return Math.max(x, y) + (Math.SQRT2 - 1) * Math.min(x, y);
};

/** Replace a previous plan with this result. Waypoints exclude its resolved start. */
export function planRoute(nav, fromValue, targetValue) {
  const from = point(fromValue);
  const requested = point(targetValue);
  const startCell = nearestCell(nav, nav.worldToCell(from));
  const goalCell = nearestCell(nav, nav.worldToCell(requested));
  const empty = { start: from, target: from, waypoints: [], length: 0, action: 'idle', adjusted: true };
  if (!startCell || !goalCell) return empty;
  const start = nav.isWalkable(from) && nav.segmentWalkable(from, from)
    ? from : nav.cellToWorld(startCell.column, startCell.row);
  const index = (cell) => cell.row * nav.columns + cell.column;
  const cell = (id) => ({ column: id % nav.columns, row: Math.floor(id / nav.columns) });
  const first = index(startCell);
  const goal = index(goalCell);
  const scores = new Float64Array(nav.blocked.length).fill(Infinity);
  const parents = new Int32Array(nav.blocked.length).fill(-1);
  const open = new Set([first]);
  const closed = new Set();
  scores[first] = 0;
  let closest = first;
  let closestDistance = distance(nav.cellToWorld(startCell.column, startCell.row), requested);
  while (open.size) {
    let current = -1;
    let bestScore = Infinity;
    for (const candidate of open) {
      const score = scores[candidate] + octile(cell(candidate), goalCell);
      if (score < bestScore - EPSILON || (Math.abs(score - bestScore) <= EPSILON && candidate < current)) {
        current = candidate; bestScore = score;
      }
    }
    open.delete(current);
    closed.add(current);
    const currentCell = cell(current);
    const remaining = distance(nav.cellToWorld(currentCell.column, currentCell.row), requested);
    if (remaining < closestDistance - EPSILON || (Math.abs(remaining - closestDistance) <= EPSILON && current < closest)) {
      closest = current; closestDistance = remaining;
    }
    if (current === goal) { closest = current; break; }
    for (const [dx, dz] of STEPS) {
      const next = { column: currentCell.column + dx, row: currentCell.row + dz };
      if (!nav.isCellWalkable(next.column, next.row)) continue;
      if (dx && dz && (!nav.isCellWalkable(currentCell.column + dx, currentCell.row)
        || !nav.isCellWalkable(currentCell.column, currentCell.row + dz))) continue;
      const nextId = index(next);
      if (closed.has(nextId)) continue;
      const score = scores[current] + (dx && dz ? Math.SQRT2 : 1);
      if (score < scores[nextId]) { scores[nextId] = score; parents[nextId] = current; open.add(nextId); }
    }
  }
  const routeCells = [];
  for (let current = closest; current !== -1; current = parents[current]) routeCells.push(cell(current));
  routeCells.reverse();
  const raw = routeCells.map((entry) => nav.cellToWorld(entry.column, entry.row));
  raw[0] = start;
  const reached = routeCells.at(-1);
  const requestedCell = nav.worldToCell(requested);
  const openNeighborhood = STEPS.concat([[0, 0]]).every(([dx, dz]) => nav.isCellWalkable(reached.column + dx, reached.row + dz));
  const target = closest === goal && requestedCell.column === reached.column && requestedCell.row === reached.row && openNeighborhood
    ? requested : nav.cellToWorld(reached.column, reached.row);
  if (distance(raw.at(-1), target) > EPSILON) raw.push(target);
  else raw[raw.length - 1] = target;
  const pulled = [start];
  let anchor = 0;
  while (anchor < raw.length - 1) {
    let next = anchor + 1;
    for (let candidate = raw.length - 1; candidate > anchor; candidate -= 1) {
      if (nav.segmentWalkable(raw[anchor], raw[candidate])) { next = candidate; break; }
    }
    if (distance(pulled.at(-1), raw[next]) > EPSILON) pulled.push(raw[next]);
    anchor = next;
  }
  const length = pulled.slice(1).reduce((sum, p, i) => sum + distance(pulled[i], p), 0);
  return { start, target, waypoints: pulled.slice(1), length,
    action: length <= EPSILON ? 'idle' : length < 2.6 ? 'walk' : 'run',
    adjusted: distance(target, requested) > EPSILON };
}

/** Mutates caller-owned position/waypoints/action/direction/distanceRemaining. */
export function advanceRoute(state, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative.');
  state.position = point(state.position);
  state.waypoints ??= [];
  let budget = (state.action === 'run' ? 3.6 : state.action === 'walk' ? 1.55 : 0) * dt;
  while (state.waypoints.length) {
    const next = point(state.waypoints[0]);
    const remaining = distance(state.position, next);
    if (remaining <= EPSILON) { state.position = next; state.waypoints.shift(); continue; }
    if (budget <= 0) break;
    const dx = next.x - state.position.x;
    const dz = next.z - state.position.z;
    state.direction = directionFor(dx, dz);
    if (budget >= remaining) {
      state.position = next; budget -= remaining; state.waypoints.shift();
    } else {
      const fraction = budget / remaining;
      state.position = { x: state.position.x + dx * fraction, z: state.position.z + dz * fraction };
      budget = 0;
    }
  }
  state.distanceRemaining = state.waypoints.reduce((sum, p, i) => sum + distance(i ? state.waypoints[i - 1] : state.position, p), 0);
  if (!state.waypoints.length) { state.action = 'idle'; state.distanceRemaining = 0; }
  return state;
}
