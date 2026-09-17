// engine.js — pure Yahtzee scoring + dice. No DOM, no deps. Runs in browser and node.
// ponytail: single shared copy of the scoring "money path" (UI and tests both read this).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Yahtzee = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var UPPER = ['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'];
  var LOWER = ['3 of a Kind', '4 of a Kind', 'Full House',
               'Small Straight', 'Large Straight', 'Yahtzee', 'Chance'];
  var UPPER_BONUS_AT = 63;   // standard: >=63 in upper section earns the bonus
  var UPPER_BONUS = 35;
  var YAHTZEE = 50;
  var JOKER_BONUS = 100;     // each extra Yahtzee after the first: +100 to the Yahtzee box

  function counts(dice) {
    var c = [0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < dice.length; i++) c[dice[i]]++;
    return c;
  }
  function sum(dice) {
    var s = 0, i;
    for (i = 0; i < dice.length; i++) s += dice[i];
    return s;
  }
  function uniq(dice) {
    var seen = {}, out = [], i;
    for (i = 0; i < dice.length; i++) {
      if (!seen[dice[i]]) { seen[dice[i]] = true; out.push(dice[i]); }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  function isYahtzee(dice) {
    return dice.length === 5 && dice[0] === dice[1] && dice[1] === dice[2] &&
           dice[2] === dice[3] && dice[3] === dice[4];
  }
  function hasRun(dice, len) {
    var u = uniq(dice), i;
    for (i = 0; i + len <= u.length; i++) {
      if (u[i + len - 1] - u[i] === len - 1) return true;
    }
    return false;
  }
  function faceValue(cat, dice) {
    var i = UPPER.indexOf(cat) + 1;
    return (counts(dice)[i] || 0) * i;
  }

  // Plain value of a category for these dice (no joker rules).
  function valueOf(cat, dice) {
    var c;
    switch (cat) {
      case 'Ones': case 'Twos': case 'Threes': case 'Fours': case 'Fives': case 'Sixes':
        return faceValue(cat, dice);
      case 'Chance': return sum(dice);
      case '3 of a Kind': c = counts(dice); return c.some(function (n) { return n >= 3; }) ? sum(dice) : 0;
      case '4 of a Kind': c = counts(dice); return c.some(function (n) { return n >= 4; }) ? sum(dice) : 0;
      case 'Full House': c = counts(dice); return c.indexOf(3) !== -1 && c.indexOf(2) !== -1 ? 25 : 0;
      case 'Small Straight': return hasRun(dice, 4) ? 30 : 0;
      case 'Large Straight': return hasRun(dice, 5) ? 40 : 0;
      case 'Yahtzee': return isYahtzee(dice) ? YAHTZEE : 0;
    }
    return 0;
  }

  // Suggested score for an open box given the dice on the table.
  // yahtzeeDone=true means the Yahtzee box already holds >=50 -> joker rules apply
  // for any extra 5-of-a-kind.
  function suggest(cat, dice, yahtzeeDone) {
    if (isYahtzee(dice) && yahtzeeDone && cat !== 'Yahtzee') {
      if (cat === 'Full House' || cat === 'Small Straight' || cat === 'Large Straight') {
        return cat === 'Full House' ? 25 : cat === 'Small Straight' ? 30 : 40;
      }
      if (cat === 'Chance' || cat === '3 of a Kind' || cat === '4 of a Kind') return sum(dice);
      return faceValue(cat, dice); // upper box of the rolled number: 5 x face, others 0
    }
    if (cat === 'Yahtzee') {
      // Open Yahtzee box: 50 if the dice are a yahtzee, else 0.
      return isYahtzee(dice) ? YAHTZEE : 0;
    }
    return valueOf(cat, dice);
  }

  // A .values array keyed like player.scoreboard below.
  function totals(values) {
    var upperTotal = 0, lowerTotal = 0, i;
    for (i = 0; i < UPPER.length; i++) upperTotal += values[UPPER[i]] || 0;
    for (i = 0; i < LOWER.length; i++) lowerTotal += values[LOWER[i]] || 0;
    var bonus = upperTotal >= UPPER_BONUS_AT ? UPPER_BONUS : 0;
    return { upperTotal: upperTotal, bonus: bonus, lowerTotal: lowerTotal,
             grand: upperTotal + bonus + lowerTotal };
  }

  // The Yahtzee box can be revisited after it holds 50: each extra yahtzee adds +100.
  function nextYahtzeeValue(current) {
    return current >= YAHTZEE ? current + JOKER_BONUS : YAHTZEE;
  }

  function rollDice(n) {
    n = n || 5;
    var out = [], i;
    for (i = 0; i < n; i++) out.push(1 + Math.floor(Math.random() * 6));
    return out;
  }

  // Number of yahtzees banked on a card: first = 1, each joker bonus after = +1.
  function yahtzeeCount(card) {
    var box = card && card.Yahtzee;
    if (!box || !(box.v >= YAHTZEE)) return 0;
    return 1 + Math.floor((box.v - YAHTZEE) / JOKER_BONUS);
  }

  // A card is full when every box is locked. A Yahtzee box holding 50+ can
  // still take joker bonuses, but it no longer keeps the player "in" the game
  // once all 13 boxes are closed — otherwise endgame never arrives.
  function cardFull(card) {
    var cats = UPPER.concat(LOWER), i;
    for (i = 0; i < cats.length; i++) {
      if (!card[cats[i]] || !card[cats[i]].locked) return false;
    }
    return true;
  }

  return {
    UPPER: UPPER.slice(),
    LOWER: LOWER.slice(),
    UPPER_BONUS: UPPER_BONUS,
    UPPER_BONUS_AT: UPPER_BONUS_AT,
    YAHTZEE: YAHTZEE,
    JOKER_BONUS: JOKER_BONUS,
    valueOf: valueOf,
    suggest: suggest,
    totals: totals,
    nextYahtzeeValue: nextYahtzeeValue,
    yahtzeeCount: yahtzeeCount,
    isYahtzee: isYahtzee,
    rollDice: rollDice,
    cardFull: cardFull
  };
});