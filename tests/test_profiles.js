// Profiles ledger — the identity/stats money path (node, in-memory storage).
const assert = require('assert');
global.localStorage = undefined;
require('../js/profiles.js');
const P = globalThis.Profiles;

const prof = P.profile();
assert(prof && prof.id, 'device profile gets a persistent id');

// local seats: same name reuses one identity (stats accumulate per seat)
const a = P.seat('Mario', '#e60012');
const a2 = P.seat('Mario', '#f68d1f');
assert.strictEqual(a.id, a2.id, 'same local name = same identity');
assert.strictEqual(a2.color, '#f68d1f', 'seat color updates for that identity');

// record a game: Al wins game 1, Bo wins game 2, streaks track
P.record([
  { uid: 'al', name: 'Al', color: '#e60012', grand: 300, yaz: 1 },
  { uid: 'bo', name: 'Bo', color: '#206479', grand: 250, yaz: 0 }
]);
P.record([
  { uid: 'al', name: 'Al', color: '#e60012', grand: 200, yaz: 0 },
  { uid: 'bo', name: 'Bo', color: '#206479', grand: 320, yaz: 1 }
]);
const al = P.ledger().al, bo = P.ledger().bo;
assert.strictEqual(al.g, 2); assert.strictEqual(al.w, 1);
assert.strictEqual(al.best, 300); assert.strictEqual(al.yaz, 1);
assert.strictEqual(al.streak, 0, 'Al lost the second game, streak resets');
assert.strictEqual(bo.g, 2); assert.strictEqual(bo.w, 1); assert.strictEqual(bo.streak, 1);

// merged stats from a host broadcast are sanitized and replace wholesale
P.merge([{ id: 'al', name: 'Al', color: '#e60012', g: '5', w: 'x', best: -1, yaz: 99, streak: 2 }]);
const merged = P.ledger().al;
assert.strictEqual(merged.g, 5, 'string numbers are floored to integers');
assert.strictEqual(merged.w, 0, 'non-numeric wins are sanitized to 0');
assert.strictEqual(merged.best, 0, 'negative best is clamped to 0');
assert.strictEqual(merged.yaz, 99, 'yahtzee count carried through');

const top = P.top(10);
assert.strictEqual(top[0].id, 'bo', 'top() sorts wins-first (Bo has a real win, Al was sanitized to 0)');
assert(top[0].w >= top[top.length - 1].w, 'top() is sorted by wins');

console.log('profiles OK — all assertions passed');