// tests/test_engine.js — one runnable check for the scoring money path.
// Run: node tests/test_engine.js

const assert = require('assert');
const E = require('../js/engine.js');

assert.strictEqual(E.valueOf('Ones', [1, 1, 2, 3, 6]), 2);
assert.strictEqual(E.valueOf('Sixes', [6, 6, 6, 2, 5]), 18);
assert.strictEqual(E.valueOf('Chance', [1, 2, 3, 4, 5]), 15);
assert.strictEqual(E.valueOf('3 of a Kind', [3, 3, 3, 4, 6]), 19);
assert.strictEqual(E.valueOf('3 of a Kind', [1, 2, 3, 4, 5]), 0);
assert.strictEqual(E.valueOf('4 of a Kind', [5, 5, 5, 5, 2]), 22);
assert.strictEqual(E.valueOf('4 of a Kind', [5, 5, 5, 2, 2]), 0);
assert.strictEqual(E.valueOf('Full House', [2, 2, 5, 5, 5]), 25);
assert.strictEqual(E.valueOf('Full House', [2, 2, 5, 5, 2]), 25, 'a pair + a three-of-a-kind is 25');
assert.strictEqual(E.valueOf('Full House', [2, 2, 2, 2, 5]), 0, 'four of a kind is not a full house');
assert.strictEqual(E.valueOf('Full House', [5, 5, 5, 5, 5]), 0, 'a yahtzee is not a full house');
assert.strictEqual(E.valueOf('Small Straight', [1, 2, 3, 4, 6]), 30);
assert.strictEqual(E.valueOf('Small Straight', [2, 3, 4, 5, 2]), 30);
assert.strictEqual(E.valueOf('Small Straight', [1, 3, 4, 5, 6]), 30, '3-4-5-6 is a small straight');
assert.strictEqual(E.valueOf('Small Straight', [1, 2, 4, 5, 6]), 0, '1-2-4-5-6 has no 4-run');
assert.strictEqual(E.valueOf('Large Straight', [2, 3, 4, 5, 6]), 40);
assert.strictEqual(E.valueOf('Large Straight', [1, 2, 3, 4, 6]), 0);
assert.strictEqual(E.valueOf('Yahtzee', [4, 4, 4, 4, 4]), 50);
assert.strictEqual(E.valueOf('Yahtzee', [4, 4, 4, 4, 5]), 0);

// Upper bonus threshold: 63 exactly earns it.
assert.strictEqual(E.totals({ Ones: 5, Twos: 10, Threes: 15, Fours: 12, Fives: 10, Sixes: 11 }).bonus, 35);
assert.strictEqual(E.totals({ Ones: 1, Twos: 2, Threes: 3, Fours: 4, Fives: 5, Sixes: 6 }).bonus, 0);
assert.strictEqual(E.totals({ Ones: 3, Twos: 6, Threes: 9, Fours: 12, Fives: 15, Sixes: 18 }).grand, 98);

// Joker: 5-of-a-kind once the Yahtzee box is filled.
const jr = [5, 5, 5, 5, 5];
assert.strictEqual(E.suggest('Fives', jr, true), 25);
assert.strictEqual(E.suggest('Sixes', jr, true), 0);
assert.strictEqual(E.suggest('Full House', jr, true), 25);
assert.strictEqual(E.suggest('Small Straight', jr, true), 30);
assert.strictEqual(E.suggest('Large Straight', jr, true), 40);
assert.strictEqual(E.suggest('Chance', jr, true), 25);
assert.strictEqual(E.suggest('Ones', jr, false), 0, 'no joker before the box is filled');
assert.strictEqual(E.nextYahtzeeValue(50), 150);
assert.strictEqual(E.nextYahtzeeValue(250), 350);
assert.strictEqual(E.nextYahtzeeValue(0), 50);

// Dice generator stays in range.
for (var i = 0; i < 200; i++) {
  var d = E.rollDice(5);
  assert.strictEqual(d.length, 5);
  assert(d.every(function (x) { return x >= 1 && x <= 6; }));
}
assert(E.isYahtzee([3, 3, 3, 3, 3]));
assert(!E.isYahtzee([3, 3, 3, 3, 2]));

// cardFull: the upper-bonus Yahtzee never keeps a finished game looping.
function mkCard(lockedYahtzeeValue) {
  var card = {}, i, cats = E.UPPER.concat(E.LOWER);
  for (i = 0; i < cats.length; i++) card[cats[i]] = { v: i === cats.indexOf('Yahtzee') ? lockedYahtzeeValue : 3, locked: true };
  return card;
}
assert(E.cardFull(mkCard(50)), 'a full card with a 50-point Yahtzee is still a finished card');
assert(E.cardFull(mkCard(150)), 'joker-boosted Yahtzee (150) does not reopen the game');
var openCard = mkCard(50);
openCard.Ones = { v: 0, locked: false };
assert(!E.cardFull(openCard), 'an unlocked box keeps the player in the game');
var fresh = mkCard(50);
fresh.Ones.locked = false;
assert(!E.cardFull(fresh), 'fresh/open cards are never full');

// yahtzeeCount: first yahtzee is one, each +100 joker bonus is another.
assert.strictEqual(E.yahtzeeCount(mkCard(0)), 0, 'no yahtzee yet');
assert.strictEqual(E.yahtzeeCount(mkCard(50)), 1);
assert.strictEqual(E.yahtzeeCount(mkCard(150)), 2);
assert.strictEqual(E.yahtzeeCount(mkCard(850)), 9);

// filled / turnNumber: the 13-turn tracker's money numbers.
function mkFresh() {
  var card = {}, i, cats = E.UPPER.concat(E.LOWER);
  for (i = 0; i < cats.length; i++) card[cats[i]] = { v: 0, locked: false };
  return card;
}
assert.strictEqual(E.filled(mkFresh()), 0, 'fresh card has zero turns used');
assert.strictEqual(E.turnNumber(mkFresh()), 1, 'first turn is 1 of 13');
var one = mkFresh(); one.Ones = { v: 3, locked: true };
assert.strictEqual(E.filled(one), 1);
assert.strictEqual(E.turnNumber(one), 2);
var twelve = mkFresh();
['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', '3 of a Kind', '4 of a Kind', 'Full House', 'Small Straight', 'Large Straight', 'Chance']
  .forEach(function (c) { twelve[c] = { v: 5, locked: true }; });
assert.strictEqual(E.filled(twelve), 12, 'twelve boxes closed');
assert.strictEqual(E.turnNumber(twelve), 13, 'only the Yahtzee box remains — turn 13 of 13');
assert.strictEqual(E.turnNumber(mkCard(150)), 13, 'a +100 re-score of Yahtzee does not add a 14th turn');
assert.strictEqual(E.filled(mkCard(150)), 13, 'joker bonus counts the same single Yahtzee box');
assert.strictEqual(E.cardFull(mkCard(150)), true, 'joker-boosted card stays full');

console.log('engine OK — all assertions passed');