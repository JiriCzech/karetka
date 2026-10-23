import fs from "node:fs/promises";
import path from "node:path";

const PORT = process.env.CDP_PORT || 9224;
const URL = process.env.BASE_URL || "http://127.0.0.1:8080/";
const LABEL = process.argv[2] || "run";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("No page target");

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const m = JSON.parse(event.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  mouse(type, x, y, buttons = 0) {
    return this.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: type === "mouseMoved" ? "none" : "left",
      buttons,
      clickCount: type === "mouseMoved" ? 0 : 1,
      pointerType: "mouse",
    });
  }
  close() { this.ws.close(); }
}

const cdp = new CDP(page.webSocketDebuggerUrl);
await cdp.open();
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Performance.enable");
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Emulation.setDeviceMetricsOverride", {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await cdp.send("Page.navigate", { url: URL + "?perf=" + Date.now() });
for (let i = 0; i < 100; i += 1) {
  try {
    if (await cdp.eval("Boolean(window.CardEngineDemo && window.CardEngineDemo.engine.state.hand.length >= 5)")) break;
  } catch {}
  await sleep(100);
}
await sleep(1000);
await cdp.eval(`(() => {
  window.__perf = { frames: [], longTasks: [], running: true };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__perf.longTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ entryTypes: ['longtask'] });
  let last = performance.now();
  function tick(now) {
    if (!window.__perf.running) return;
    window.__perf.frames.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})()`);

const metricsBefore = await cdp.send("Performance.getMetrics");
const deck = await cdp.eval(`window.CardEngineDemo.renderer.deckStack.getBoundingClientRect().toJSON()`);
const deckButton = await cdp.eval(`window.CardEngineDemo.renderer.deckZone.getBoundingClientRect().toJSON()`);
const play = await cdp.eval(`window.CardEngineDemo.renderer.playZone.getBoundingClientRect().toJSON()`);
const mutations = await cdp.eval(`(() => {
  window.__deckMutations = { childList: 0, attributes: 0 };
  const target = window.CardEngineDemo.renderer.deckStack;
  new MutationObserver((list) => {
    for (const entry of list) {
      if (entry.type === 'childList') window.__deckMutations.childList += 1;
      else if (entry.type === 'attributes') window.__deckMutations.attributes += 1;
    }
  }).observe(target, { childList: true, subtree: true, attributes: true });
  window.__deckTopBefore = window.CardEngineDemo.renderer.deckTopEl;
  return true;
})()`);

// Five rapid draws via the actual button.
for (let i = 0; i < 5; i += 1) {
  await cdp.mouse("mouseMoved", deck.left + deck.width / 2, deck.top + deck.height / 2);
  await cdp.mouse("mousePressed", deck.left + deck.width / 2, deck.top + deck.height / 2, 1);
  await cdp.mouse("mouseReleased", deck.left + deck.width / 2, deck.top + deck.height / 2, 0);
  await sleep(120);
}
await sleep(900);

// Choose a card point and drag it into the play zone.
const point = await cdp.eval(`(() => {
  const d = window.CardEngineDemo;
  const hand = d.engine.state.hand;
  const card = hand[hand.length - 1];
  const v = d.renderer.views.get(card.instanceId);
  const r = v.getRect();
  for (let yi = 1; yi < 12; yi += 1) for (let xi = 1; xi < 12; xi += 1) {
    const x = r.left + r.width * xi / 12;
    const y = r.top + r.height * yi / 12;
    if (d.renderer.hitTestHand(x, y) === card.instanceId) return { x, y, id: card.instanceId };
  }
  return null;
})()`);
if (!point) throw new Error("No grab point");
await cdp.mouse("mouseMoved", point.x, point.y);
await sleep(100);
await cdp.mouse("mousePressed", point.x, point.y, 1);
await sleep(50);
const target = { x: play.left + play.width / 2, y: play.top + play.height / 2 };
for (let i = 1; i <= 20; i += 1) {
  await cdp.mouse("mouseMoved", point.x + (target.x - point.x) * i / 20, point.y + (target.y - point.y) * i / 20, 1);
  await sleep(16);
}
await sleep(300);
await cdp.mouse("mouseReleased", target.x, target.y, 0);
await sleep(1200);

const metricsAfter = await cdp.send("Performance.getMetrics");
const perf = await cdp.eval(`(() => {
  window.__perf.running = false;
  const frames = window.__perf.frames.slice(5);
  const sorted = frames.slice().sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
  return {
    frames: frames.length,
    mean: frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length),
    p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: Math.max(...frames, 0),
    over20: frames.filter((f) => f > 20).length,
    over33: frames.filter((f) => f > 33).length,
    longTasks: window.__perf.longTasks,
    deckMutations: window.__deckMutations,
    deckTopStable: window.__deckTopBefore === window.CardEngineDemo.renderer.deckTopEl,
    deckLayerCount: document.querySelectorAll('.deck-layer').length,
    discardEdges: document.querySelectorAll('.discard-edge:not(.is-hidden)').length,
    counts: window.CardEngineDemo.engine.getCounts()
  };
})()`);

const pickMetrics = (list) => Object.fromEntries(list.metrics.map((m) => [m.name, m.value]));
const before = pickMetrics(metricsBefore);
const after = pickMetrics(metricsAfter);
const diff = {};
for (const key of Object.keys(after)) {
  if (typeof after[key] === "number" && typeof before[key] === "number") {
    const value = after[key] - before[key];
    if (value !== 0) diff[key] = value;
  }
}
console.log(JSON.stringify({ label: LABEL, perf, metrics: diff, errors: cdp.errors }, null, 2));
await fs.mkdir(path.resolve("tests", "perf"), { recursive: true });
await fs.writeFile(
  path.resolve("tests", "perf", `${LABEL}.json`),
  JSON.stringify({ perf, metrics: diff }, null, 2)
);
cdp.close();
