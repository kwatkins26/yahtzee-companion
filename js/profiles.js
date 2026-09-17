// profiles.js — device-local identity + stats ledger + local player book.
// No server: your win/loss history lives on the devices you play on. The host
// device keeps the room's table; every guest syncs their share back to their
// own device. Pure persistence — runs in browser and Node (in-memory fallback).
(function (root) {
  'use strict';

  var PROFILE_KEY = 'yahtzee2001.profile';
  var LEDGER_KEY = 'yahtzee2001.ledger';
  var BOOK_KEY = 'yahtzee2001.book';

  var mem = {};
  var store = (typeof root.localStorage !== 'undefined' && root.localStorage) || {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };

  var ADJ = ['Turbo', 'Velvet', 'Cosmic', 'Slinky', 'Rusty', 'Zappy', 'Mellow', 'Nova', 'Pixel', 'Jazzy', 'Dicey', 'Sneaky'];
  var NOUN = ['Badger', 'Cobra', 'Wombat', 'Rascal', 'Fox', 'Otter', 'Beetle', 'Marmot', 'Shrimp', 'Radish', 'Wookie', 'Cactus'];

  function uid() { return 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function nick() { return ADJ[Math.floor(Math.random() * ADJ.length)] + ' ' + NOUN[Math.floor(Math.random() * NOUN.length)]; }
  function read(k, fb) { try { var r = store.getItem(k); return r ? JSON.parse(r) : fb; } catch (e) { return fb; } }
  function write(k, o) { try { store.setItem(k, JSON.stringify(o)); } catch (e) {} }

  // This device's persistent profile (online identity).
  function profile() {
    var p = read(PROFILE_KEY, null);
    if (!p || !p.id) { p = { id: uid(), name: '', color: '' }; write(PROFILE_KEY, p); }
    if (!p.name) { p.name = ''; write(PROFILE_KEY, p); }
    return p;
  }
  function saveProfile(p) { write(PROFILE_KEY, p); }

  // Local seats for in-person games (each distinct name is a persistent identity).
  function book() { return read(BOOK_KEY, []); }
  function saveBook(b) { write(BOOK_KEY, b); }
  function seat(name, color) {
    var b = book(), key = (name || '').trim().toLowerCase(), i;
    if (key) {
      for (i = 0; i < b.length; i++) {
        if (String(b[i].name || '').toLowerCase() === key) {
          b[i].name = name; b[i].color = color;
          saveBook(b);
          return { id: b[i].id, name: b[i].name, color: b[i].color };
        }
      }
    }
    var s = { id: uid(), name: name, color: color };
    b.push(s); saveBook(b);
    return { id: s.id, name: s.name, color: s.color };
  }

  // Stats ledger: id -> {id,name,color,g(ames),w(ins),best,yaz,streak}
  function ledger() { return read(LEDGER_KEY, {}); }
  function putStat(s) { var l = ledger(); l[s.id] = s; write(LEDGER_KEY, l); return s; }

  // Record a finished game. winners = everyone tied for the top grand total.
  function record(results) {
    var l = ledger(), i, maxG = 0;
    for (i = 0; i < results.length; i++) if (results[i].grand > maxG) maxG = results[i].grand;
    var out = {};
    for (i = 0; i < results.length; i++) {
      var r = results[i] || {}, cur = l[r.uid] || { id: r.uid, name: r.name, color: r.color, g: 0, w: 0, best: 0, yaz: 0, streak: 0 };
      cur.name = r.name; cur.color = r.color;
      cur.g = (cur.g || 0) + 1;
      cur.best = Math.max(cur.best || 0, r.grand || 0);
      cur.yaz = (cur.yaz || 0) + (r.yaz || 0);
      var win = (r.grand || 0) === maxG;
      cur.w = (cur.w || 0) + (win ? 1 : 0);
      cur.streak = win ? (cur.streak || 0) + 1 : 0;
      l[r.uid] = cur; out[r.uid] = cur;
    }
    write(LEDGER_KEY, l);
    return out;
  }

  function top(n) {
    var l = ledger(), arr = [], k;
    for (k in l) if (Object.prototype.hasOwnProperty.call(l, k)) arr.push(l[k]);
    arr.sort(function (a, b) { return (b.w - a.w) || (b.best - a.best) || (a.g - b.g); });
    return arr.slice(0, n && n > 0 ? n : 20);
  }

  // Bring a room's stats table home (guests merging what the host broadcast).
  function sanitize(e) {
    e = e || {};
    var s = { id: String(e.id || uid()), name: String(e.name || '').slice(0, 20),
      color: /^#[0-9a-f]{6}$/i.test(e.color || '') ? e.color : '',
      g: Math.max(0, Math.floor(e.g) || 0), w: Math.max(0, Math.floor(e.w) || 0),
      best: Math.max(0, Math.floor(e.best) || 0), yaz: Math.max(0, Math.floor(e.yaz) || 0),
      streak: Math.max(0, Math.floor(e.streak) || 0) };
    return s;
  }
  function merge(entries) {
    if (!entries || !entries.length) return;
    var l = ledger(), i, s;
    for (i = 0; i < entries.length; i++) { s = sanitize(entries[i]); l[s.id] = s; }
    write(LEDGER_KEY, l);
  }

  root.Profiles = {
    KEYS: { PROFILE: PROFILE_KEY, LEDGER: LEDGER_KEY, BOOK: BOOK_KEY },
    uid: uid, nick: nick,
    profile: profile, saveProfile: saveProfile,
    book: book, saveBook: saveBook, seat: seat,
    ledger: ledger, putStat: putStat, record: record, top: top, merge: merge
  };
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this);