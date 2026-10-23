# Claude Code Brief — "Dodge Arena" M0 (top-down survival prototype)

Working title: `dodge-arena-proto` (placeholder; private study build, not for release).
Reference: YouTube Playables "DON'T TOUCH THE RED" by The King Of Shorts. Reproduce the loop and feel, not the name, copy or exact look.

## Goal

A top-down survival arena: drag a small square around a grid, grab coins, never touch red. Done when a new player gets it in under 5 seconds, a run restarts in under 300 ms, and the difficulty curve keeps an average player alive 45–90 seconds.

## Observed reference (from gameplay screenshots)

- Dark arena with a faint square grid, wide landscape playfield.
- Player: small glowing cyan rounded square.
- Coins: small glowing yellow dots scattered across the arena.
- Hazards: red bars (horizontal and vertical), red circles, and a red half-dome rising out of a bar (likely a spawn/telegraph animation).
- HUD: SCORE and BEST top-left, LEVEL N top-right (cyan), pause button.
- Start card: title, "Drag or WASD to move. Collect coins. Avoid red. How long can you survive?", one PLAY button.

## Assumed rules (verify in play; all values in `src/content/tuning.json`)

1. Player moves with relative drag on touch (finger anywhere, cube follows the drag delta, never hidden under the finger) or WASD/arrows. Clamped to the arena.
2. Coins spawn at random safe spots, a few on screen at once. Each coin = +1 score (or +10; tune).
3. Red hazards spawn with a short telegraph (fade/grow-in, no collision during the telegraph), then move: bars slide or sweep across the arena, circles drift and bounce or home slowly.
4. Level rises every N coins or every T seconds. Each level adds hazard count, speed, or a new hazard type.
5. Touch red = run over. Score and best shown; one tap restarts.

## Hazard vocabulary (introduced in this order by the curve)

| Level | New hazard | Behavior |
| --- | --- | --- |
| 1 | Static bar | Appears with telegraph, stays a few seconds, fades |
| 2 | Sliding bar | Crosses the arena in a straight line |
| 3 | Bouncer circle | Drifts and reflects off walls |
| 4 | Rotating bar | Spins around its center |
| 5 | Seeker circle | Slowly steers toward the player, despawns after a time |
| 6 | Laser line | Thin telegraph line, then full-width beam for 0.3 s |
| 7+ | Combinations and speed ramps | No new types; denser mixes |

## Architecture

```
src/
  sim/        pure TS, no renderer imports
    types.ts      Vec2, Player, Coin, Hazard {kind, shape, motion, state, telegraphMs}, RunState
    rng.ts        shell DeterministicRngRegistry; streams "hazards", "coins", "fx"
    hazards.ts    one motion function per hazard kind
    spawner.ts    spawn director: budget per level, safe-distance from player, never spawn a kill on the player
    curve.ts      level -> hazard budget, speeds, unlocked kinds; breather after each level-up
    collide.ts    player AABB vs boxes, circles, rotated boxes, lines; fixed 120 Hz step
    step.ts       step(state, input, dt) -> state
  view/       Phaser scene reading sim state only
    arena.ts      grid, glow, hazard and coin sprites, telegraph animations
    fx.ts         coin pop, death burst, level-up flash
    hud.ts        score, best, level, pause
  main.ts
tests/
  fairness.test.mjs    10,000 seeds: no hazard ever spawns overlapping the player or within 1.5 player-widths
  determinism.test.mjs same seed + input log -> identical RunState hash
  bot.test.mjs         simple dodge bot (repel from red, attract to coins) survives median 45–90 s; level 1 survival > 95%
```

## Stack and placement

- Scaffold: `node tools/create-slu-game.mjs --id dodge-arena-proto --name "Dodge Arena Proto" --renderer phaser --frames arcade`
- Depend on `@slu/web-shell` (mikeylambo/Web-Game-Shell-v1.02). Don't modify the shell; log missing pieces in `SHELL_GAPS.md`.
- TypeScript strict, Vite.

## Fairness rules

- Every hazard telegraphs at least 0.5 s before it can kill.
- Player hitbox 80% of its visual; red hitboxes 100% of visual.
- After a level-up, 2 s with no new spawns.

## Juice

- Coin: pop, small scale bounce on the player, rising pitch on quick consecutive pickups.
- Near-miss (red within 0.3 player-widths): spark plus tick SFX.
- Level-up: arena flash, LEVEL text punch, one musical sting.
- Death: 120 ms hitstop, red burst, dim, instant restart on tap.

## Shell integration

- Daily mode via `scheduledSeed("dodge-arena-proto", "daily")`.
- Best score through shell save; `LocalLeaderboardProvider` with a seam for the Vercel shared leaderboard.
- `GhostStore` + `InputReplay`: optional ghost of your best run.
- `AudioLifecycleCoordinator` pause on blur.
- Telemetry: `run_start`, `coin`, `level_up`, `near_miss`, `death {level, hazardKind, survivedMs}`, `restart_ms`.

## Casual flow

Skip the start card after the first run. First load: card with one PLAY button (no paragraph; show the controls as a looping hand-drag hint over the arena instead). Every later death: tap anywhere to restart.

## Done when

- [ ] `npm test` green: fairness, determinism, bot survival band.
- [ ] Restart ≤ 300 ms measured.
- [ ] 60 fps on a mid-range phone with 40 hazards on screen.
- [ ] Drag works on iOS Safari and Android Chrome; WASD on desktop.
- [ ] Daily mode and best score persist.

## Out of scope

Art pass, final name, meta progression, Playables SDK wiring, monetization.
