# HANDOFF: build status

This is a living checklist. If a session stops mid-build, the next one (you or Claude Code) picks up from here.

## Done
- [x] Shell vendored at `vendor/web-shell` (mikeylambo/Web-Game-Shell-v1.02 `main` @ 6f08d17, v1.1.0), unmodified.
- [x] `src/sim/*`: pure TypeScript deterministic sim at a 120 Hz fixed step. Includes all six hazard kinds, the spawn director, difficulty curve, collision (AABB/circle/OBB SAT), coins, combo, near-miss, and the level-up breather.
- [x] `src/content/tuning.json`: every gameplay number lives here.
- [x] `src/sim/bot.ts` + `tools/bot-report.ts`: run with `npm run bot -- 500 [portrait]`.
- [x] `src/sim/replay.ts`: records in the shell's `InputReplayRecorder` format; `replayRun()` re-simulates a run from it.
- [x] `npm test` passes: fairness (10k seeds), determinism, and the bot survival band (median about 66–69 s, level-1 survival 100%).
- [x] View/app layer: `src/view/{arena,fx,hud,palette}.ts`, `src/app/{game,input,audio,persistence}.ts`, `src/main.ts`, `index.html`, `src/styles.css`.
- [x] `tsc --noEmit` is clean and `vite build` succeeds.
- [x] Headless Chrome smoke test (`tools/smoke.mjs`): the start card and gameplay render correctly (screenshots checked).
- [x] `SHELL_GAPS.md` written.

## Next (in order)
1. **Finish the smoke run.** Start `npm run dev -- --port 5199`, then run `node tools/smoke.mjs` (needs permission to launch Chrome). It was stopped during the "idle until death → over screen → tap restart" step, so that part hasn't been checked yet. Confirm the over screen appears, the restart is under 300 ms (`restartMs`), and the console shows no errors. Mobile layout: `MOBILE=1 W=390 H=844 node tools/smoke.mjs`.
2. **Play it yourself:** `npm run dev`, open `http://localhost:5173/`.
   - Debug overlay: `?dev=1` (fps, hazard count, restart ms, seed).
   - Perf stress: `?dev=1&stress=40` (starts at level 20, death disabled). Check 60 fps on a mid-range phone.
   - Phone testing: `npm run dev` already binds to the LAN (`server.host: true`). Check drag on iOS Safari and Android Chrome.
3. **Feel pass:** tune values in `tuning.json` (player speed, telegraph times, sizes). After any change, run `npm run bot -- 500` and `npm run bot -- 300 portrait` and keep the medians between 45 and 90 s; `npm test` enforces this.
4. **Git:** `git init`, commit, add remote `https://github.com/mikeylambo/DodgeArena` (the repo is currently empty), and push. `node_modules`/`dist` are already gitignored; `vendor/web-shell` is meant to be committed.
5. **M1 (the agreed twist):** add *Turn the tables* (every N coins → 3 s predator mode where you can eat red) and *Bank or bust* (carried coins only count once banked at a drifting zone; dying loses them). Both go in the sim as new state, events, and tuning entries. Add fairness and bot tests for them before any view work. Music-driven spawns come after that.

## Known notes
- The arena uses fixed world sizes: 1600×900 landscape and 900×1600 portrait, picked at run start from the viewport shape. Daily scores are per orientation (the ghost id includes orientation).
- Determinism is guaranteed per JS engine. `Math.sin`/`atan2` can differ across browsers, so verifying a replay on a server needs the same engine.
- Bundle is about 1.25 MB, mostly Phaser (see SHELL_GAPS #6).
