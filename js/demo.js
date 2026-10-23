/* The example "game" that consumes the engine. It owns the power counter and
   all effect handlers; the engine only forwards card definitions and outcomes. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;

  class DemoUI {
    constructor(options) {
      this.engine = options.engine;
      this.bus = options.bus;
      this.gameState = options.gameState;
      this.el = options.elements;
      this._lastToast = { key: "", at: 0 };
      this._toastTimers = new Set();
      this._unsubs = [];
      this._lastCounts = { hand: null, maxHand: null, deck: null, discard: null };
      this._powerAnim = null;

      this._bind();
      this.syncAll();
    }

    _bind() {
      this._unsubs.push(
        this.bus.on("state:changed", () => this.syncCounts()),
        this.bus.on("card:played", (outcome) => this.showPowerResult(outcome.effectResult)),
        this.bus.on("game:reset", () => this.syncAll()),
        this.bus.on("hand:full", () => this.toast("Your hand is full", { warning: true, key: "full" })),
        this.bus.on("deck:empty", () => this.toast("The draw pile is empty", { key: "empty" })),
        this.bus.on("play:rejected", ({ reason }) => {
          if (reason === "not-in-hand") {
            this.toast("That card is no longer in your hand", { warning: true, key: "gone" });
          }
        })
      );
    }

    destroy() {
      for (const unsubscribe of this._unsubs) unsubscribe();
      for (const timer of this._toastTimers) clearTimeout(timer);
      this._toastTimers.clear();
    }

    syncAll() {
      this.syncCounts();
      this.syncPower(false);
    }

    syncCounts() {
      const counts = this.engine.getCounts();
      const last = this._lastCounts;
      if (counts.hand !== last.hand) {
        last.hand = counts.hand;
        this.el.handCount.textContent = String(counts.hand);
      }
      if (counts.maxHand !== last.maxHand) {
        last.maxHand = counts.maxHand;
        this.el.maxHandCount.textContent = String(counts.maxHand);
      }
      if (counts.deck !== last.deck) {
        last.deck = counts.deck;
        this.el.deckMetric.textContent = String(counts.deck);
      }
      if (counts.discard !== last.discard) {
        last.discard = counts.discard;
        this.el.discardMetric.textContent = String(counts.discard);
      }
    }

    syncPower(animate) {
      const value = Number(this.gameState.power) || 0;
      this.el.powerValue.textContent = String(value);
      this.el.powerValue.classList.toggle("is-positive", value > 0);
      this.el.powerValue.classList.toggle("is-negative", value < 0);
      if (!animate && this._powerAnim) {
        this._powerAnim.cancel();
        this._powerAnim = null;
      }
    }

    showPowerResult(result) {
      const value = Number(this.gameState.power) || 0;
      this.el.powerValue.textContent = String(value);
      this.el.powerValue.classList.toggle("is-positive", value > 0);
      this.el.powerValue.classList.toggle("is-negative", value < 0);
      if (!U.prefersReducedMotion()) {
        if (this._powerAnim) this._powerAnim.cancel();
        this._powerAnim = this.el.powerValue.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.28)", offset: 0.26 },
            { transform: "scale(0.97)", offset: 0.58 },
            { transform: "scale(1)" },
          ],
          { duration: 540, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }
        );
      }

      const delta = Number(result && result.delta) || 0;
      const isReset = result && result.kind === "power.set";
      const text = isReset ? "RESET" : U.signed(delta);
      if (!isReset && !delta) return;

      const float = document.createElement("span");
      float.className = "power-float";
      if (isReset) float.classList.add("is-neutral");
      else if (delta < 0) float.classList.add("is-negative");
      float.textContent = text;
      this.el.powerFloatHost.appendChild(float);
      setTimeout(() => float.remove(), 1250);

      if (this.el.powerFloatHost.children.length > 4) {
        this.el.powerFloatHost.firstElementChild.remove();
      }
    }

    toast(message, options) {
      const opts = options || {};
      const now = performance.now();
      const key = opts.key || message;
      if (this._lastToast.key === key && now - this._lastToast.at < 950) return;
      this._lastToast = { key, at: now };

      while (this.el.toastHost.children.length >= 2) {
        this.el.toastHost.firstElementChild.remove();
      }

      const toast = document.createElement("div");
      toast.className = "toast" + (opts.warning ? " is-warning" : "");
      const mark = document.createElement("span");
      mark.className = "toast__mark";
      const label = document.createElement("span");
      label.textContent = message;
      toast.append(mark, label);
      this.el.toastHost.appendChild(toast);

      const life = opts.duration || 1900;
      const exitTimer = setTimeout(() => {
        toast.classList.add("is-out");
        const removeTimer = setTimeout(() => {
          toast.remove();
          this._toastTimers.delete(removeTimer);
        }, 300);
        this._toastTimers.add(removeTimer);
        this._toastTimers.delete(exitTimer);
      }, life);
      this._toastTimers.add(exitTimer);
    }
  }

  CGE.createDemoGame = function createDemoGame(options) {
    const gameState = options.gameState || { power: 0 };
    const effects = options.effectRegistry || new CGE.EffectRegistry();

    effects.register("power.add", (effect, context) => {
      const before = Number(context.gameState.power) || 0;
      const amount = Number(effect.amount) || 0;
      const after = before + amount;
      context.gameState.power = after;
      return {
        ok: true,
        kind: "power.add",
        delta: amount,
        before,
        value: after,
        label: `${CGE.utils.signed(amount)} POWER`,
      };
    });

    effects.register("power.set", (effect, context) => {
      const before = Number(context.gameState.power) || 0;
      const after = Number(effect.amount) || 0;
      context.gameState.power = after;
      return {
        ok: true,
        kind: "power.set",
        delta: after - before,
        before,
        value: after,
        label: "POWER RESET",
      };
    });

    return {
      gameState,
      effects,
      ui: new DemoUI({
        engine: options.engine,
        bus: options.bus,
        gameState,
        elements: options.elements,
      }),
    };
  };
})(window);
