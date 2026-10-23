/* Game state and operations. Deliberately has no knowledge of pixels, DOM,
   hover, cards' visual positions, or which CSS animation is playing. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});

  class CardEngine {
    constructor(options) {
      const opts = options || {};
      this.bus = opts.eventBus || new CGE.EventBus();
      this.effects = opts.effectRegistry || null;
      this.gameState = opts.gameState || {};
      this.config = opts.config || CGE.CONFIG;
      this.maxHandSize = opts.maxHandSize || this.config.maxHandSize;
      this.definitions = new Map(
        (opts.definitions || CGE.CARD_DEFINITIONS).map((definition) => [definition.id, definition])
      );
      this.validPlayZones = new Set(Object.values(this.config.zones || { playfield: true }));
      this.nextSerial = 1;
      this._resolving = new Set();
      this.state = {
        deck: [],
        hand: [],
        discard: [],
        destroyed: [],
        maxHandSize: this.maxHandSize,
      };
      this.round = 0;
      this._resetState(opts.seed);
    }

    _resetState(seed) {
      const deck = CGE.buildDeck({
        serialStart: this.nextSerial,
        seed: seed == null ? this.config.deckSeed : seed,
      });
      this.nextSerial += deck.length;
      this.state.deck = deck;
      this.state.hand = [];
      this.state.discard = [];
      this.state.destroyed = [];
      this.state.maxHandSize = this.maxHandSize;
      this._resolving.clear();
      this.round += 1;
      this.bus.emit("game:reset", { round: this.round, counts: this.getCounts() });
      this.bus.emit("state:changed", { reason: "reset", counts: this.getCounts() });
    }

    reset(options) {
      const opts = options || {};
      this._resetState(opts.seed);
      return this.getCounts();
    }

    on(eventName, handler) {
      return this.bus.on(eventName, handler);
    }

    getDefinition(definitionId) {
      return this.definitions.get(definitionId) || null;
    }

    getCard(instanceId) {
      return (
        this.state.hand.find((card) => card.instanceId === instanceId) ||
        this.state.deck.find((card) => card.instanceId === instanceId) ||
        this.state.discard.find((card) => card.instanceId === instanceId) ||
        null
      );
    }

    getCounts() {
      return {
        deck: this.state.deck.length,
        hand: this.state.hand.length,
        discard: this.state.discard.length,
        destroyed: this.state.destroyed.length,
        maxHand: this.state.maxHandSize,
      };
    }

    canDraw() {
      return this.state.hand.length < this.maxHandSize && this.state.deck.length > 0;
    }

    isValidPlayZone(zoneId) {
      return this.validPlayZones.has(zoneId);
    }

    /**
     * Move the next card from the deck to the hand.
     * Returns a result object; visual timing is owned by the view layer.
     */
    drawCard(options) {
      const opts = options || {};
      if (this.state.hand.length >= this.maxHandSize) {
        this.bus.emit("hand:full", { counts: this.getCounts() });
        return { ok: false, reason: "hand-full", counts: this.getCounts() };
      }
      if (this.state.deck.length === 0) {
        this.bus.emit("deck:empty", { counts: this.getCounts() });
        return { ok: false, reason: "deck-empty", counts: this.getCounts() };
      }

      const card = this.state.deck.pop();
      card.zone = "hand";
      this.state.hand.push(card);

      if (!opts.silent) {
        this.bus.emit("card:drawn", { card, counts: this.getCounts() });
        this.bus.emit("state:changed", { reason: "draw", counts: this.getCounts(), card });
      }
      return { ok: true, card, counts: this.getCounts() };
    }

    drawCards(amount) {
      const results = [];
      const count = Math.max(0, amount | 0);
      for (let i = 0; i < count; i += 1) {
        const result = this.drawCard();
        results.push(result);
        if (!result.ok) break;
      }
      return results;
    }

    /**
     * Resolve a dragged card into a registered zone.
     * The card leaves the hand immediately, the effect is executed exactly once,
     * and the card's final disposition is decided before any animation runs.
     */
    playCard(instanceId, targetZone) {
      const zone = targetZone || "playfield";
      if (!this.isValidPlayZone(zone)) {
        this.bus.emit("play:rejected", { instanceId, reason: "invalid-zone", targetZone: zone });
        return { ok: false, reason: "invalid-zone" };
      }
      if (this._resolving.has(instanceId)) {
        return { ok: false, reason: "already-resolving" };
      }

      const index = this.state.hand.findIndex((card) => card.instanceId === instanceId);
      if (index < 0) {
        this.bus.emit("play:rejected", { instanceId, reason: "not-in-hand", targetZone: zone });
        return { ok: false, reason: "not-in-hand" };
      }

      const card = this.state.hand[index];
      const definition = card.definition || this.getDefinition(card.definitionId);
      this._resolving.add(instanceId);
      this.state.hand.splice(index, 1);
      card.zone = "resolving";
      this.bus.emit("state:changed", { reason: "leave-hand", card, counts: this.getCounts() });

      let effectResult;
      try {
        effectResult = this.effects
          ? this.effects.execute(definition.effect, {
              engine: this,
              card,
              definition,
              gameState: this.gameState,
              targetZone: zone,
            })
          : { ok: false, reason: "no-effect-registry", label: definition.effectLabel, delta: 0 };
      } catch (error) {
        console.error("[Arcana effect]", error);
        effectResult = {
          ok: false,
          reason: "effect-error",
          error,
          label: definition.effectLabel,
          delta: 0,
        };
        this.bus.emit("effect:error", { card, definition, error });
      }

      const disposition = definition.disposition === "destroy" ? "destroy" : "discard";
      if (disposition === "destroy") {
        card.zone = "destroyed";
        this.state.destroyed.push(card);
      } else {
        card.zone = "discard";
        this.state.discard.push(card);
      }

      this._resolving.delete(instanceId);
      const outcome = {
        ok: true,
        card,
        definition,
        targetZone: zone,
        disposition,
        effectResult,
        counts: this.getCounts(),
      };

      this.bus.emit("card:played", outcome);
      this.bus.emit("state:changed", {
        reason: "play",
        card,
        counts: this.getCounts(),
        disposition,
      });
      return outcome;
    }

    /** Move a card from hand to discard without running its effect. */
    discardCard(instanceId) {
      const index = this.state.hand.findIndex((card) => card.instanceId === instanceId);
      if (index < 0) return { ok: false, reason: "not-in-hand" };
      const card = this.state.hand.splice(index, 1)[0];
      card.zone = "discard";
      this.state.discard.push(card);
      this.bus.emit("card:discarded", { card, counts: this.getCounts() });
      this.bus.emit("state:changed", { reason: "discard", card, counts: this.getCounts() });
      return { ok: true, card };
    }

    /** Permanently remove a card from hand without running its effect. */
    destroyCard(instanceId) {
      const index = this.state.hand.findIndex((card) => card.instanceId === instanceId);
      if (index < 0) return { ok: false, reason: "not-in-hand" };
      const card = this.state.hand.splice(index, 1)[0];
      card.zone = "destroyed";
      this.state.destroyed.push(card);
      this.bus.emit("card:destroyed", { card, counts: this.getCounts() });
      this.bus.emit("state:changed", {
        reason: "destroy",
        card,
        counts: this.getCounts(),
      });
      return { ok: true, card };
    }
  }

  CGE.CardEngine = CardEngine;
})(window);
