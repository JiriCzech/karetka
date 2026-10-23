/* Small dependency-free helpers shared by the engine. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = (CGE.utils = {});

  U.clamp = function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  };

  U.lerp = function lerp(a, b, t) {
    return a + (b - a) * t;
  };

  U.invLerp = function invLerp(a, b, value) {
    if (a === b) return 0;
    return U.clamp((value - a) / (b - a), 0, 1);
  };

  U.easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  U.easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  U.easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
  U.easeInOutQuart = (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
  U.easeOutBack = (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };

  U.wait = function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  U.nextFrame = function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  };

  U.escapeHtml = function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  U.pointInRect = function pointInRect(x, y, rect, padding) {
    const pad = padding || 0;
    return (
      x >= rect.left - pad &&
      x <= rect.right + pad &&
      y >= rect.top - pad &&
      y <= rect.bottom + pad
    );
  };

  /** Point test against an unrotated box, rotated around its centre. */
  U.pointInRotatedRect = function pointInRotatedRect(x, y, cx, cy, width, height, degrees) {
    const angle = (-degrees * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
    const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(localX) <= width / 2 && Math.abs(localY) <= height / 2;
  };

  U.clampToViewport = function clampToViewport(pose, width, height, stageW, stageH, padding) {
    const pad = padding || 10;
    const halfW = (width * pose.scale) / 2;
    const halfH = (height * pose.scale) / 2;
    pose.x = U.clamp(pose.x, halfW + pad, stageW - halfW - pad);
    pose.y = U.clamp(pose.y, halfH + pad, stageH - halfH - pad);
    return pose;
  };

  U.signed = function signed(value) {
    return value > 0 ? "+" + value : String(value);
  };

  U.prefersReducedMotion = function prefersReducedMotion() {
    return Boolean(
      global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  };

  U.motionDuration = function motionDuration(ms) {
    return U.prefersReducedMotion() ? Math.min(ms, 80) : ms;
  };

  /** Deterministic PRNG so the demo starts with the same pleasant spread. */
  U.mulberry32 = function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.shuffle = function shuffle(array, random) {
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const temp = array[i];
      array[i] = array[j];
      array[j] = temp;
    }
    return array;
  };

  U.rafThrottle = function rafThrottle(fn) {
    let scheduled = false;
    let lastArgs = null;
    return function throttled() {
      lastArgs = arguments;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        fn.apply(null, lastArgs);
      });
    };
  };
})(window);
