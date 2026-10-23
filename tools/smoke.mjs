/**
 * Headless-Chrome smoke test over CDP (no extra deps; Node 22+ global WebSocket).
 * Usage: start `npm run dev -- --port 5199`, then `node tools/smoke.mjs [url] [outDir]`.
 * Captures screenshots of card → play → death → restart, reports console errors and restart_ms.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const url = process.argv[2] ?? "http://localhost:5199/";
const out = process.argv[3] ?? "/tmp/dodge-smoke";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800), MOBILE = process.env.MOBILE === "1";
mkdirSync(out, { recursive: true });
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/dodge-chrome-${Date.now()}`,
  `--window-size=${W},${H}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "about:blank"], { stdio: "ignore" });

let ws, id = 0;
const pending = new Map();
const errors = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(t => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.addEventListener("message", ev => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
          if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value ?? a.description).join(" "));
        });
        if (ws.readyState !== 1) {
          await new Promise(r => ws.addEventListener("open", r, { once: true }));
        }
        break;
      }
    } catch { /* not up yet */ }
    await sleep(200);
  }
}
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
const shot = async name => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, "base64")); };

try {
  await connect();
  await send("Runtime.enable"); await send("Page.enable");
  if (MOBILE) await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url });
  await sleep(2500);
  await evaluate("localStorage.clear()");
  await send("Page.reload"); await sleep(2500);
  await shot("1-card");
  await evaluate("document.getElementById('btn-play').click()");
  // Wiggle with keys for a few seconds.
  const keys = ["KeyD", "KeyS", "KeyA", "KeyW"];
  for (let i = 0; i < 12; i++) {
    const k = keys[i % 4];
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'${k}'}))`);
    await sleep(350);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keyup',{code:'${k}'}))`);
    if (i === 2) await shot("2-hint");
  }
  await shot("3-play");
  const mid = await evaluate("(() => { const g = __dodge.game; const s = g.run.state; return { phase: g.phase, t: s.time, level: s.level, hazards: s.hazards.length, coins: s.coins.length, score: s.score, restartMs: g.lastRestartMs }; })()");
  console.log("mid-run:", mid);
  // Walk into a hazard to test death & game-over screen quickly.
  await evaluate(`(() => {
    const g = __dodge.game;
    const s = g.run.state;
    const h = s.hazards.find(x => x.age >= x.telegraph) || s.hazards[0];
    if (h) {
      h.age = Math.max(h.age, h.telegraph + 0.05); // ensure lethal
      s.player.x = h.x;
      s.player.y = h.y;
    }
  })()`);
  for (let i = 0; i < 30; i++) { if ((await evaluate("__dodge.game.phase")) === "over") break; await sleep(100); }
  await sleep(300);
  await shot("4-over");
  const over = await evaluate("(() => { const g = __dodge.game; return { phase: g.phase, result: g.lastResult, events: g.telemetry.events?.length ?? null }; })()");
  console.log("over:", over);
  await sleep(400);
  await evaluate("document.getElementById('game').dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,bubbles:true,clientX:300,clientY:300}))");
  await sleep(300);
  const after = await evaluate("(() => { const g = __dodge.game; return { phase: g.phase, restartMs: g.lastRestartMs, best: g.persistence.data.best }; })()");
  console.log("after restart:", after);
  await shot("5-restarted");
  console.log("errors:", errors.length ? errors : "none");
  console.log(`screenshots in ${out}`);
} finally {
  ws?.close(); chrome.kill();
}
