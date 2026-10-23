/* Effects are registered by the game layer, never hard-coded into cards or
   the interaction system. A card definition only names an effect type. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});

  class EffectRegistry {
    constructor() {
      this._handlers = new Map();
    }

    register(type, handler) {
      if (typeof type !== "string" || typeof handler !== "function") {
        throw new TypeError("EffectRegistry.register expects a type and a function.");
      }
      this._handlers.set(type, handler);
      return () => this._handlers.delete(type);
    }

    has(type) {
      return this._handlers.has(type);
    }

    execute(effect, context) {
      if (!effect || !effect.type) {
        return { ok: false, reason: "no-effect", label: "" };
      }
      const handler = this._handlers.get(effect.type);
      if (!handler) {
        return { ok: false, reason: "unhandled-effect", label: effect.type };
      }
      const result = handler(effect, context) || {};
      return Object.assign(
        {
          ok: true,
          kind: effect.type,
          label: "",
          delta: 0,
          value: null,
        },
        result
      );
    }
  }

  CGE.EffectRegistry = EffectRegistry;
})(window);
