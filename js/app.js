// app.js — YAHTZEE 2001 companion. No framework, no build step, serverless P2P.
// State machine + render loops; all scoring lives in engine.js (shared with tests).
// Two modes: IN PERSON (dice off — tap dice to set your real roll) and
// ONLINE (dice on — host owns the table, guests join by invite link over WebRTC).

(function () {
  'use strict';

  var E = window.Yahtzee;
  var Profiles = window.Profiles;
  var SAVE_KEY = 'yahtzee2001.v1';

  var PALETTE = [
    { n: 'Nintendo Red', h: '#e60012' }, { n: 'Amber', h: '#ecab37' },
    { n: 'Signal', h: '#f68d1f' },       { n: 'Systems Teal', h: '#206479' },
    { n: 'Chrome Indigo', h: '#3d4f97' },{ n: 'Periwinkle', h: '#7a8aba' },
    { n: 'Carbon', h: '#21242e' },       { n: 'Games Red', h: '#a7282b' }
  ];

  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
               5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

  var state = null;
  var selfIndex = -1; // guests: which seat in host state belongs to this device

  // ---------- P2P (PeerJS: no server you run, WebRTC data channels) ----------
  var peer = null;          // this device's Peer (host room or joining client)
  var conn = null;          // outgoing connection (set on the joining client)
  var guestConns = [];      // incoming connections (set on the host)
  var myPeerId = null;
  var isHost = false;       // I created the room
  var remoteMode = false;   // currently networked
  var pendingJoin = null;   // deep-link code from #j=...
  var authority = function () { return !remoteMode || isHost; };

  // ---------- helpers ----------
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var cardOf = function (p) { return p.card; };
  var values = function (card) {
    var out = {}, i, cats = E.UPPER.concat(E.LOWER);
    for (i = 0; i < cats.length; i++) out[cats[i]] = (card[cats[i]] && card[cats[i]].v) || 0;
    return out;
  };
  var yahtzeeDone = function (card) { return card.Yahtzee.v >= E.YAHTZEE; };

  function newCard() {
    var card = {}, i, cats = E.UPPER.concat(E.LOWER);
    for (i = 0; i < cats.length; i++) card[cats[i]] = { v: 0, locked: false };
    return card;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ---------- seating / turn ownership ----------
  function indexOfUid(uid) {
    var i;
    if (!state || !state.players) return -1;
    for (i = 0; i < state.players.length; i++) {
      if (state.players[i] && state.players[i].uid && state.players[i].uid === uid) return i;
    }
    return -1;
  }
  // A seat is "local" when no connected guest owns it (pass-and-play on the host).
  function isLocalAt(idx) {
    var p = state && state.players && state.players[idx], i;
    if (!p || !p.uid) return true;
    for (i = 0; i < guestConns.length; i++) {
      if (guestConns[i]._uid === p.uid) return false;
    }
    return true;
  }
  // May THIS device act on the current table right now? (each player rolls their own turn)
  function myTurn() {
    if (!remoteMode) return true;
    if (isHost) return isLocalAt(state.turn ? state.turn.p : -1);
    return !!(state.turn && state.turn.p === selfIndex);
  }
  function turnPlayerName() {
    return state.turn && state.players[state.turn.p] ? state.players[state.turn.p].name : '';
  }
  function grandOf(card) { return E.totals(values(card)).grand; }
  function normalizeColor(c) {
    if (typeof c !== 'string') return '';
    for (var i = 0; i < PALETTE.length; i++) if (PALETTE[i].h === c) return c;
    return '';
  }

  // ---------- persistence (never lose a score) ----------
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {} }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { try { localStorage.removeItem(SAVE_KEY); } catch (_) {} return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

  // ---------- network plumbing ----------
  function commit() {
    if (!remoteMode || isHost) save();
    if (isHost) broadcast();
    render();
  }
  function send(obj) { if (conn && conn.open) conn.send(obj); }
  function broadcast(payload) {
    // payload is optional; the default is a per-guest state snapshot tagged _you
    var i, body = payload || { t: 'state' }, sent = false;
    if (!payload) {
      for (i = 0; i < guestConns.length; i++) {
        if (guestConns[i].open) {
          var snap = clone(state);
          snap._you = indexOfUid(guestConns[i]._uid);
          guestConns[i].send({ t: 'state', state: snap });
        }
      }
      return;
    }
    for (i = 0; i < guestConns.length; i++) {
      if (guestConns[i].open) { guestConns[i].send(payload); sent = true; }
    }
  }

  function startHost() {
    if (peer) return;
    isHost = true; remoteMode = true;
    try {
      peer = new window.Peer();
      peer.on('open', function (id) { myPeerId = id; render(); });
      peer.on('connection', function (c) {
        c._uid = null;
        c.on('data', function (msg) { onRemote(msg, c); });
        c.on('close', function () {
          guestConns = guestConns.filter(function (x) { return x !== c; });
        });
        guestConns.push(c);
      });
      peer.on('error', function (e) { flash('P2P: ' + (e && e.type ? e.type : 'link error')); });
    } catch (e) { flash('P2P NOT AVAILABLE HERE'); }
  }

  function joinRoom(code) {
    if (!code) return;
    isHost = false; remoteMode = true;
    try {
      peer = new window.Peer();
      peer.on('open', function () {
        conn = peer.connect(code.trim(), { reliable: true });
        conn.on('open', function () {
          var prof = Profiles.profile();
          conn.send({ t: 'join', name: prof.name || Profiles.nick(),
            color: prof.color || PALETTE[0].h, uid: prof.id || Profiles.uid() });
        });
        conn.on('data', onRemote);
        conn.on('close', function () { flash('LEFT THE ROOM'); });
      });
      peer.on('error', function (e) {
        flash('CANNOT FIND ROOM — CHECK THE CODE');
        if (e && e.type === 'peer-unavailable') { state.phase = 'setup'; render(); }
      });
    } catch (e) { flash('P2P NOT AVAILABLE HERE'); }
  }

  function closeRoom() {
    if (conn) { try { conn.close(); } catch (e) {} conn = null; }
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = null; guestConns = []; myPeerId = null; isHost = false; remoteMode = false;
  }

  function onRemote(msg, conn) {
    if (!msg || !msg.t) return;

    if (msg.t === 'state') {
      var st = msg.state;
      selfIndex = st && typeof st._you === 'number' ? st._you : -1;
      if (st && st._you !== undefined) delete st._you;
      state = st || state;
      // keep this device's identity in step with its seat (renames/colors stick)
      if (selfIndex >= 0 && state.players && state.players[selfIndex]) {
        var me = state.players[selfIndex], pf = Profiles.profile();
        if (me.name) pf.name = me.name;
        if (me.color) pf.color = me.color;
        Profiles.saveProfile(pf);
      }
      render(); return;
    }
    if (msg.t === 'stats') { if (msg.table) Profiles.merge(msg.table); return; }
    if (msg.t === 'nudge') { flash('WAIT — NOT YOUR ROLL. ' + (msg.name ? esc(msg.name) + ' IS UP.' : '')); return; }
    if (remoteMode && !isHost) return; // joining clients only ever render host state

    if (msg.t === 'join') {
      if (!conn || (state.players && state.players.length >= 12) || state.phase === 'over') return;
      var juid = String(msg.uid || Profiles.uid()).slice(0, 40);
      var jnm = String(msg.name || '').trim().slice(0, 20) || 'GUEST';
      var jcol = normalizeColor(msg.color) || PALETTE[Math.floor(Math.random() * PALETTE.length)].h;
      conn._uid = juid;
      state.players.push({ uid: juid, name: jnm, color: jcol, card: newCard() });
      commit(); return;
    }

    if (msg.t === 'rename' || msg.t === 'recolor') {
      var ridx = conn && conn._uid ? indexOfUid(conn._uid) : -1;
      if (ridx < 0) return;
      if (msg.t === 'rename') {
        var newName = String(msg.name || '').trim().slice(0, 20);
        if (!newName) return;
        state.players[ridx].name = newName;
      } else {
        var ncol = normalizeColor(msg.color);
        if (!ncol) return;
        state.players[ridx].color = ncol;
      }
      commit(); return;
    }

    // each online player rolls only on their own turn
    if (msg.t === 'roll' || msg.t === 'hold' || msg.t === 'cycle' || msg.t === 'score') {
      var gidx = conn && conn._uid ? indexOfUid(conn._uid) : -1;
      if (gidx < 0 || !state.turn || state.turn.p !== gidx) {
        if (conn && conn.open) conn.send({ t: 'nudge', name: turnPlayerName() });
        return;
      }
      if (msg.t === 'roll') doRoll();
      else if (msg.t === 'hold') doHold(msg.i);
      else if (msg.t === 'cycle') doCycle(msg.i);
      else applyScore(msg.cat);
      return;
    }
  }

  // ---------- game flow ----------
  function hasOpen(p) { return !E.cardFull(cardOf(p)); }

  function nextPending(from) {
    var n = state.players.length, i;
    for (i = 1; i <= n; i++) {
      var idx = (from + i) % n;
      if (hasOpen(state.players[idx])) return idx;
    }
    return -1;
  }

function startTurn(from) {
    var p = nextPending(from);
    if (p === -1) { state.phase = 'over'; finalizeStats(); commit(); return; }
    state.turn = {
      p: p,
      rolls: 1,
      dice: state.mode === 'inperson' ? [1, 1, 1, 1, 1] : E.rollDice(5),
      held: [false, false, false, false, false]
    };
    state.phase = 'game';
    commit();
  }

  function finalizeStats() {
    if (!state || !state.players || !state.players.length || state.statsOnboard) return;
    state.statsOnboard = true; // once per game
    var i, ranked = state.players.slice().sort(function (a, b) { return grandOf(b.card) - grandOf(a.card); });
    var maxG = ranked.length ? grandOf(ranked[0].card) : 0;
    var results = [];
    for (i = 0; i < ranked.length; i++) {
      results.push({ uid: ranked[i].uid || Profiles.uid(), name: ranked[i].name,
        color: ranked[i].color, grand: grandOf(ranked[i].card), yaz: E.yahtzeeCount(ranked[i].card) });
    }
    var rec = Profiles.record(results); // host device keeps the room's ledger
    if (isHost && remoteMode) {
      var table = [];
      for (i = 0; i < results.length; i++) if (rec[results[i].uid]) table.push(rec[results[i].uid]);
      broadcast({ t: 'stats', table: table }); // guests fold this into their own device
    }
  }

  function applyScore(cat) {
    if (!state || state.phase !== 'game' || !state.turn) return;
    // trust boundary: this is the only place a score is written — re-validated here
    if (!authority()) return;
    var p = state.players[state.turn.p];
    var card = cardOf(p), box = card[cat];
    var dice = state.turn.dice;

    if (!box || !(cat in card)) return; // reject unknown categories from the wire

    if (cat === 'Yahtzee') {
      if (!box.locked) { box.v = E.isYahtzee(dice) ? E.YAHTZEE : 0; box.locked = true; }
      else if (box.v >= E.YAHTZEE) {
        // extra yahtzee -> +100 joker bonus; otherwise a legal 0 so no turn gets trapped
        if (E.isYahtzee(dice)) box.v = E.nextYahtzeeValue(box.v);
      }
      else return; // already closed at 0
    } else {
      if (box.locked) return;
      box.v = E.suggest(cat, dice, yahtzeeDone(card));
      box.locked = true;
    }
    startTurn(state.turn.p);
  }

  function doRoll() {
    var t = state.turn;
    if (state.mode === 'inperson') return;
    if (t.rolls >= 3) return;
    var dice = [], i;
    for (i = 0; i < 5; i++) dice.push(t.held[i] ? t.dice[i] : Math.floor(Math.random() * 6) + 1);
    t.dice = dice; t.rolls++;
    commit();
    var tray = document.querySelector('.tray');
    if (tray) { tray.classList.add('shaking'); setTimeout(function () { tray.classList.remove('shaking'); }, 400); }
  }
  function doHold(i) {
    i = Number(i);
    if (isNaN(i) || i < 0 || i > 4) return;
    state.turn.held[i] = !state.turn.held[i];
    commit();
  }
  function doCycle(i) {
    i = Number(i);
    if (isNaN(i) || i < 0 || i > 4) return;
    state.turn.dice[i] = (state.turn.dice[i] % 6) + 1;
    commit();
  }

  // ---------- local actions (some route through the network) ----------
  var ACTIONS = {

    menu: function () {
      closeRoom();
      selfIndex = -1;
      state.phase = 'menu'; save(); render();
    },

    newgame: function () {
      if (load() && !confirm('Wipe the saved game and start fresh?')) return;
      closeRoom();
      state = { phase: 'setup', mode: 'inperson', players: [], ui: { dot: 0 } };
      clearSave(); save(); render();
    },

    resume: function () {
      var s = load();
      if (!s || !s.players || !s.players.length) return;
      closeRoom();
      state = s;
      state.phase = s.turn && s.turn.dice && s.turn.dice.length === 5 ? 'game' : 'setup';
      if (state.phase === 'game' && !hasOpen(state.players[state.turn.p])) startTurn(state.turn.p);
      remoteMode = false; isHost = false;
      save(); render();
    },

    mode: function () {
      closeRoom();
      state.mode = this.dataset.mode;
      state.phase = 'setup';
      if (state.mode === 'online') startHost();
      save(); render();
    },

    addname: function () {
      if (!authority()) return;
      var inp = document.getElementById('pname');
      var name = (inp.value || '').trim();
      if (!name) { flash('NAME REQUIRED'); return; }
      if (state.players.length >= 12) { flash('MAX 12 PLAYERS'); return; }
      var seat = Profiles.seat(name, PALETTE[state.ui.dot].h);
      state.players.push({ uid: seat.id, name: seat.name, color: seat.color, card: newCard() });
      state.ui.dot = (state.ui.dot + 1) % PALETTE.length;
      commit();
    },

    rm: function () {
      if (!authority()) return;
      state.players.splice(Number(this.dataset.i), 1);
      commit();
    },

    pickdot: function () {
      state.ui.dot = Number(this.dataset.i);
      commit();
    },

    start: function () {
      if (!authority()) return;
      if (!state.players.length) { flash('ADD A PLAYER FIRST'); return; }
      startTurn(-1);
    },

    join: function () {
      var code = (document.getElementById('jcode') || {}).value || (state.ui.pendingCode ? state.ui.pendingCode : '');
      var name = ((document.getElementById('jname') || { value: '' }).value || '').trim();
      var prof = Profiles.profile();
      if (name) prof.name = name;
      prof.color = PALETTE[state.ui.dot].h;
      prof.name = prof.name || Profiles.nick();
      Profiles.saveProfile(prof);
      state.ui.joinName = prof.name;
      state.ui.pendingCode = extractRoom(code);
      state.phase = 'joining';
      render();
      joinRoom(state.ui.pendingCode);
    },

    roll: function () {
      if (!myTurn()) { flash('WAIT — NOT YOUR ROLL. ' + esc(turnPlayerName()) + ' IS UP.'); return; }
      if (remoteMode && !isHost) { send({ t: 'roll' }); return; }
      doRoll();
    },
    hold: function () {
      if (!myTurn()) { flash('WAIT — NOT YOUR ROLL. ' + esc(turnPlayerName()) + ' IS UP.'); return; }
      if (remoteMode && !isHost) { send({ t: 'hold', i: this.dataset.i }); return; }
      doHold(this.dataset.i);
    },
    cycle: function () {
      if (!myTurn()) { flash('WAIT — NOT YOUR ROLL. ' + esc(turnPlayerName()) + ' IS UP.'); return; }
      if (remoteMode && !isHost) { send({ t: 'cycle', i: this.dataset.i }); return; }
      doCycle(this.dataset.i);
    },
    score: function () {
      if (!myTurn()) { flash('WAIT — NOT YOUR ROLL. ' + esc(turnPlayerName()) + ' IS UP.'); return; }
      if (remoteMode && !isHost) { send({ t: 'score', cat: this.dataset.cat }); return; }
      applyScore(this.dataset.cat);
    },

    yourename: function () {
      var inp = document.getElementById('you-name');
      var name = (inp.value || '').trim();
      if (!name) { flash('NAME REQUIRED'); return; }
      if (remoteMode && !isHost) { send({ t: 'rename', name: name }); return; }
      if (authority() && selfIndex >= 0) {
        state.players[selfIndex].name = name;
        var pf = Profiles.profile(); pf.name = name; Profiles.saveProfile(pf);
        commit();
      }
    },
    youcolor: function () {
      if (remoteMode && !isHost) { send({ t: 'recolor', color: PALETTE[Number(this.dataset.i)].h }); return; }
      if (authority() && selfIndex >= 0) {
        state.players[selfIndex].color = PALETTE[Number(this.dataset.i)].h;
        var pr = Profiles.profile(); pr.color = PALETTE[Number(this.dataset.i)].h; Profiles.saveProfile(pr);
        commit();
      }
    },

    hall: function () {
      state.phase = 'hall'; save(); render();
    },

    share: function () {
      if (isFileLocal() || !baseHref() || !myPeerId) {
        flash('NO SHAREABLE ROOM FROM HERE — SEE THE HINT');
        return;
      }
      var link = inviteLink();
      if (navigator.share) {
        navigator.share({ title: 'YAHTZEE 2001', text: 'Join my Yahtzee room', url: link })
          .catch(function () { copyText(link); flash('INVITE LINK COPIED'); });
      } else {
        copyText(link);
        flash('INVITE LINK COPIED');
      }
    },

    qr: function () {
      // undefined = let the device decide (desktop open, phone closed);
      // the toggle then hard-pins the opposite of what's showing.
      var cur = isPhoneLike() ? !!state.ui.showQR : state.ui.showQR !== false;
      state.ui.showQR = !cur;
      render();
    },

    copy: function () {
      if (isFileLocal() || !baseHref() || !myPeerId) {
        flash('NO SHAREABLE LINK FROM FILE:// — SERVE THE FOLDER, SEE THE HINT');
        return;
      }
      copyText(inviteLink());
      flash('INVITE LINK COPIED');
    }
  };

  function baseHref() {
    try { return window.location.href.split('#')[0]; } catch (e) { return ''; }
  }
  // A file:// page is only readable by the machine it lives on — join links
  // must come from an http(s) address, or a phone can never reach them.
  function isFileLocal() {
    try { return window.location.protocol === 'file:'; } catch (e) { return true; }
  }
  function isLoopback() {
    try {
      var h = window.location.hostname || '';
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.indexOf('.local') !== -1;
    } catch (e) { return false; }
  }
  function copyText(text) {
    var done = function () {};
    if (navigator.clipboard && navigator.clipboard.writeText) {
      done = function () { navigator.clipboard.writeText(text).catch(function () {}); };
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    done();
  }

  // ---------- rendering ----------
  function flash(msg) {
    var m = document.getElementById('errmsg');
    if (m) { m.textContent = msg; setTimeout(function () { m.textContent = ''; }, 2500); }
  }

  function dieHTML(v, held, i, mode, actable) {
    var cells = '', k;
    var set = PIPS[v] || [];
    for (k = 0; k < 9; k++) cells += '<span class="pip' + (set.indexOf(k) !== -1 ? ' on' : '') + '"></span>';
    var action = mode === 'inperson' ? 'cycle' : 'hold';
    var pressable = mode === 'inperson' ? 'aria-pressed="false"' : 'aria-pressed="' + held + '"';
    var tip = mode === 'inperson' ? 'sets value' : (held ? ', held' : '');
    return '<button type="button" class="die' + (held ? ' held' : '') + '" data-action="' + action + '" data-i="' + i +
      '" ' + pressable + (actable ? '' : ' disabled aria-disabled="true"') +
      ' aria-label="Die ' + (i + 1) + ' shows ' + v + (tip ? ' — tap to ' + tip : '') +
      '"><span class="track">' + cells + '</span></button>';
  }

  function row(cat, card, dice, actable) {
    var box = card[cat];
    var sql = E.suggest(cat, dice, yahtzeeDone(card));
    var lock = actable ? '' : ' disabled aria-disabled="true"';

    if (cat === 'Yahtzee') {
      if (!box.locked) {
        return '<button type="button" class="score-row' + (sql >= 50 ? ' go' : '') + '" data-action="score" data-cat="Yahtzee"' + lock + '>' +
          '<span class="cat">YAHTZEE</span><span class="pad"><span class="guess">' + sql + '</span></span></button>';
      }
      if (box.v >= E.YAHTZEE) {
        if (E.isYahtzee(dice)) {
          return '<button type="button" class="score-row go" data-action="score" data-cat="Yahtzee"' + lock + '>' +
            '<span class="cat">YAHTZEE <span class="guess" style="margin-left:8px">JOKER! +' + E.JOKER_BONUS + '</span></span>' +
            '<span class="locked-val">' + box.v + '</span></button>';
        }
        return '<div class="score-row" disabled="" aria-disabled="true"><span class="cat">YAHTZEE</span>' +
          '<span class="locked-val">' + box.v + '</span></div>';
      }
      return '<div class="score-row" disabled=""><span class="cat">YAHTZEE</span><span class="locked-val">' + box.v + '</span></div>';
    }

    if (box.locked) {
      return '<div class="score-row" disabled="" aria-disabled="true"><span class="cat">' + esc(cat) +
        '</span><span class="locked-val">' + box.v + '</span></div>';
    }
    return '<button type="button" class="score-row' + (sql > 0 ? ' go' : '') + '" data-action="score" data-cat="' + esc(cat) + '"' + lock + '>' +
      '<span class="cat">' + esc(cat) + '</span><span class="pad"><span class="guess">' + sql + '</span></span></button>';
  }

  function section(catNames, card, dice, label, actable) {
    var h = '<div class="section-bar">' + esc(label) + '</div>';
    for (var i = 0; i < catNames.length; i++) h += row(catNames[i], card, dice, actable);
    return h;
  }

  function totalsHTML(card) {
    var t = E.totals(values(card));
    return '<div class="totals">' +
      '<span class="lab">UPPER TOTAL</span><span>' + t.upperTotal + '</span><span></span>' +
      '<span class="lab">UPPER BONUS 35»63</span><span>' + t.bonus + '</span><span></span>' +
      '<span class="lab">LOWER TOTAL</span><span>' + t.lowerTotal + '</span><span></span>' +
      '<span class="grand lab">GRAND TOTAL</span><span class="grand"><em>' + t.grand + '</em></span></div>';
  }

  function nav() {
    var menuLink = state.phase === 'menu' ? '' : '<a href="#" data-action="menu">Menu</a>';
    return '<header class="nav halftone"><div class="logo-pill">YahTzee <span>2001</span></div>' +
      '<div class="right">' + menuLink + '</div></header>';
  }

  function menu() {
    var s = load();
    var continueBtn = s && s.players.length
      ? '<button type="button" class="btn btn-amber btn-block" data-action="resume">Continue Game</button>'
      : '';
    return '<div class="menu"><div class="hero"><div class="mascot-bubble">Welcome to Yahtzee 2001! ' +
      (s && s.players.length ? 'Return to your table or deal a fresh one.' : 'Roll real dice — or bring friends online.') + ' ★</div>' +
      '<div class="wordmark">Yahtzee 2001</div><p class="subtitle">Companion Scorecard for Real Dice</p>' +
      '<div class="actions">' + continueBtn +
      '<button type="button" class="btn btn-amber btn-block" data-action="newgame">New Game</button>' +
      '<button type="button" class="btn btn-carbon btn-block" data-action="hall">The Hall — Stats &amp; Standings</button></div></div>' +
      '<div class="plate stack" style="margin-top:14px"><div class="section-bar">How To Play</div>' +
      '<p>13 rounds. Each turn roll up to <b>3 times</b>, tap dice to hold, then tap a <b>score box</b> to bank it. ' +
      'Hit <b>63</b> in the upper section for a <b>+35</b> bonus. Extra Yahtzees after the first open up Joker plays for <b>+100</b>. ' +
      'Playing <b>in person</b>? Switch the dice off and tap <b>set</b> to type your real roll.</p>' +
      '<div id="errmsg" class="error-msg" role="alert"></div></div></div>';
  }

  function modeCards() {
    var mk = function (mode, title, sub) {
      return '<button type="button" class="mode-card' + (state.mode === mode ? ' sel' : '') + '" data-action="mode" data-mode="' + mode + '">' +
        '<span class="m-title">' + title + '</span><span class="m-sub">' + sub + '</span></button>';
    };
    return '<div class="section-bar">Choose A Mode</div>' +
      '<div class="mode-grid">' +
      mk('inperson', 'In Person', 'Dice OFF · tap dice to set your real roll') +
      mk('online', 'Online', 'Dice ON · friends join by invite link') +
      '</div>';
  }

  function roomBox() {
    if (!isHost) return '';
    var unusable = isFileLocal() || !baseHref();
    var hint = 'Send the invite link — or the code above — to friends. They join on any device, no sign-up.';
    var guide = '';
    if (unusable) {
      hint = 'You opened the app straight from disk, so there is no web address to share yet. Cost: one command.';
      guide = '<code class="serve-cmd">python3 -m http.server 8000</code>' +
        '<p class="room-hint">Then reopen on this Mac as <b>http://localhost:8000</b>, and on your phone open <b>http://&lt;this-Macs-network-address&gt;:8000</b> — same Wi-Fi. Both must stay on that page; the invite link below then works.</p>';
    } else if (isLoopback()) {
      hint = '&quot;localhost&quot; only means this Mac. Joiners need your computer\'s network address — reopen as <b>http://&lt;your-IP&gt;:8000</b>, then share the invite below.';
    }
    return '<div class="plate room-box"><div class="section-bar">Your Room Is Live</div>' +
      (!myPeerId
        ? '<p class="room-code" aria-busy="true">Connecting…</p>'
        : '<p class="room-code">' + esc(myPeerId) + '</p>') +
      '<p class="room-hint">' + hint + '</p>' + guide +
      shareCluster(unusable) +
      '</div>';
  }

  // The invite travels two ways — a tap-to-join link, or a QR to scan from a
  // *different* screen. Smart placement: phones can't photograph their own
  // screen, so a phone opens with the Share Sheet first and tucks the QR away.
  function shareCluster(unusable) {
    if (unusable) {
      return '<button type="button" class="btn btn-amber btn-block" data-action="copy" disabled aria-disabled="true">Copy Invite Link</button>';
    }
    if (!myPeerId) {
      return '<button type="button" class="btn btn-amber btn-block" data-action="copy" disabled aria-disabled="true">Connecting…</button>';
    }
    var phone = isPhoneLike();
    var out = '<div class="share-row">' +
      '<button type="button" class="btn btn-amber" data-action="share">Share</button>' +
      '<button type="button" class="btn btn-amber" data-action="copy">Copy Link</button></div>';
    var qrVisible = phone ? !!state.ui.showQR : state.ui.showQR !== false;
    if (qrVisible) {
      out += '<div class="qr-block">' + qrFor(inviteLink()) +
        '<button type="button" class="btn btn-carbon btn-block" data-action="qr">Hide QR</button></div>' +
        '<p class="room-hint">' + (phone ? 'This is for another device — your own camera can\u2019t scan your own screen. Tap Share to send the link instead.' : 'Phone users: point your camera at the QR to jump straight in.') + '</p>';
    } else {
      out += '<button type="button" class="btn btn-carbon btn-block" data-action="qr">Show QR For Another Device</button>' +
        '<p class="room-hint">Your own camera can\u2019t scan your own screen — tap Share to send the link instead.</p>';
    }
    return out;
  }

  function inviteLink() {
    return baseHref() + '#j=' + encodeURIComponent(myPeerId);
  }

  // Be kind: if someone pastes a full invite URL into the code box, fish the
  // room token out of it instead of failing.
  function extractRoom(str) {
    var m = String(str || '').match(/(?:#j=|[?&]j=)([^&\s/#]+)/);
    if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    return String(str || '').trim();
  }

  function qrFor(link) {
    if (typeof qrcode !== 'function') return '<p class="room-hint">QR engine unavailable.</p>';
    var q = qrcode(0, 'M');
    q.addData(link);
    q.make();
    return '<div class="qr-frame" role="img" aria-label="QR invite code — scan with a phone camera inside the app link">' +
      q.createSvgTag(4, 8) + '</div>';
  }

  function isPhoneLike() {
    try {
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      var touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
      var narrow = window.innerWidth < 720 || (window.screen && window.screen.width < 720);
      return coarse && touch && narrow;
    } catch (e) { return false; }
  }

  function joinBox() {
    var prof = Profiles.profile();
    return '<div class="plate room-box"><div class="section-bar">Join A Room</div>' +
      '<div class="join-row"><input id="jcode" class="text-input" placeholder="Paste invite code" value="' + esc(state.ui.pendingCode || '') + '" autocomplete="off"></div>' +
      '<div class="join-row" style="margin-top:8px"><input id="jname" class="text-input" placeholder="Your name (their scoreboard)" maxlength="20" value="' + esc(prof.name || '') + '" autocomplete="off"></div>' +
      '<div class="color-row">' + colorDots() + '</div>' +
      '<div id="errmsg" class="error-msg" role="alert"></div>' +
      '<button type="button" class="btn btn-signal btn-block" data-action="join">Join The Room</button></div>';
  }

  function colorDots() {
    var dots = '', i;
    for (i = 0; i < PALETTE.length; i++) {
      dots += '<button type="button" class="color-dot' + (i === state.ui.dot ? ' sel' : '') + '" data-action="pickdot" data-i="' + i +
        '" aria-label="Pick color ' + PALETTE[i].n + '" style="background:' + PALETTE[i].h + '"></button>';
    }
    return dots;
  }

  // Guests rename/recolor themselves from this bar (setup and game).
  function youBar() {
    var prof = Profiles.profile();
    var me = (selfIndex >= 0 && state.players[selfIndex]) ? state.players[selfIndex]
      : { name: prof.name || 'You', color: prof.color };
    var dots = '', i;
    for (i = 0; i < PALETTE.length; i++) {
      dots += '<button type="button" class="color-dot' + (PALETTE[i].h === me.color ? ' sel' : '') +
        '" data-action="youcolor" data-i="' + i +
        '" aria-label="Your color ' + PALETTE[i].n + '" style="background:' + PALETTE[i].h + '"></button>';
    }
    return '<div class="plate you-bar"><div class="section-bar">Your Seat</div>' +
      '<div class="join-row"><input id="you-name" class="text-input" maxlength="20" value="' + esc(me.name) + '" autocomplete="off"></div>' +
      '<div class="color-row">' + dots + '</div>' +
      '<button type="button" class="btn btn-amber btn-block" data-action="yourename">Save Name &amp; Color</button>' +
      '<p class="room-hint">Saves to everyone at the table and sticks for your next game.</p></div>';
  }

  function playerChips() {
    var chips = '', i;
    for (i = 0; i < state.players.length; i++) {
      var p = state.players[i];
      chips += '<div class="player-chip' + (i === selfIndex ? ' me' : '') + '"><span class="swatch" style="background:' + p.color + '"></span>' +
        '<span class="name">' + esc(p.name) + (i === selfIndex ? ' <em class="youd">YOU</em>' : '') + '</span>' +
        (isHost ? '<button type="button" class="rm" data-action="rm" data-i="' + i + '" aria-label="Remove ' + esc(p.name) + '">×</button>' : '') +
        '</div>';
    }
    return chips;
  }

  // 13-turn tracker: a row of pips, lit with every box the player has closed.
  function pips(pl) {
    var n = E.filled(cardOf(pl)), s = '', k;
    for (k = 0; k < 13; k++) s += '<i' + (k < n ? ' class="on"' : '') + '></i>';
    return '<span class="pjips" title="' + n + ' of 13 turns used"><span class="pjrow">' + s +
      '</span><em class="pjlabel">' + n + '/13</em></span>';
  }

  function setup() {
    var localCrew = '';
    if (authority()) {
      localCrew = '<div class="name-field"><input id="pname" class="text-input" maxlength="20" placeholder="Player name" autocomplete="off"></div>' +
        '<div class="color-row">' + colorDots() + '</div>' +
        '<button type="button" class="btn btn-amber btn-block" data-action="addname">Add Player</button>';
    }
    var guestBox = (state.mode === 'online' && !isHost)
      ? (selfIndex >= 0 ? youBar() : joinBox())
      : '';

    return '<div class="hero" style="padding:18px 14px 22px"><div class="wordmark" style="font-size:26px">New Game</div>' +
      '<p class="subtitle" style="font-size:12px">' + (state.mode === 'online' ? 'Play together from anywhere — serverless, invite only' : 'One table, your own dice') + '</p></div>' +
      '<div class="plate stack" style="margin-top:14px">' + modeCards() +
      (state.mode === 'online' ? roomBox() : '') +
      '<div class="section-bar">The Crew</div>' +
      (authority() ? localCrew : '') +
      '<div class="player-list">' + playerChips() + '</div>' +
      '<p class="empty-hint">' + (state.players.length ? '' : (state.mode === 'online' ? 'No players yet — host, add your seat, and share your code above.' : 'No players yet — add at least one.')) + '</p>' +
      '<div id="errmsg" class="error-msg" role="alert"></div>' +
      (authority() ? '<button type="button" class="btn btn-signal btn-block" data-action="start">Start Game</button>' : '<button type="button" class="btn btn-signal btn-block" data-action="join" disabled aria-disabled="true">Waiting for the host to start…</button>') +
      '<button type="button" class="btn btn-carbon btn-block" data-action="menu">Back to Menu</button></div>' +
      guestBox;
  }

  function joining() {
    return '<div class="hero" style="padding:18px 14px 22px"><div class="wordmark" style="font-size:26px">Joining Room…</div></div>' +
      '<div class="plate stack" style="margin-top:14px"><div class="section-bar">Connecting</div>' +
      '<p class="empty-hint">Waiting for the host to accept the dice table. Hang tight.</p>' +
      '<div id="errmsg" class="error-msg" role="alert"></div>' +
      '<button type="button" class="btn btn-carbon btn-block" data-action="menu">Cancel</button></div>';
  }

  function game() {
    var t = state.turn, p = state.players[t.p];
    var card = cardOf(p);
    var dice = t.dice;
    var inPerson = state.mode === 'inperson';
    var actable = myTurn();

    var roster = '';
    for (var i = 0; i < state.players.length; i++) {
      var pl = state.players[i];
      roster += '<span class="who' + (i === t.p ? ' now' : '') + (hasOpen(pl) ? '' : ' done') +
        '" style="background:' + pl.color + '"><span class="chwname">' + esc(pl.name) +
        (i === selfIndex ? ' <em class="youd">YOU</em>' : '') + '</span>' + pips(pl) + '</span>';
    }

    var diceHTML = '';
    for (i = 0; i < 5; i++) diceHTML += dieHTML(dice[i], t.held[i], i, state.mode, actable);

    var trayStatus, rollRow = '';
    if (inPerson) {
      trayStatus = actable ? 'Dice OFF — tap each die to set its value from your real roll.'
        : 'Waiting for ' + esc(p.name) + ' to roll.';
    } else {
      trayStatus = actable ? 'Tap dice to hold — then bank a score.'
        : 'Waiting for ' + esc(p.name) + '. They roll on their own device.';
      rollRow = '<div class="roll-row"><button type="button" class="btn btn-amber" data-action="roll"' +
        ((t.rolls >= 3 || !actable) ? ' disabled aria-disabled="true"' : '') + '>Roll Again (' + t.rolls + '/3)</button></div>';
    }
    var diceBadge = inPerson ? '<span class="active-turn" style="color:' + p.color + '">' + esc(p.name) + ' · SET ROLL · TURN ' + E.turnNumber(card) + ' OF 13</span>'
      : '<span class="active-turn" style="color:' + p.color + '">' + esc(p.name) + ' · Roll ' + t.rolls + '/3 · TURN ' + E.turnNumber(card) + ' OF 13</span>';

    return (remoteMode && !isHost ? youBar() : '') +
      '<div class="roster">' + roster + '</div>' +
      '<div class="plate card"><div class="head"><span class="active-name" style="color:' + p.color + '">' +
      esc(p.name) + '</span>' + diceBadge + '</div>' +
      '<div class="tray">' + diceHTML + '</div>' +
      '<p class="tray-status">' + trayStatus + '</p>' +
      rollRow +
      section(E.UPPER, card, dice, 'Upper Section — Ones to Sixes', actable) +
      section(E.LOWER, card, dice, 'Lower Section', actable) +
      totalsHTML(card) +
      '<div id="errmsg" class="error-msg" role="alert"></div>' +
      '<p class="help">Now rolling: ' + esc(p.name) + '.' + (actable ? ' Precise on 5-of-a-kind? Joker Yahtzee plays light up below.' : ' Everyone sees this card live; only they can tap it.') +
      (remoteMode ? ' · Live room' + (isHost ? ' (host) · scores sync to everyone.' : ' · you play your own turns.') : '') + '</p>' +
      '</div>';
  }

  function over() {
    var ranked = state.players.slice().sort(function (a, b) { return E.totals(values(b.card)).grand - E.totals(values(a.card)).grand; });
    var h = '<div class="hero"><div class="mascot-bubble">Game Over — here sits the champion!</div>' +
      '<div class="wordmark" style="font-size:30px">We Have A Winner</div></div>' +
      '<div class="plate podium" style="margin-top:14px"><div class="section-bar">Final Standings</div>';
    for (var i = 0; i < ranked.length; i++) {
      var p = ranked[i], g = E.totals(values(p.card));
      h += '<div class="row-plate pos' + (i === 0 ? ' winner' : '') + '"><span class="rank">' + (i + 1) + '</span>' +
        '<span class="swatch" style="background:' + p.color + '"></span>' +
        '<span class="nm">' + esc(p.name) + '</span>' +
        '<span class="gt">' + g.grand + '</span>' +
        '<span class="gt ok">' + E.filled(cardOf(p)) + '/13</span></div>';
    }
    h += '<div id="errmsg" class="error-msg" role="alert"></div>' +
      '<button type="button" class="btn btn-signal btn-block" data-action="newgame">New Game</button>' +
      '<button type="button" class="btn btn-amber btn-block" data-action="hall">The Hall — Stats &amp; Standings</button>' +
      '<button type="button" class="btn btn-carbon btn-block" data-action="menu">Back to Menu</button>' +
      '</div>';
    return h;
  }

  function hall() {
    var t = Profiles.top(20), rows = '', i, mine = null;
    var prof = Profiles.profile();
    for (i = 0; i < t.length; i++) {
      var s = t[i];
      if (s.id === prof.id) mine = s;
      rows += '<div class="row-plate pos' + (i === 0 ? ' winner' : '') + '"><span class="rank">' +
        (i === 0 ? '★' : (i + 1)) + '</span>' +
        '<span class="swatch" style="background:' + (s.color || '#8492c4') + '"></span>' +
        '<span class="nm">' + esc(s.name || 'Mystery Player') + '</span>' +
        '<span class="gt">W ' + (s.w || 0) + '</span>' +
        '<span class="gt">G ' + (s.g || 0) + '</span>' +
        '<span class="gt">Best ' + (s.best || 0) + '</span></div>';
    }
    return '<div class="hero" style="padding:18px 14px 22px"><div class="wordmark" style="font-size:26px">The Hall</div>' +
      '<p class="subtitle" style="font-size:12px">Stats live on this device — every game, every seat.</p></div>' +
      '<div class="plate stack" style="margin-top:14px"><div class="section-bar">Career Leaderboard</div>' +
      (t.length ? rows : '<p class="empty-hint">No games recorded yet — deal your first and come back.</p>') +
      '<div class="section-bar" style="margin-top:12px">Your Device Profile</div>' +
      (mine
        ? '<p class="room-hint">' + esc(mine.name) + ' · Wins ' + mine.w + ' · Games ' + mine.g + ' · Best ' + mine.best +
          ' · Yahtzees ' + mine.yaz + ' · Win streak ' + mine.streak + '</p>'
        : '<p class="room-hint">You have no record on this device yet — join a room or add a seat and play.</p>') +
      '<div id="errmsg" class="error-msg" role="alert"></div>' +
      '<button type="button" class="btn btn-signal btn-block" data-action="newgame">New Game</button>' +
      '<button type="button" class="btn btn-carbon btn-block" data-action="menu">Back to Menu</button></div>';
  }

  function crumb() {
    if (state.phase === 'game' || state.phase === 'over') return '<span>Scorecard 2001</span>';
    if (state.phase === 'setup') return '<span>Setup</span>';
    if (state.phase === 'joining') return '<span>Joining</span>';
    if (state.phase === 'hall') return '<span>The Hall</span>';
    return '<span>Welcome</span>';
  }

  function render() {
    var main;
    if (state.phase === 'menu') main = menu();
    else if (state.phase === 'setup') main = setup();
    else if (state.phase === 'joining') main = joining();
    else if (state.phase === 'hall') main = hall();
    else if (state.phase === 'game') main = game();
    else main = over();

    document.getElementById('app').innerHTML =
      '<div id="wrap">' + nav() +
      '<div class="subnav"><span class="crumb">Menu</span><span>›</span>' + crumb() +
      (state.mode ? '<span class="crumb" style="margin-left:auto">' + (state.mode === 'online' ? '● Online' : '● In Person') + '</span>' : '') +
      '</div><main>' + main + '</main>' +
      '<footer class="footer halftone"><p>©1997–2001 Yahtzee 2001 · companion to real dice · P2P over WebRTC — no server, no sign-up</p></footer></div>';
  }

  function init() {
    var hash = '';
    try { hash = window.location.hash || ''; } catch (e) {}
    var jm = hash.match(/#j=([^&]+)/);
    if (jm) pendingJoin = decodeURIComponent(jm[1]);
    selfIndex = -1;

    // every device has a persistent identity — seeded with a friendly nickname
    var prof = Profiles.profile();
    if (!prof.name) { prof.name = Profiles.nick(); Profiles.saveProfile(prof); }

    var s = load();
    if (s && s.players && s.players.length && !pendingJoin) {
      state = s;
      state.phase = s.turn && s.turn.dice && s.turn.dice.length === 5 ? 'game' : 'setup';
    } else if (pendingJoin) {
      state = { phase: 'setup', mode: 'online', players: [], ui: { dot: 0, pendingCode: pendingJoin } };
    } else {
      state = { phase: 'menu', mode: 'inperson', players: [], ui: { dot: 0 } };
    }
    render();
    if (pendingJoin && state.phase === 'setup') {
      var autoJoin = state.ui && state.ui.pendingCode;
      state.phase = 'joining';
      render();
      joinRoom(autoJoin);
    }
  }

  // ---------- events ----------
  document.getElementById('app').addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== this && !el.dataset.action) el = el.parentNode;
    if (!el || el === this) return;
    var fn = ACTIONS[el.dataset.action];
    if (!fn) return;
    ev.preventDefault();
    fn.call(el, ev);
  });

  // ---------- init ----------
  init();
})();