import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ZONES } from '../../src/config.js';
import { zoneOf } from '../../src/zones.js';
import { pageFromHash, PAGES } from '../../src/nav.js';

const posted = [];
globalThis.self = { postMessage: (m) => posted.push(m) };
await import('../../src/slots/worker.js');

/* a flat, upward-facing panel of `n` x `n` quads, `size` metres a side, at height y */
function panel(n, size, y = 1.0){
  const P = [], N = [], step = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++){
    const x0 = -size / 2 + i * step, z0 = -size / 2 + j * step, x1 = x0 + step, z1 = z0 + step;
    P.push(x0,y,z0, x0,y,z1, x1,y,z0,  x1,y,z0, x0,y,z1, x1,y,z1);
    for (let k = 0; k < 6; k++) N.push(0, 1, 0);
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), triPart: new Uint8Array(P.length / 9) };
}

function runWorker(data){
  posted.length = 0;
  self.onmessage({ data });
  return posted.find(m => m.type === 'done' || m.type === 'error');
}

test('worker prices every slot of a panel to the target total, in whole steps above the floor', () => {
  const geo = panel(20, 1.2);
  const done = runWorker({ ...geo, parts: ['roof'], campaigns: [] });
  assert.equal(done.type, 'done');
  const prices = [...done.price];
  assert.ok(prices.length >= 50, `${prices.length} slots`);
  assert.ok(prices.every(p => p >= CONFIG.MIN_PRICE && p % CONFIG.ROUND_TO === 0));
  const total = prices.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - CONFIG.TARGET_AUD) <= prices.length * CONFIG.ROUND_TO / 2, `total ${total}`);
  assert.ok(done.zone.every(z => z === 'roof'));
  assert.ok([...done.triCell].every(c => c >= 0), 'every triangle belongs to a slot');
});

test('worker marks slots near a campaign anchor as sold to it, and only those', () => {
  const geo = panel(20, 1.2);
  const done = runWorker({ ...geo, parts: ['roof'], campaigns: [{ id: 'a', anchor: [0, 1, 0], radius: 0.2, zone: 'roof' }] });
  const sold = [...done.owner].map((o, i) => [o, i]).filter(([o]) => o === 0);
  assert.ok(sold.length > 0 && sold.length < done.owner.length);
  for (const [, i] of sold) assert.ok(Math.hypot(done.centroid[i*3], done.centroid[i*3+2]) <= 0.2 + CONFIG.CELL_SIZE);
});

test('worker reports bad input as an error message instead of throwing', () => {
  const failed = runWorker({ positions: null, normals: null, triPart: null, parts: [] });
  assert.equal(failed.type, 'error');
  assert.ok(failed.message);
});

test('zoneOf maps whole panels by name and splits the shell by position and normal', () => {
  assert.equal(zoneOf('wing', [0, 0, 0], [0, 1, 0]), 'wing');
  assert.equal(zoneOf('front_bumper', [0, 0, 0], [1, 0, 0]), 'nose');
  assert.equal(zoneOf('body', [3, 0.5, 0], [1, 0, 0]), 'nose');
  assert.equal(zoneOf('body', [-3, 0.5, 0], [-1, 0, 0]), 'tail');
  const right = zoneOf('body', [0, 0.6, Math.sign(CONFIG.DRIVER_SIDE)], [0, 0, Math.sign(CONFIG.DRIVER_SIDE)]);
  const left = zoneOf('body', [0, 0.6, -Math.sign(CONFIG.DRIVER_SIDE)], [0, 0, -Math.sign(CONFIG.DRIVER_SIDE)]);
  assert.ok(right.endsWith('_r') && left.endsWith('_l'), `${right} ${left}`);
  for (const z of [right, left, 'nose', 'tail']) assert.ok(z in ZONES, `${z} has a price multiplier`);
});

test('pageFromHash routes known pages, sends unknown pages to the car, and leaves share links alone', () => {
  for (const p of PAGES) assert.equal(pageFromHash('#/' + p), p);
  assert.equal(pageFromHash('#/'), 'car');
  assert.equal(pageFromHash('#/nope'), 'car');
  assert.equal(pageFromHash('#m=1&s=2'), null);
  assert.equal(pageFromHash(''), null);
});
