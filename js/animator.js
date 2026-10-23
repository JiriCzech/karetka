/* A single RAF-driven tween registry. Every visual card has at most one active
   tween, which prevents competing animations from fighting over its transform. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;

  class Animator {
    constructor() {
      this.tweens = new Map();
      this._frame = null;
    }

    get TweenCount() {
      return this.tweens.size;
    }

    tweenTo(view, target, options) {
      const opts = options || {};
      const duration = U.motionDuration(opts.duration == null ? 300 : opts.duration);
      const delay = U.prefersReducedMotion() ? 0 : opts.delay || 0;
      const ease = opts.ease || U.easeOutCubic;
      const arcHeight = U.prefersReducedMotion() ? 0 : opts.arcHeight || 0;
      const scaleDelay = U.prefersReducedMotion() ? 0 : opts.scaleDelay || 0;
      const from = Object.assign({}, view.pose);
      if (opts.from) Object.assign(from, opts.from);
      const to = Object.assign({}, view.pose, target);

      this.cancel(view);
      view.setAnimating(true);

      if (duration <= 1) {
        view.setPose(to);
        view.setAnimating(false);
        if (typeof opts.onUpdate === "function") opts.onUpdate(1, 1);
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        const tween = {
          view,
          from,
          to,
          duration,
          delay,
          ease,
          arcHeight,
          scaleDelay,
          onUpdate: opts.onUpdate || null,
          startTime: performance.now() + delay,
          resolve,
          started: false,
          canceled: false,
        };
        this.tweens.set(view, tween);
        this._ensureFrame();
      });
    }

    set(view, pose) {
      this.cancel(view);
      view.setPose(pose);
    }

    cancel(view) {
      const tween = this.tweens.get(view);
      if (!tween) return false;
      tween.canceled = true;
      this.tweens.delete(view);
      view.setAnimating(false);
      tween.resolve(false);
      return true;
    }

    cancelAll() {
      for (const [view, tween] of this.tweens) {
        tween.canceled = true;
        view.setAnimating(false);
        tween.resolve(false);
      }
      this.tweens.clear();
      if (this._frame != null) {
        cancelAnimationFrame(this._frame);
        this._frame = null;
      }
    }

    _ensureFrame() {
      if (this._frame != null) return;
      this._frame = requestAnimationFrame(this._tick);
    }

    _tick = (now) => {
      this._frame = null;
      for (const [view, tween] of this.tweens) {
        if (tween.canceled) continue;
        if (now < tween.startTime) {
          if (!tween.started) {
            view.setPose(tween.from);
            tween.started = true;
          }
          continue;
        }

        if (!tween.started) {
          view.setPose(tween.from);
          tween.started = true;
        }

        const raw = U.clamp((now - tween.startTime) / tween.duration, 0, 1);
        const eased = tween.ease(raw);
        const from = tween.from;
        const to = tween.to;
        const x = from.x + (to.x - from.x) * eased;
        let y = from.y + (to.y - from.y) * eased;
        if (tween.arcHeight) y -= Math.sin(Math.PI * eased) * tween.arcHeight;
        const rotation = from.rotation + (to.rotation - from.rotation) * eased;
        const scaleProgress =
          tween.scaleDelay > 0
            ? U.easeInOutCubic(
                U.clamp((raw - tween.scaleDelay) / (1 - tween.scaleDelay), 0, 1)
              )
            : eased;
        const scale = from.scale + (to.scale - from.scale) * scaleProgress;
        const opacity = from.opacity + (to.opacity - from.opacity) * eased;
        const tiltX = from.tiltX + (to.tiltX - from.tiltX) * eased;
        const tiltY = from.tiltY + (to.tiltY - from.tiltY) * eased;

        view.setPoseValues(x, y, rotation, scale, opacity, tiltX, tiltY, to.z);
        if (tween.onUpdate) tween.onUpdate(raw, eased);

        if (raw >= 1) {
          view.setPose(tween.to);
          view.setAnimating(false);
          this.tweens.delete(view);
          tween.resolve(true);
        }
      }

      if (this.tweens.size > 0) this._ensureFrame();
    };
  }

  CGE.Animator = Animator;
})(window);
