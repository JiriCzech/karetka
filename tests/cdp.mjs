import fs from "node:fs/promises";
import path from "node:path";

const CDP_PORT = process.env.CDP_PORT || 9223;
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080/";
const OUT_DIR = path.resolve("tests", "screens");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPageTarget() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No page target in Chrome.");
  return page;
}

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.errors = [];
    this.ws = null;
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(
          message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text
        );
      }
      if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        this.errors.push(message.params.entry.text);
      }
      const listeners = this.events.get(message.method);
      if (listeners) listeners.forEach((listener) => listener(message.params));
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    if (!this.events.has(method)) this.events.set(method, new Set());
    this.events.get(method).add(listener);
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description || result.exceptionDetails.text
      );
    }
    return result.result.value;
  }

  async screenshot(name) {
    const result = await this.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await fs.mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, name);
    await fs.writeFile(file, Buffer.from(result.data, "base64"));
    return file;
  }

  async mouseMove(x, y, buttons = 0) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      buttons,
      pointerType: "mouse",
    });
  }

  async mouseDown(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse",
    });
  }

  async mouseUp(x, y) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse",
    });
  }

  async click(x, y) {
    await this.mouseMove(x, y);
    await sleep(50);
    await this.mouseDown(x, y);
    await sleep(50);
    await this.mouseUp(x, y);
  }

  async drag(from, to, { pauseAtEnd = 140, beforeReleaseShot = null } = {}) {
    await this.mouseMove(from.x, from.y);
    await sleep(120);
    await this.mouseDown(from.x, from.y);
    await sleep(80);
    const steps = 14;
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await this.mouseMove(x, y, 1);
      await sleep(18);
    }
    await sleep(pauseAtEnd);
    if (beforeReleaseShot) await this.screenshot(beforeReleaseShot);
    await this.mouseUp(to.x, to.y);
  }

  close() {
    this.ws.close();
  }
}

async function waitForApp(cdp) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const ready = await cdp.evaluate(
        `Boolean(window.CardEngineDemo && window.CardEngineDemo.engine.state.hand.length >= 5)`
      );
      if (ready) return;
    } catch {
      // Still navigating.
    }
    await sleep(100);
  }
  throw new Error("App did not become ready.");
}

const failures = [];
function check(name, condition, details = "") {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures.push(`${name} ${details}`);
    console.log(`FAIL ${name} ${details}`);
  }
}

async function snapshot(cdp) {
  return cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    return {
      counts: d.engine.getCounts(),
      power: d.gameState.power,
      hovered: d.renderer.hoveredId,
      dragging: d.renderer.draggingId,
      dragActive: Boolean(d.interactions.drag),
      zono: d.renderer.playZone.className,
      toast: document.getElementById('toastHost').innerText,
      hand: d.engine.state.hand.map(c => {
        const v = d.renderer.views.get(c.instanceId);
        return { id: c.instanceId, name: c.definition.name, effect: c.definition.effect, disposition: c.definition.disposition, mode: v ? v.mode : null, scale: v ? v.pose.scale : null, z: v ? v.pose.z : null };
      }),
      discardTop: d.renderer.discardTopId,
      viewCount: d.renderer.views.size,
      activeTweens: d.renderer.animator.tweens.size
    };
  })()`);
}

async function pointForCard(cdp, id) {
  return cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const v = d.renderer.views.get(${JSON.stringify(id)});
    if (!v) return null;
    const r = v.getRect();
    for (let yi = 1; yi < 12; yi += 1) {
      for (let xi = 1; xi < 12; xi += 1) {
        const x = r.left + (r.width * xi) / 12;
        const y = r.top + (r.height * yi) / 12;
        if (d.renderer.hitTestHand(x, y) === ${JSON.stringify(id)}) return { x, y };
      }
    }
    return null;
  })()`);
}

async function main() {
  const target = await getPageTarget();
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  await cdp.send("Page.navigate", { url: BASE_URL + "?test=" + Date.now() });
  await waitForApp(cdp);
  await sleep(800);
  cdp.errors.length = 0;
  await cdp.mouseMove(720, 120);
  await sleep(200);

  const viewApi = await cdp.evaluate(
    `typeof window.CardEngineDemo.renderer.views.values().next().value.applyPose`
  );
  check("CardView exposes applyPose", viewApi === "function", viewApi);

  let s = await snapshot(cdp);
  console.log("INITIAL", JSON.stringify(s.counts), "power", s.power);
  check("starts with 5 cards", s.counts.hand === 5, JSON.stringify(s.counts));
  check("starts with 15 in deck", s.counts.deck === 15);
  check("starts empty discard", s.counts.discard === 0);

  const cornerStyle = await cdp.evaluate(`(() => {
    const view = window.CardEngineDemo.renderer.views.get(window.CardEngineDemo.engine.state.hand[0].instanceId);
    const outer = getComputedStyle(view.el);
    const front = getComputedStyle(view.el.querySelector('.card-front'));
    const art = getComputedStyle(view.el.querySelector('.card__art'));
    return {
      outerRadius: parseFloat(outer.borderTopLeftRadius),
      frontRadius: parseFloat(front.borderTopLeftRadius),
      frontOverflow: front.overflow,
      artRadius: parseFloat(art.borderTopLeftRadius)
    };
  })()`);
  check("hand card outer corners are rounded", cornerStyle.outerRadius >= 9, JSON.stringify(cornerStyle));
  check(
    "card face clips to the same rounded corners",
    cornerStyle.frontRadius >= 9 && cornerStyle.frontOverflow === "hidden",
    JSON.stringify(cornerStyle)
  );
  check("card artwork has rounded clipping", cornerStyle.artRadius > 0, JSON.stringify(cornerStyle));

  const deckVisuals = await cdp.evaluate(`(() => {
    const r = window.CardEngineDemo.renderer;
    const results = [];
    for (const n of [0, 1, 2, 3, 6, 10, 20]) {
      r._renderDeckStack(n);
      results.push({
        requested: n,
        visible: r.deckStack.querySelectorAll('.deck-layer:not(.is-hidden)').length,
        pool: r.deckStack.querySelectorAll('.deck-layer').length,
        topIndex: r.deckTopEl ? Array.from(r.deckLayerEls).indexOf(r.deckTopEl) : -1
      });
    }
    r._visibleDeckLayers = -1;
    r._lastDeckCount = -1;
    r.updatePiles();
    return results;
  })()`);
  const deckByCount = Object.fromEntries(deckVisuals.map((entry) => [entry.requested, entry]));
  check("empty deck shows no layers", deckByCount[0].visible === 0);
  check("one-card deck shows exactly one layer", deckByCount[1].visible === 1, JSON.stringify(deckByCount[1]));
  check("two-card deck shows exactly two layers", deckByCount[2].visible === 2, JSON.stringify(deckByCount[2]));
  check("three-card deck shows exactly three layers", deckByCount[3].visible === 3, JSON.stringify(deckByCount[3]));
  check("large deck caps decorative layers", deckByCount[20].visible === 8, JSON.stringify(deckByCount[20]));

  const backParity = await cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const deckTop = d.renderer.deckTopEl;
    const handBack = d.renderer.views.get(d.engine.state.hand[0].instanceId).el.querySelector('.card-back');
    const deckStyle = getComputedStyle(deckTop);
    const backStyle = getComputedStyle(handBack);
    return {
      background: deckStyle.backgroundImage === backStyle.backgroundImage,
      border: deckStyle.borderTopColor === backStyle.borderTopColor,
      deckBackground: deckStyle.backgroundImage.slice(0, 80),
      backBackground: backStyle.backgroundImage.slice(0, 80)
    };
  })()`);
  check("draw-pile top uses the same surface as a card back", backParity.background && backParity.border, JSON.stringify(backParity));

  const discardVisuals = await cdp.evaluate(`(() => {
    const r = window.CardEngineDemo.renderer;
    const results = [];
    for (const n of [0, 1, 2, 3, 5]) {
      r._renderDiscardEdges(n);
      results.push({ requested: n, visible: r.discardStack.querySelectorAll('.discard-edge:not(.is-hidden)').length });
    }
    r._visibleDiscardEdges = -1;
    r._lastDiscardCount = -1;
    r.updatePiles();
    return results;
  })()`);
  const discardByCount = Object.fromEntries(discardVisuals.map((entry) => [entry.requested, entry]));
  check("one discard has zero fake edges", discardByCount[1].visible === 0, JSON.stringify(discardByCount[1]));
  check("two discards show one underlying edge", discardByCount[2].visible === 1, JSON.stringify(discardByCount[2]));
  check("three discards show two underlying edges", discardByCount[3].visible === 2, JSON.stringify(discardByCount[3]));
  check("deep discard pile caps decorative edges", discardByCount[5].visible === 4, JSON.stringify(discardByCount[5]));

  console.log("SCREEN", await cdp.screenshot("01-initial.png"));

  // ---------- hover ----------
  const topCard = s.hand[s.hand.length - 1];
  const topPoint = await pointForCard(cdp, topCard.id);
  await cdp.mouseMove(topPoint.x, topPoint.y);
  await sleep(420);
  s = await snapshot(cdp);
  check("hover detects top card", s.hovered === topCard.id, `${s.hovered} vs ${topCard.id}`);
  const hoverScale = await cdp.evaluate(
    `window.CardEngineDemo.renderer.views.get(${JSON.stringify(topCard.id)}).pose.scale`
  );
  check("hover enlarges card", hoverScale > 1.12, String(hoverScale));
  console.log("SCREEN", await cdp.screenshot("02-hover.png"));

  // Move hover away and wait for return.
  await cdp.mouseMove(720, 120);
  await sleep(450);

  // ---------- drag into play zone ----------
  const playRect = await cdp.evaluate(
    `window.CardEngineDemo.renderer.playZone.getBoundingClientRect().toJSON()`
  );
  const beforePlay = await snapshot(cdp);
  const dragCard = beforePlay.hand.find((c) => c.disposition === "discard");
  const dragPoint = await pointForCard(cdp, dragCard.id);
  await cdp.drag(dragPoint, { x: playRect.left + playRect.width / 2, y: playRect.top + playRect.height / 2 }, {
    beforeReleaseShot: "03-dragging.png",
  });
  await sleep(430);
  console.log("SCREEN", await cdp.screenshot("04a-cast-effect.png"));
  await sleep(1050);
  s = await snapshot(cdp);
  console.log("AFTER PLAY", JSON.stringify(s.counts), "power", s.power);
  check("drag removes card from hand", s.counts.hand === beforePlay.counts.hand - 1);
  check("drag discards one card", s.counts.discard === 1);
  check(
    "card effect applied exactly once",
    s.power === beforePlay.power + dragCard.effect.amount,
    `${beforePlay.power} -> ${s.power}, expected delta ${dragCard.effect.amount}`
  );
  check("drag state cleared", s.dragActive === false && s.dragging === null);
  check("discard top is the played card", s.discardTop === dragCard.id);
  const firstDiscardEdges = await cdp.evaluate(
    `window.CardEngineDemo.renderer.discardStack.querySelectorAll('.discard-edge:not(.is-hidden)').length`
  );
  check("first discarded card has no fake backing cards", firstDiscardEdges === 0, String(firstDiscardEdges));
  console.log("SCREEN", await cdp.screenshot("04-after-play.png"));

  // ---------- destroy card via API (the engine must support it independently) ----------
  const destroyCard = s.hand.find((c) => c.disposition === "destroy");
  if (destroyCard) {
    await cdp.evaluate(`window.CardEngineDemo.engine.playCard(${JSON.stringify(destroyCard.id)}, 'playfield')`);
    await sleep(1300);
    const afterDestroy = await snapshot(cdp);
    check(
      "destroying card does not enter discard",
      afterDestroy.counts.destroyed === 1 && afterDestroy.counts.discard === s.counts.discard,
      JSON.stringify(afterDestroy.counts)
    );
    check("destroy effect resets power", afterDestroy.power === 0, String(afterDestroy.power));
    console.log("SCREEN", await cdp.screenshot("05-after-destroy.png"));
  } else {
    check("destroy card available for test", false, "none in hand");
  }

  // ---------- invalid drag returns to hand ----------
  s = await snapshot(cdp);
  const returnCard = s.hand[s.hand.length - 1];
  const returnPoint = await pointForCard(cdp, returnCard.id);
  const beforeReturn = s;
  await cdp.drag(returnPoint, { x: 160, y: 280 }, { pauseAtEnd: 100 });
  await sleep(1000);
  const afterReturn = await snapshot(cdp);
  check(
    "invalid drop does not change game state",
    afterReturn.counts.hand === beforeReturn.counts.hand &&
      afterReturn.counts.discard === beforeReturn.counts.discard &&
      afterReturn.power === beforeReturn.power,
    JSON.stringify({ before: beforeReturn.counts, after: afterReturn.counts })
  );
  const returnedMode = afterReturn.hand.find((c) => c.id === returnCard.id)?.mode;
  check("invalid drop returns card to hand", returnedMode === "hand", String(returnedMode));

  // ---------- draw from the deck ----------
  const deckRect = await cdp.evaluate(
    `window.CardEngineDemo.renderer.deckStack.getBoundingClientRect().toJSON()`
  );
  const beforeDraw = await snapshot(cdp);
  await cdp.evaluate(`(() => {
    window.__drawMutations = { childList: 0, attributes: 0 };
    const stack = window.CardEngineDemo.renderer.deckStack;
    new MutationObserver((list) => {
      for (const entry of list) {
        if (entry.type === 'childList') window.__drawMutations.childList += 1;
        else if (entry.type === 'attributes') window.__drawMutations.attributes += 1;
      }
    }).observe(stack, { childList: true, subtree: true, attributes: true });
    window.__deckTopRef = window.CardEngineDemo.renderer.deckTopEl;
    return true;
  })()`);
  await cdp.click(deckRect.left + deckRect.width / 2, deckRect.top + deckRect.height / 2);
  await sleep(190);
  const flying = await cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const card = d.engine.state.hand[d.engine.state.hand.length - 1];
    const view = d.renderer.views.get(card.instanceId);
    return {
      id: card.instanceId,
      mode: view.mode,
      concealed: view.el.classList.contains('is-concealed'),
      pose: { ...view.pose }
    };
  })()`);
  check("drawn card flies in from deck", flying.mode === "drawing", JSON.stringify(flying));
  check("drawn card is concealed in flight", flying.concealed === true);
  console.log("SCREEN", await cdp.screenshot("06a-draw-flight.png"));
  await sleep(900);
  const afterDraw = await snapshot(cdp);
  check("deck click draws one", afterDraw.counts.hand === beforeDraw.counts.hand + 1);
  check("deck count decreases", afterDraw.counts.deck === beforeDraw.counts.deck - 1);
  const ids = afterDraw.hand.map((c) => c.id);
  check("card ids stay unique", new Set(ids).size === ids.length);
  check(
    "drawn card is revealed in hand",
    afterDraw.hand.find((c) => c.id === flying.id)?.mode === "hand"
  );
  const drawStability = await cdp.evaluate(`({
    mutations: window.__drawMutations,
    topStable: window.__deckTopRef === window.CardEngineDemo.renderer.deckTopEl
  })`);
  check(
    "drawing does not rebuild deck DOM",
    drawStability.mutations.childList === 0,
    JSON.stringify(drawStability)
  );
  check(
    "drawing does not restyle the deck stack",
    drawStability.mutations.attributes === 0,
    JSON.stringify(drawStability)
  );
  check("deck top node stays identical during draw", drawStability.topStable, JSON.stringify(drawStability));
  console.log("SCREEN", await cdp.screenshot("06-after-draw.png"));

  // The topbar Draw button must use the same stable visual path.
  const beforeButtonDraw = await snapshot(cdp);
  await cdp.evaluate(`document.getElementById('drawBtn').click()`);
  await sleep(900);
  const afterButtonDraw = await snapshot(cdp);
  check(
    "Draw button draws with the same state update",
    afterButtonDraw.counts.hand === beforeButtonDraw.counts.hand + 1 &&
      afterButtonDraw.counts.deck === beforeButtonDraw.counts.deck - 1,
    JSON.stringify({ before: beforeButtonDraw.counts, after: afterButtonDraw.counts })
  );
  const buttonMutations = await cdp.evaluate(`window.__drawMutations`);
  check(
    "repeated Draw does not mutate the deck stack DOM",
    buttonMutations.childList === 0 && buttonMutations.attributes === 0,
    JSON.stringify(buttonMutations)
  );

  // Regression guard for the card-back "inner square changes size" flash:
  // while the flying card still overlaps the pile, it must remain deck-sized.
  const staging = await cdp.evaluate(`new Promise((resolve) => {
    const d = window.CardEngineDemo;
    const samples = [];
    let running = true;
    function tick() {
      if (!running) return;
      const card = d.engine.state.hand[d.engine.state.hand.length - 1];
      const view = d.renderer.views.get(card.instanceId);
      if (view) {
        const deck = d.renderer.deckTopEl.getBoundingClientRect();
        const r = view.el.getBoundingClientRect();
        const overlap = !(r.right < deck.left || r.left > deck.right || r.bottom < deck.top || r.top > deck.bottom);
        samples.push({
          scale: view.pose.scale,
          rotation: view.pose.rotation,
          deckRotation: parseFloat(getComputedStyle(d.renderer.deckTopEl).getPropertyValue('--rot')) || 0,
          overlap,
          concealed: view.el.classList.contains('is-concealed')
        });
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    d.engine.drawCard();
    setTimeout(() => {
      running = false;
      const base = samples[0]?.scale || 1;
      const overlapping = samples.filter((s) => s.overlap);
      const maxOverlapScale = overlapping.length ? Math.max(...overlapping.map((s) => s.scale)) : base;
      resolve({
        frames: samples.length,
        baseScale: base,
        overlapFrames: overlapping.length,
        maxOverlapScale,
        ratio: maxOverlapScale / base,
        startRotationDelta: samples[0] ? Math.abs(samples[0].rotation - samples[0].deckRotation) : 99,
        revealedWhileOverlapping: overlapping.some((s) => !s.concealed)
      });
    }, 850);
  })`);
  check(
    "drawn card keeps deck size while overlapping the pile",
    staging.ratio < 1.03,
    JSON.stringify(staging)
  );
  check(
    "drawn card starts at the exact deck-top rotation",
    staging.startRotationDelta < 0.05,
    JSON.stringify(staging)
  );

  // ---------- fill to ten ----------
  await cdp.evaluate(`document.getElementById('fillBtn').click()`);
  await sleep(2600);
  const full = await snapshot(cdp);
  check("fill reaches max hand", full.counts.hand === 10, JSON.stringify(full.counts));
  const uniqueFull = full.hand.map((c) => c.id);
  check("full hand has unique instances", new Set(uniqueFull).size === 10);
  console.log("SCREEN", await cdp.screenshot("07-full-hand.png"));

  // Extra draw attempt must not exceed the cap.
  await cdp.mouseMove(720, 120);
  await sleep(250);
  await cdp.click(deckRect.left + deckRect.width / 2, deckRect.top + deckRect.height / 2);
  await sleep(450);
  const capped = await snapshot(cdp);
  check("full hand cap holds", capped.counts.hand === 10, JSON.stringify(capped.counts));
  check("full hand shows feedback", /full/i.test(capped.toast), capped.toast);
  console.log("SCREEN", await cdp.screenshot("08-hand-full-message.png"));

  // ---------- play leftmost, middle, rightmost from full hand ----------
  for (const [label, index] of [
    ["leftmost", 0],
    ["middle", 5],
    ["rightmost", 9],
  ]) {
    await cdp.mouseMove(720, 120);
    await sleep(300);
    let current = await snapshot(cdp);
    if (current.counts.hand === 0) break;
    const card = current.hand[Math.min(index, current.hand.length - 1)];
    const point = await pointForCard(cdp, card.id);
    if (!point) {
      check(`can grab ${label} card`, false, card.name);
      continue;
    }
    await cdp.drag(point, {
      x: playRect.left + playRect.width / 2,
      y: playRect.top + playRect.height / 2,
    });
    await sleep(1450);
    const after = await snapshot(cdp);
    check(
      `playing ${label} card succeeds`,
      after.counts.hand === current.counts.hand - 1,
      `${current.counts.hand} -> ${after.counts.hand}`
    );
  }
  console.log("SCREEN", await cdp.screenshot("09-after-edge-plays.png"));

  // ---------- reset ----------
  await cdp.evaluate(`document.getElementById('resetBtn').click()`);
  await sleep(1400);
  const reset = await snapshot(cdp);
  check("reset restores 5-card hand", reset.counts.hand === 5, JSON.stringify(reset.counts));
  check("reset restores deck", reset.counts.deck === 15);
  check("reset clears discard", reset.counts.discard === 0);
  check("reset clears power", reset.power === 0);
  console.log("SCREEN", await cdp.screenshot("10-after-reset.png"));

  // ---------- responsive ----------
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(800);
  await cdp.mouseMove(195, 90);
  await sleep(300);
  console.log("SCREEN", await cdp.screenshot("11-mobile.png"));
  const mobile = await cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const viewports = {
      inner: [innerWidth, innerHeight],
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
    const rects = d.engine.state.hand.map(c => d.renderer.views.get(c.instanceId).getRect().toJSON());
    return { viewports, rects, counts: d.engine.getCounts() };
  })()`);
  check("mobile has no horizontal document overflow", mobile.viewports.scrollWidth <= 390, JSON.stringify(mobile.viewports));
  check("mobile hand is present", mobile.rects.length === 5);

  // Mobile hover (mouse is still available in this emulation) should still enlarge.
  const mobileHand = await snapshot(cdp);
  const last = mobileHand.hand[mobileHand.hand.length - 1];
  const mobilePoint = await pointForCard(cdp, last.id);
  await cdp.mouseMove(mobilePoint.x, mobilePoint.y);
  await sleep(450);
  const mobileHover = await snapshot(cdp);
  check("mobile hover works", mobileHover.hovered === last.id, String(mobileHover.hovered));
  console.log("SCREEN", await cdp.screenshot("12-mobile-hover.png"));

  // ---------- full ten-card hand on mobile ----------
  await cdp.evaluate(`document.getElementById('fillBtn').click()`);
  await sleep(2500);
  await cdp.mouseMove(195, 90);
  await sleep(350);
  const mobileFull = await snapshot(cdp);
  check("mobile fills to ten cards", mobileFull.counts.hand === 10, JSON.stringify(mobileFull.counts));
  const allAccessible = await cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const result = [];
    for (const card of d.engine.state.hand) {
      let found = false;
      const v = d.renderer.views.get(card.instanceId);
      const r = v.getRect();
      for (let yi = 1; yi <= 14 && !found; yi += 1) {
        for (let xi = 1; xi <= 14 && !found; xi += 1) {
          const x = Math.max(1, Math.min(innerWidth - 1, r.left + (r.width * xi) / 14));
          const y = Math.max(1, Math.min(innerHeight - 1, r.top + (r.height * yi) / 14));
          if (d.renderer.hitTestHand(x, y) === card.instanceId) found = true;
        }
      }
      result.push({ id: card.instanceId, found });
    }
    return result;
  })()`);
  check(
    "all ten mobile cards remain reachable",
    allAccessible.every((entry) => entry.found),
    JSON.stringify(allAccessible)
  );
  console.log("SCREEN", await cdp.screenshot("13-mobile-full-hand.png"));

  // Synthetic layout sanity for the counts explicitly called out in the brief.
  const layouts = await cdp.evaluate(`(() => {
    const counts = [1, 2, 3, 5, 7, 10];
    return counts.map(count => {
      const poses = window.CGE.computeHandLayout({
        stageWidth: 1440, stageHeight: 900, cardWidth: 186, cardHeight: 266,
        count, config: window.CGE.CONFIG
      });
      return {
        count,
        x: poses.map(p => Math.round(p.x)),
        rotations: poses.map(p => Math.round(p.rotation * 10) / 10),
        z: poses.map(p => p.z)
      };
    });
  })()`);
  for (const layout of layouts) {
    const ascending = layout.x.every((x, i) => i === 0 || x > layout.x[i - 1]);
    check(`layout ${layout.count} is ordered`, ascending, JSON.stringify(layout.x));
    if (layout.count === 1) {
      check("single card is centred", Math.abs(layout.x[0] - 720) <= 1, String(layout.x[0]));
      check("single card does not rotate", layout.rotations[0] === 0);
    } else {
      check(
        `layout ${layout.count} fans symmetrically`,
        Math.abs(layout.rotations[0] + layout.rotations[layout.rotations.length - 1]) < 0.01
      );
    }
  }

  // ---------- touch drag ----------
  await cdp.evaluate(`document.getElementById('resetBtn').click()`);
  await sleep(1600);
  await cdp.mouseMove(190, 80);
  await sleep(250);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });

  const mobileBefore = await snapshot(cdp);
  const touchCard = mobileBefore.hand[mobileBefore.hand.length - 1];
  const touchPoint = await pointForCard(cdp, touchCard.id);
  const mobilePlay = await cdp.evaluate(
    `window.CardEngineDemo.renderer.playZone.getBoundingClientRect().toJSON()`
  );
  const touchTarget = {
    x: mobilePlay.left + mobilePlay.width / 2,
    y: mobilePlay.top + mobilePlay.height / 2,
  };

  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: touchPoint.x, y: touchPoint.y, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
  });
  await sleep(90);
  for (let i = 1; i <= 12; i += 1) {
    const t = i / 12;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: touchPoint.x + (touchTarget.x - touchPoint.x) * t,
          y: touchPoint.y + (touchTarget.y - touchPoint.y) * t,
          id: 1,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        },
      ],
    });
    await sleep(20);
  }
  await sleep(160);
  const touchDragState = await snapshot(cdp);
  check("touch starts a drag", touchDragState.dragActive === true);
  check("touch highlights play zone", /is-dragover/.test(touchDragState.zono));
  console.log("SCREEN", await cdp.screenshot("15-touch-dragging.png"));

  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(1500);
  const mobileAfter = await snapshot(cdp);
  check(
    "touch drop plays the card",
    mobileAfter.counts.hand === mobileBefore.counts.hand - 1,
    JSON.stringify({ before: mobileBefore.counts, after: mobileAfter.counts })
  );
  check(
    "touch effect applies once",
    mobileAfter.power === mobileBefore.power + touchCard.effect.amount,
    `${mobileBefore.power} -> ${mobileAfter.power}`
  );
  console.log("SCREEN", await cdp.screenshot("16-touch-after-play.png"));
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });

  // ---------- reset in the middle of a draw must not leak stale views ----------
  await cdp.evaluate(`document.getElementById('resetBtn').click()`);
  await sleep(1500);
  await cdp.evaluate(`window.CardEngineDemo.drawOne()`);
  await sleep(150);
  const interrupted = await snapshot(cdp);
  check("draw is in flight before interruption", interrupted.activeTweens > 0, JSON.stringify(interrupted));
  await cdp.evaluate(`document.getElementById('resetBtn').click()`);
  await sleep(1700);
  const recovered = await snapshot(cdp);
  check("reset during draw restores hand", recovered.counts.hand === 5, JSON.stringify(recovered.counts));
  check("reset during draw restores deck", recovered.counts.deck === 15, JSON.stringify(recovered.counts));
  check(
    "reset during draw leaves no stale views or tweens",
    recovered.viewCount === 5 && recovered.activeTweens === 0,
    JSON.stringify({ views: recovered.viewCount, tweens: recovered.activeTweens })
  );

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(500);

  // ---------- reduced motion ----------
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await cdp.send("Page.navigate", { url: BASE_URL + "?reduced=" + Date.now() });
  await waitForApp(cdp);
  await sleep(350);
  cdp.errors.length = 0;
  await cdp.evaluate(`document.getElementById('drawBtn').click()`);
  await sleep(350);
  const reducedDraw = await cdp.evaluate(`(() => {
    const d = window.CardEngineDemo;
    const card = d.engine.state.hand[d.engine.state.hand.length - 1];
    return { mode: d.renderer.views.get(card.instanceId).mode, counts: d.engine.getCounts() };
  })()`);
  check(
    "reduced motion resolves drawing without a long animation",
    reducedDraw.mode === "hand",
    JSON.stringify(reducedDraw)
  );
  console.log("SCREEN", await cdp.screenshot("17-reduced-motion.png"));
  await cdp.send("Emulation.setEmulatedMedia", { features: [] });

  // ---------- file:// works without a build/server ----------
  const fileUrl =
    "file:///" + path.resolve("index.html").replaceAll("\\", "/");
  await cdp.send("Page.navigate", { url: fileUrl });
  await waitForApp(cdp);
  await sleep(700);
  const fileState = await snapshot(cdp);
  check("project runs directly from file://", fileState.counts.hand === 5, JSON.stringify(fileState.counts));
  console.log("SCREEN", await cdp.screenshot("18-file-protocol.png"));

  const errors = cdp.errors.filter((e) => !/favicon/i.test(e));
  check("no browser errors", errors.length === 0, JSON.stringify(errors));
  console.log("BROWSER_ERRORS", JSON.stringify(cdp.errors));
  console.log("FAILURES", JSON.stringify(failures));
  if (failures.length) process.exitCode = 1;
  cdp.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
