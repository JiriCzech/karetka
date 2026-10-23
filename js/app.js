/* Demo bootstrap. This file is the only place where the sample game, the UI
   and the reusable engine are wired together. */
(function (global) {
  "use strict";

  const CGE = global.CGE;
  const U = CGE.utils;

  const byId = (id) => document.getElementById(id);

  const elements = {
    app: byId("app"),
    stage: byId("app"),
    cardLayer: byId("cardLayer"),
    cardProbe: byId("cardProbe"),
    effectsLayer: byId("effectsLayer"),
    playZone: byId("playZone"),
    deckZone: byId("deckZone"),
    discardZone: byId("discardZone"),
    deckStack: byId("deckStack"),
    discardStack: byId("discardStack"),
    deckEmpty: byId("deckEmpty"),
    discardEmpty: byId("discardEmpty"),
    deckCount: byId("deckCount"),
    discardCount: byId("discardCount"),
    powerValue: byId("powerValue"),
    powerFloatHost: byId("powerFloatHost"),
    handCount: byId("handCount"),
    maxHandCount: byId("maxHandCount"),
    deckMetric: byId("deckMetric"),
    discardMetric: byId("discardMetric"),
    toastHost: byId("toastHost"),
    drawBtn: byId("drawBtn"),
    drawThreeBtn: byId("drawThreeBtn"),
    fillBtn: byId("fillBtn"),
    resetBtn: byId("resetBtn"),
  };

  const bus = new CGE.EventBus();
  const gameState = { power: 0 };
  const effects = new CGE.EffectRegistry();

  const engine = new CGE.CardEngine({
    eventBus: bus,
    effectRegistry: effects,
    gameState,
    config: CGE.CONFIG,
  });

  const renderer = new CGE.TableRenderer({
    stage: elements.stage,
    cardLayer: elements.cardLayer,
    effectsLayer: elements.effectsLayer,
    engine,
    bus,
    config: CGE.CONFIG,
    playZone: elements.playZone,
    deckZone: elements.deckZone,
    discardZone: elements.discardZone,
    deckStack: elements.deckStack,
    discardStack: elements.discardStack,
    deckEmpty: elements.deckEmpty,
    discardEmpty: elements.discardEmpty,
    deckCount: elements.deckCount,
    discardCount: elements.discardCount,
    probe: elements.cardProbe,
  }).init();

  const demo = CGE.createDemoGame({
    engine,
    bus,
    gameState,
    effectRegistry: effects,
    elements,
  });

  let session = 0;
  let deckPulseTimer = null;

  function pulseDeck() {
    elements.deckZone.classList.remove("is-pulsing");
    requestAnimationFrame(() => {
      elements.deckZone.classList.add("is-pulsing");
      clearTimeout(deckPulseTimer);
      deckPulseTimer = setTimeout(() => {
        elements.deckZone.classList.remove("is-pulsing");
      }, 680);
    });
  }

  function onPlayRequested(view) {
    const outcome = engine.playCard(view.instance.instanceId, "playfield");
    if (!outcome.ok) {
      demo.ui.toast(
        outcome.reason === "not-in-hand" ? "That card is no longer in your hand" : "The card cannot be played",
        { warning: true, key: "rejected" }
      );
    }
    return outcome;
  }

  const interactions = new CGE.InteractionController({
    stage: elements.stage,
    cardLayer: elements.cardLayer,
    engine,
    renderer,
    playZone: elements.playZone,
    config: CGE.CONFIG,
    onPlayRequested,
  });

  async function dealOpeningHand() {
    const token = session;
    const count = CGE.CONFIG.startingHand;
    for (let i = 0; i < count; i += 1) {
      if (token !== session) return;
      if (!engine.canDraw()) return;
      engine.drawCard();
      if (i < count - 1) {
        await U.wait(U.prefersReducedMotion() ? 20 : CGE.CONFIG.motion.staggerDeal);
      }
    }
  }

  function drawOne() {
    if (!engine.canDraw()) {
      pulseDeck();
      if (engine.state.deck.length === 0) {
        demo.ui.toast("The draw pile is empty", { key: "empty" });
      } else if (engine.state.hand.length >= engine.maxHandSize) {
        demo.ui.toast("Your hand is full", { warning: true, key: "full" });
      }
      return null;
    }
    const result = engine.drawCard();
    if (!result.ok) pulseDeck();
    return result;
  }

  async function drawBurst(amount) {
    const token = session;
    const count = Math.max(1, amount | 0);
    const delay = U.prefersReducedMotion() ? 20 : CGE.CONFIG.motion.staggerBulkDraw;
    for (let i = 0; i < count; i += 1) {
      if (token !== session) return;
      if (!engine.canDraw()) {
        pulseDeck();
        if (engine.state.deck.length === 0) {
          demo.ui.toast("The draw pile is empty", { key: "empty" });
        } else {
          demo.ui.toast("Your hand is full", { warning: true, key: "full" });
        }
        return;
      }
      engine.drawCard();
      if (i < count - 1) await U.wait(delay);
    }
  }

  async function fillHand() {
    const token = session;
    const delay = U.prefersReducedMotion() ? 20 : CGE.CONFIG.motion.staggerBulkDraw;
    let guard = 0;
    while (engine.canDraw() && guard < 30) {
      if (token !== session) return;
      engine.drawCard();
      guard += 1;
      await U.wait(delay);
    }
    if (engine.state.deck.length === 0 && engine.state.hand.length < engine.maxHandSize) {
      demo.ui.toast("The draw pile is empty", { key: "empty" });
    } else if (engine.state.hand.length >= engine.maxHandSize) {
      demo.ui.toast("Your hand is full", { warning: true, key: "full" });
    }
  }

  async function startFreshSession() {
    const token = ++session;
    interactions.cancelDrag(true);
    gameState.power = 0;
    engine.reset();
    demo.ui.syncAll();
    await U.wait(U.prefersReducedMotion() ? 20 : 160);
    if (token !== session) return;
    await dealOpeningHand();
  }

  function flashControl(button) {
    button.classList.remove("is-flashing");
    clearTimeout(button._flashTimer);
    requestAnimationFrame(() => {
      button.classList.add("is-flashing");
      button._flashTimer = setTimeout(() => {
        button.classList.remove("is-flashing");
      }, 600);
    });
  }

  elements.deckZone.addEventListener("click", () => {
    drawOne();
  });

  elements.drawBtn.addEventListener("click", () => {
    flashControl(elements.drawBtn);
    drawOne();
  });

  elements.drawThreeBtn.addEventListener("click", () => {
    flashControl(elements.drawThreeBtn);
    void drawBurst(3);
  });

  elements.fillBtn.addEventListener("click", () => {
    flashControl(elements.fillBtn);
    void fillHand();
  });

  elements.resetBtn.addEventListener("click", () => {
    flashControl(elements.resetBtn);
    void startFreshSession();
  });

  elements.app.addEventListener("contextmenu", (event) => {
    if (event.target instanceof Element && event.target.closest(".card")) {
      event.preventDefault();
    }
  });

  global.CardEngineDemo = {
    engine,
    renderer,
    interactions,
    ui: demo.ui,
    effects,
    gameState,
    bus,
    config: CGE.CONFIG,
    drawOne,
    drawBurst,
    fillHand,
    reset: startFreshSession,
    dealOpeningHand,
  };

  // Build one card template per definition while the table is still idle.
  // Every subsequent draw only clones DOM instead of re-parsing card markup.
  const prewarmCards = () => CGE.CardView.prewarm(CGE.CARD_DEFINITIONS);
  if ("requestIdleCallback" in global) {
    global.requestIdleCallback(prewarmCards, { timeout: 120 });
  } else {
    setTimeout(prewarmCards, 0);
  }

  window.addEventListener("load", () => {
    void (async () => {
      await U.wait(U.prefersReducedMotion() ? 10 : 220);
      await dealOpeningHand();
    })();
  });
})(window);
