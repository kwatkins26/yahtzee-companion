# Yahtzee 2001 — Companion Scorecard

**Play it live: https://kwatkins26.github.io/yahtzee-companion/**

A retro Nintendo-2001-inspired web companion for real-life Yahtzee games. Roll the physical dice, tap in the scores, let this app handle the totals, the upper-section bonus, and the joker-yahtzee bonuses.

## What is this?

This is the modern rebuild of the original Kivy/Python `yahtzee_companion` project (found in `../yahtzee_companion`). The old app was half-finished (empty engine files, no real scoring, broken leaderboard, hardcoded stubs). This web version completes it.

**What you get:**
- **Full Yahtzee scoring** — upper section (Ones → Sixes), upper-section bonus (≥63 → +35), all lower-section categories, and joker Yahtzee bonuses (+100 per extra 5-of-a-kind)
- **Turn-based multiplayer** — add up to 12 players with color tokens; turns auto-advance after each score entry
- **Two ways to play** — choose on the New Game screen:
  - **In Person** — real dice at the table. The on-screen dice are *off*: tap each to set the value from your physical roll. No roll button, no rng.
  - **Online** — dice *on*. You roll and hold the shared table (Roll again up to 3/3), and friends play from anywhere
- **Serverless online rooms** — host a room, share by invite link, system share sheet, or QR code; friends join on any device over WebRTC (PeerJS) — no account, no server to run. Scores sync live both ways. Placement is device-aware: a phone leads with the Share Sheet (a phone camera can't scan its own screen), a desktop/tablet leads with the QR
- **13-turn tracker** — every player's roster chip carries a 13-pip progress track (N/13), and the active player's header reads `TURN N OF 13` as the game unrolls
- **Suggested scores** — the best open box highlights in amber; open rows show their current suggested value
- **Zero-safe** — if you have nowhere to score, tap any open row (even at 0) to move on
- **Persistence** — all scores save automatically to `localStorage`; close the tab, come back, continue
- **Standings** — at game end, a winner is crowned with ranked final totals

## Design Compass

The UI follows the **Nintendo.com (2001)** design system (Y2K console-chrome aesthetic) from the [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) repo. The full design spec lives alongside the code as `DESIGN.md`.

Key design signatures:
- **Periwinkle chrome plates** with hard beveled edges (no rounded-corner Material look)
- **Carbon navy command bars** with halftone dot-matrix texture
- **Warm wayfinding only**: amber for utility, orange for forward actions, gold for nav words
- **Outlined box-art wordmarks** (Arial Black + text-stroke + drop shadow)
- **Sharp/chamfered corners by default**, rounding only on pills and action circles

## How to run

No build step. Open the HTML — that's it. Online mode needs internet (PeerJS contacts its free relay to ring the two browsers together).

```bash
# Option 1: solo / in-person — just open the file directly
open index.html

# Option 2: serve locally (REQUIRED when a phone joins from the same Wi-Fi)
python3 -m http.server 8000
# then on this Mac open http://localhost:8000
```

### Playing online with a phone

A `file://` link is only readable on the machine it lives on — a phone can never open it. The invite must be an `http://` address.

1. From the `yahtzee_web` folder run `python3 -m http.server 8000`
2. Find this computer's network address (the phone needs to reach it): `ipconfig getifaddr en0` (Mac), or look in System Settings › Wi-Fi
3. On the Mac, open **`http://localhost:8000`** (not `index.html` from disk)
4. On the phone (same Wi-Fi), open **`http://<that-address>:8000`** — then paste/scan the invite link the Mac's room shows

Served that way, the invite link the app copies is already the right `http://…` URL and just works. If the app was opened from disk, it now detects that and shows this same guidance instead of a useless link.

Works in any modern browser (Chrome, Firefox, Safari). Responsive down to phone-sized screens.

## Run the tests

```bash
# Scoring engine — the money-path check (no browser needed)
node tests/test_engine.js

# Full smoke test — plays in-person AND online games end-to-end in headless
# Chrome, including a live two-tab P2P join over the real PeerJS relay
node tests/smoke.cdp.js
```

## Architecture

```
yahtzee_web/
├── index.html           — app shell (engine + vendored PeerJS + app, no build step)
├── css/style.css        — Nintendo 2001 console-chrome design tokens + components
├── js/engine.js         — pure scoring engine + dice (shared by UI and tests, runs in both browser and Node)
├── js/app.js            — state machine, turn logic, rendering, P2P rooms, localStorage persistence
├── lib/peerjs.min.js    — vendored PeerJS (WebRTC signaling; only network touchpoint)
├── tests/test_engine.js — one runnable check for the scoring money path (node)
├── tests/smoke.cdp.js   — integration smoke: headless Chrome plays full games (dev check)
├── DESIGN.md            — full Nintendo 2001 design system (design compass)
└── README.md            — you are here
```

## How it works (quick)

1. **Menu** → start a new game (or continue a saved one)
2. **Setup** → pick **In Person** or **Online**, add players, hit Start
   - *Online*: your room code + invite link appear; friends open the link (or paste the code) from any device
3. **Game** → each turn in *online*: roll dice (up to 3 rolls, tap to hold) — tapping the roll button is shared across everyone in the room. In *in person*: tap each on-screen die to match your real throw. Either way, tap a score box to bank the score
4. **End** → after all 13 boxes are filled for all players, the final standings appear

**Host rules:** the room host's device owns the table — guests send moves (join, roll, hold, score) and the host broadcasts every resulting state back. Close the tab and everyone risks losing the room; local scores that were saved on the host can be resumed later.

**Yahtzee joker rule:** Once the Yahtzee box holds 50, any extra 5-of-a-kind gives you +100 bonus points — you can either claim the joker boost or tap any other open box for its joker-enhanced value.

## Development philosophy

Built using **[ponytail](https://github.com/DietrichGebert/ponytail)** principles:

- YAGNI: no framework, no router, no build step
- Reuse: scored logic lives in one shared file (`engine.js`) used by both UI and tests
- Stdlib: `Math.random`, `localStorage`, `JSON`, the browser's native WebRTC
- Native: real `<button>` elements, CSS custom properties, no picker libs
- Installed-deps floor: PeerJS is the single vendored dependency — and only because serverless multi-device sync is otherwise on you
- One runnable check: `node tests/test_engine.js` for the scoring money path
- Non-negotiables: input validation, data-loss prevention (localStorage), accessibility basics (real buttons, aria-pressed on dice, focus-visible outlines)

## License

MIT — use it however you want.
