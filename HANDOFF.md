# HANDOFF: build status

Living checklist for Dodge Arena.

## Status: M1 "Turn the Tables" shipped (on top of verified M0)

- [x] **Frenzy / Turn the Tables**: every 15 coins (HUD meter under BEST), the arena inverts for 3.0 s. Hazards turn cyan and tremble, the player turns red. Touching a hazard eats it for chained points: 25 → 50 → 100 → 200 → 400 (capped). Lasers are cleared and can't spawn mid-frenzy. The last 0.9 s blink as a warning, and 0.6 s of flicker-immunity follows. Tuning lives in `tuning.json → frenzy`.
- [x] Bot hunts during frenzies. Median survival is now ~80 s (still inside the 45–90 s band), with 100% level-1 survival. `tests/frenzy.test.mjs` covers the trigger, scoring, laser rule, and no deaths during frenzy or grace.
- [x] **Light-trail lasso**: the cube leaves a trail capped at 900 units and 1.1 s. When the trail crosses itself, every non-laser hazard inside the closed loop is destroyed for 30 × n² points. Loops smaller than 2500 units² are ignored. Tuning lives in `tuning.json → lasso`, tests in `tests/lasso.test.mjs`.
- [x] **Grazing charges Frenzy**: each near miss adds `frenzy.grazeCharge` (1) toward the 15-point meter, the same as a coin.
- [x] **Grid warp**: the grid acts as a membrane. The cube bulges it, more at speed, and coins, eats, lassos (an inward implosion), level-ups, frenzy, and death send ripples through it. View-only (`ArenaView.drawWarpGrid`).
- [x] Dev: with `?dev=1`, `window.__game` is exposed for console tuning, e.g. `__game.run.state.frenzyCharge = 14`.

- [x] **Shell Vendoring**: Vendored at `vendor/web-shell` (mikeylambo/Web-Game-Shell-v1.02 `main` @ 6f08d17, v1.1.0), unmodified.
- [x] **Simulation Core (`src/sim/*`)**:
  - Pure TypeScript deterministic sim running at 120 Hz fixed step.
  - All 6 hazard types implemented with SAT collision checks: `static`, `slider`, `bouncer`, `rotor`, `seeker`, `laser`.
  - Fair spawn director: never spawns overlapping or within 1.5 player-widths of the player.
  - Difficulty curve: escalates hazard budget, speed, and types; includes a 2.0s breather after level-up.
  - Coins, combo multiplier, near-miss detection, and hitstop.
- [x] **Tuning (`src/content/tuning.json`)**: All speeds, timings, dimensions, and weights are externalized in pure JSON.
- [x] **Bot Verification (`src/sim/bot.ts`, `tools/bot-report.ts`)**:
  - Dodge bot tuned for human-like reaction (~300ms, 12Hz decisions).
  - Survives 45–90s median (measured: ~69s landscape, ~66s portrait) with 100% Level-1 survival across 400+ seeds.
- [x] **Determinism & Replay (`src/sim/replay.ts`)**:
  - `InputReplayRecorder` / `TickInputRecorder` integration.
  - Test verified: same seed + input log produces bit-identical `RunState` hashes.
- [x] **Automated Test Suite (`npm test`)**: 8/8 tests passing (10,000-seed fairness test, determinism, replay roundtrip, bot survival band).
- [x] **View & Presentation (`src/view/*`, `src/app/*`)**:
  - Phaser 3 canvas with retina DPR scaling (up to 2x DPR).
  - Relative-drag touch controls (finger anywhere, cube follows drag delta 1:1, never hidden under thumb) + WASD/arrows.
  - WebAudio synth SFX matching the shell's `AudioSystem` contract + pause on visibility/blur.
  - Shell `BrowserStorage`, `SaveManager`, and persistent `StorageLeaderboardProvider`.
  - Replay and best-run ghost capture with `PoseGhostRecorder`.
- [x] **Build & Verification (`npm run check`, `npm run build`)**: Strict TypeScript clean, Vite production bundle builds without errors.
- [x] **End-to-End Headless Smoke Test (`tools/smoke.mjs`)**:
  - Verified card -> play -> death -> game-over screen -> instant restart.
  - Measured restart latency: **37–50 ms** (far exceeding the ≤ 300 ms requirement).
  - 0 console or runtime errors.
- [x] **Git Repository**: Initialized, committed initial release, linked to `origin` (`https://github.com/mikeylambo/DodgeArena.git`).
- [x] **Documentation**: `SHELL_GAPS.md` and `HANDOFF.md` documented.

---

## How to Play & Test Locally

1. **Dev Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173/` in your browser.
   - For debug stats (FPS, active hazards, restart latency ms, seed): add `?dev=1`
   - For 40-hazard stress test: add `?dev=1&stress=40` (starts at Level 20 with immortality)
   - For mobile testing on LAN: open the local IP displayed by Vite on your phone.

2. **Automated Verification**:
   ```bash
   npm test               # Run unit tests (fairness 10k seeds, determinism, bot survival)
   npm run bot -- 500     # Run 500-seed simulation benchmark
   npm run check          # Run TypeScript typechecker
   npm run build          # Test production Vite build
   ```

---

## What's Next (Roadmap)

1. **Push Initial Commit to Remote**:
   When you're ready to sync to GitHub:
   ```bash
   git push -u origin main
   ```
2. **Feel Pass & Tuning**:
   Tweak player speed, hazard telegraphs, or hitbox sizes in `src/content/tuning.json`. Run `npm test` after any edits to keep the bot survival band within 45–90 seconds.
3. **M1 Feature Implementation (The Core Flips)**:
   - **Bank or Bust**: Unbanked coins are carried at risk and only score when dropped at a drifting bank zone. Dying forfeits unbanked coins.
   - **Music-driven spawns**: Sync hazard waves to your custom beats/tracks.
