/* Tiny synchronous event bus. State changes are broadcast without coupling
   the engine to the renderer, demo effects or UI. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});

  class EventBus {
    constructor() {
      this._listeners = new Map();
    }

    on(eventName, handler) {
      if (!this._listeners.has(eventName)) {
        this._listeners.set(eventName, new Set());
      }
      this._listeners.get(eventName).add(handler);
      return () => this.off(eventName, handler);
    }

    once(eventName, handler) {
      const unsubscribe = this.on(eventName, (payload) => {
        unsubscribe();
        handler(payload);
      });
      return unsubscribe;
    }

    off(eventName, handler) {
      const listeners = this._listeners.get(eventName);
      if (!listeners) return;
      listeners.delete(handler);
      if (listeners.size === 0) this._listeners.delete(eventName);
    }

    emit(eventName, payload) {
      const listeners = this._listeners.get(eventName);
      if (!listeners) return;
      for (const handler of Array.from(listeners)) {
        try {
          handler(payload);
        } catch (error) {
          // A broken listener must not corrupt game state or stop other listeners.
          console.error("[Arcana event]", eventName, error);
        }
      }
    }
  }

  CGE.EventBus = EventBus;
})(window);
