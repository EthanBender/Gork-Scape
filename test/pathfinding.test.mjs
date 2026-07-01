// test/pathfinding.test.mjs — A* grid pathfinding (src/world/map.js findPath).
// findPath drives ALL movement (player click-to-move + every mob), so it's about
// as load-bearing as code gets. Pure function of a {W,H,collision} world, so it
// tests deterministically on tiny hand-built grids.
import { test, assert, eq } from './run.mjs';
import { findPath } from '../src/world/map.js';

// build a world from ASCII rows: '.' walkable, '#' wall
function grid(rows) {
  const H = rows.length, W = rows[0].length;
  const collision = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] === '#') collision[y * W + x] = 1;
  return { W, H, collision };
}
const open = (W, H) => ({ W, H, collision: new Uint8Array(W * H) });

// every step is a king move onto a walkable tile, with no diagonal corner-cutting
function assertValidPath(world, sx, sy, path) {
  let px = sx, py = sy;
  for (const [x, y] of path) {
    const dx = Math.abs(x - px), dy = Math.abs(y - py);
    assert(dx <= 1 && dy <= 1 && (dx || dy), `step ${px},${py} -> ${x},${y} is a single king move`);
    assert(world.collision[y * world.W + x] === 0, `tile ${x},${y} is walkable`);
    if (dx && dy) assert(world.collision[py * world.W + x] === 0 && world.collision[y * world.W + px] === 0, `no corner-cut at ${x},${y}`);
    px = x; py = y;
  }
}

test('start === goal yields an empty path', () => {
  eq(findPath(open(5, 5), 2, 2, 2, 2), []);
});

test('open-grid path is diagonal-optimal (chebyshev length)', () => {
  const w = open(12, 12);
  const path = findPath(w, 0, 0, 5, 3);
  assertValidPath(w, 0, 0, path);
  eq(path[path.length - 1], [5, 3], 'reaches the goal');
  eq(path.length, 5, 'max(dx,dy) steps using diagonals, not dx+dy');
});

test('routes around a wall through the gap', () => {
  // vertical wall column x=2 with a gap at y=0
  const w = grid([
    '.....',
    '..#..',
    '..#..',
    '..#..',
    '.....',
  ]);
  const path = findPath(w, 0, 2, 4, 2);
  assertValidPath(w, 0, 2, path);
  eq(path[path.length - 1], [4, 2], 'gets to the far side');
  assert(!path.some(([x, y]) => x === 2 && (y === 1 || y === 2 || y === 3)), 'never steps into the wall');
});

test('does not cut through a diagonal wall corner', () => {
  // (1,0) and (0,1) are walls; reaching (1,1) from (0,0) would require slicing
  // between them — which corner-cut prevention forbids, so it is unreachable.
  const w = grid([
    '.#',
    '#.',
  ]);
  eq(findPath(w, 0, 0, 1, 1), [], 'no illegal diagonal through the corner');
});

test('diagonal is allowed when a shared orthogonal is open', () => {
  const w = grid([
    '..',
    '#.',
  ]);
  const path = findPath(w, 0, 0, 1, 1); // (1,0) open, so the diagonal is legal
  assertValidPath(w, 0, 0, path);
  eq(path[path.length - 1], [1, 1]);
});

test('adjacent goal: stop orthogonally next to a blocked target', () => {
  const w = grid([
    '.....',
    '..#..',
    '.....',
  ]);
  const path = findPath(w, 0, 1, 2, 1, true); // (2,1) is a wall; adjacent=true
  assertValidPath(w, 0, 1, path);
  const [lx, ly] = path[path.length - 1];
  eq(Math.abs(lx - 2) + Math.abs(ly - 1), 1, 'ends manhattan-adjacent to the target');
});

test('unreachable target returns a best-effort partial toward it (never illegal)', () => {
  // target (3,1) fully walled off from the start
  const w = grid([
    '.......',
    '..###..',
    '..#.#..',
    '..###..',
    '.......',
  ]);
  const path = findPath(w, 0, 2, 3, 2);
  assertValidPath(w, 0, 2, path);           // whatever it returns must be legal
  assert(!(path.length && path[path.length - 1][0] === 3 && path[path.length - 1][1] === 2), 'cannot actually reach the walled target');
});

test('handles a large open grid without exploding (directed search)', () => {
  const w = open(120, 120);
  const path = findPath(w, 0, 0, 119, 119);
  assertValidPath(w, 0, 0, path);
  eq(path[path.length - 1], [119, 119], 'A* reaches a far corner in one call');
  eq(path.length, 119, 'pure diagonal, chebyshev-optimal');
});