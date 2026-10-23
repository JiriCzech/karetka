/* DOM representation of one card instance. Purely visual: it knows nothing
   about game rules, hand order or legal targets. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;
  const esc = U.escapeHtml;

  const RUNES = {
    spark: `
      <path d="M50 10 58 40 88 50 58 60 50 104 42 60 12 50 42 40 50 10Z" stroke-width="1.4"/>
      <path d="M50 31 55 45 69 50 55 55 50 78 45 55 31 50 45 45 50 31Z" stroke-width=".9" opacity=".75"/>
      <circle cx="50" cy="50" r="38" stroke-width=".7" stroke-dasharray="1 6" opacity=".7"/>`,
    surge: `
      <circle cx="50" cy="54" r="33" stroke-width=".8" stroke-dasharray="2 6"/>
      <circle cx="50" cy="54" r="22" stroke-width="1.1"/>
      <path d="M53 16 31 61h17l-5 35 27-49H54l7-31Z" stroke-width="1.4"/>
      <path d="M16 78c14 9 54 9 68 0M20 91c11 5 49 5 60 0" stroke-width=".7" opacity=".55"/>`,
    siphon: `
      <path d="M68 17a41 41 0 1 0 14 56A34 34 0 0 1 68 17Z" stroke-width="1.3"/>
      <path d="M67 32v48M51 64l16 18 16-18" stroke-width="1.1"/>
      <path d="M26 33l9 13 9-13M21 49l9 13 9-13M29 65l9 13 9-13" stroke-width=".8" opacity=".72"/>
      <circle cx="67" cy="54" r="48" stroke-width=".6" stroke-dasharray="1 8" opacity=".5"/>`,
    hex: `
      <path d="M50 13 88 80H12L50 13Z" stroke-width="1.2"/>
      <path d="M23 68c14-21 40-21 54 0-14 21-40 21-54 0Z" stroke-width="1.1"/>
      <circle cx="50" cy="68" r="7" stroke-width="1.4"/>
      <path d="M50 68 50 26M50 92v20M18 95l12-16M82 95 70 79" stroke-width=".8" opacity=".6"/>
      <circle cx="50" cy="68" r="43" stroke-width=".6" stroke-dasharray="1 5" opacity=".55"/>`,
    hourglass: `
      <circle cx="50" cy="58" r="35" stroke-width=".8"/>
      <circle cx="50" cy="58" r="43" stroke-width=".55" stroke-dasharray="2 8" opacity=".6"/>
      <path d="M31 20h38M31 96h38M36 20c0 27 14 27 14 38s-14 11-14 38M64 20c0 27-14 27-14 38s14 11 14 38" stroke-width="1.3"/>
      <path d="M43 84c4-8 10-8 14 0M45 40c3 7 7 7 10 0" stroke-width=".8" opacity=".7"/>
      <path d="M50 58v-26M50 58l15 9" stroke-width=".9" opacity=".8"/>`,
    void: `
      <circle cx="50" cy="55" r="19" stroke-width="1.3"/>
      <circle cx="50" cy="55" r="33" stroke-width=".7" stroke-dasharray="1 7"/>
      <path d="M50 7v18M50 85v18M12 55h18M70 55h18M23 28l13 13M64 69l13 13M77 28 64 41M36 69 23 82" stroke-width="1"/>
      <path d="M50 36 59 55 50 74 41 55 50 36Z" stroke-width=".8" opacity=".8"/>`,
    aurora: `
      <path d="M14 80c18 0 20-54 36-54s16 38 36 38" stroke-width="1.3"/>
      <path d="M13 92c18 0 24-40 37-40s18 26 37 26" stroke-width=".8" opacity=".6"/>
      <circle cx="50" cy="54" r="9" stroke-width=".9"/>
      <path d="M50 12v13M25 20l7 11M75 20l-7 11" stroke-width=".7" opacity=".55"/>`,
  };

  function runeMarkup(name) {
    return RUNES[name] || RUNES.spark;
  }

  const BACK_SIGIL_SVG = `
    <svg viewBox="0 0 100 100" fill="none">
      <path d="M50 5 95 50 50 95 5 50 50 5Z" stroke="currentColor" stroke-width="1"/>
      <path d="M50 21 79 50 50 79 21 50 50 21Z" stroke="currentColor" stroke-width=".65" opacity=".65"/>
      <circle cx="50" cy="50" r="12" stroke="currentColor" stroke-width=".9"/>
      <path d="M50 32v36M32 50h36" stroke="currentColor" stroke-width=".55" opacity=".7"/>
    </svg>`;

  const BACK_MARKUP = `
    <div class="card-face card-back" aria-hidden="true">
      <div class="card-back__sigil">${BACK_SIGIL_SVG}</div>
    </div>`;

  class CardView {
    constructor(instance, options) {
      this.instance = instance;
      this.definition = instance.definition;
      this.options = options || {};
      this.width = this.options.width || 180;
      this.height = this.options.height || 257;
      this.el = null;
      this.pose = {
        x: 0,
        y: 0,
        rotation: 0,
        scale: 1,
        opacity: 1,
        tiltX: 0,
        tiltY: 0,
        z: 100,
      };
      this.restPose = null;
      this.mode = this.options.mode || "hand";
      this._animating = false;
      this._lastTransform = "";
      this._lastOpacity = "";
      this._lastZ = "";
      this._lastTilt = "";
      this._build();
    }

    _build() {
      const definition = this.definition;
      const el = CardView._templateFor(definition).cloneNode(true);
      el.dataset.cardId = this.instance.instanceId;
      el.dataset.definitionId = definition.id;
      el.dataset.zone = this.instance.zone || "deck";
      el.setAttribute(
        "aria-label",
        `${definition.name}. ${definition.type || "Spell"}. ${definition.effectLabel}.`
      );

      this.el = el;
      this.tiltEl = el.querySelector(".card-tilt");
      this.shineEl = el.querySelector(".card__shine");
      this.frontEl = el.querySelector(".card-front");

      if (this.options.concealed) {
        el.classList.add("is-concealed");
      }
      this._syncModeClass();
      this.setPose(this.pose);
    }

    /**
     * A card is a fairly rich piece of DOM. Parse it once per definition and
     * clone it for every instance instead of rebuilding the full markup on each
     * draw. Cloning keeps instances independent while moving real work out of
     * the animation path.
     */
    static _templateFor(definition) {
      if (CardView._templates.has(definition.id)) {
        return CardView._templates.get(definition.id);
      }

      const palette = definition.palette || { a: "#18252a", b: "#315960", c: "#a8d6d0" };
      const rune = runeMarkup(definition.rune);
      const art = definition.artwork
        ? `<img class="art-image" src="${esc(definition.artwork)}" alt="" decoding="async" draggable="false">`
        : `<div class="art-backdrop"></div>
           <div class="art-orb"></div>
           <div class="art-particles"></div>
           <div class="card__rune" aria-hidden="true">
             <svg viewBox="0 0 100 120" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${rune}</svg>
           </div>
           <div class="art-vignette"></div>`;

      const cost = Number.isFinite(definition.cost) ? definition.cost : "";
      const rarity = definition.rarity || "common";

      const el = document.createElement("article");
      el.className = "card";
      el.setAttribute("aria-roledescription", "card");
      el.style.setProperty("--art-a", palette.a);
      el.style.setProperty("--art-b", palette.b);
      el.style.setProperty("--art-c", palette.c);
      el.innerHTML = `
        <div class="card-tilt">
          <div class="card-flip">
            <div class="card-face card-front">
              <div class="card__art" aria-hidden="true">${art}</div>
              <div class="card__cost" aria-hidden="true"><span>${esc(cost)}</span></div>
              <div class="card__rarity" data-rarity="${esc(rarity)}" aria-hidden="true"><i></i><i></i><i></i></div>
              <div class="card__title">${esc(definition.name)}</div>
              <div class="card__type">${esc(definition.type || "Spell")}</div>
              <div class="card__text">${esc(definition.description || "")}</div>
              <div class="card__effect">
                <span class="card__effect-gem" aria-hidden="true"></span>
                <span>${esc(definition.effectLabel || "")}</span>
              </div>
              <span class="card__corner card__corner--tl" aria-hidden="true"></span>
              <span class="card__corner card__corner--tr" aria-hidden="true"></span>
              <span class="card__corner card__corner--bl" aria-hidden="true"></span>
              <span class="card__corner card__corner--br" aria-hidden="true"></span>
              <div class="card__shine" aria-hidden="true"></div>
            </div>
            ${BACK_MARKUP}
          </div>
        </div>`;

      CardView._templates.set(definition.id, el);
      return el;
    }

    static prewarm(definitions) {
      for (const definition of definitions) {
        this._templateFor(definition);
      }
    }

    setMode(mode) {
      this.mode = mode;
      if (!this.el) return;
      this.el.dataset.zone = mode;
      this._syncModeClass();
    }

    _syncModeClass() {
      if (!this.el) return;
      const el = this.el;
      el.classList.toggle("is-static", this.mode === "discard" || this.mode === "destroyed");
      el.classList.toggle("is-drawing", this.mode === "drawing");
      el.classList.toggle("is-dragging", this.mode === "dragging");
      el.classList.toggle("is-casting", this.mode === "playing");
      el.classList.toggle("is-hovered", this.mode === "hover");
      el.classList.toggle("is-destroying", this.mode === "destroying");
      el.style.pointerEvents =
        this.mode === "hand" || this.mode === "returning" || this.mode === "dragging"
          ? "auto"
          : "none";
    }

    setDimensions(width, height) {
      this.width = width;
      this.height = height;
      this._applyTransform();
    }

    setPose(nextPose) {
      this.pose = Object.assign({}, this.pose, nextPose);
      this._applyTransform();
    }

    /** Allocation-free pose update used by the RAF animator. */
    setPoseValues(x, y, rotation, scale, opacity, tiltX, tiltY, z) {
      const pose = this.pose;
      pose.x = x;
      pose.y = y;
      pose.rotation = rotation;
      pose.scale = scale;
      pose.opacity = opacity;
      pose.tiltX = tiltX;
      pose.tiltY = tiltY;
      pose.z = z;
      this._applyTransform();
    }

    applyPose() {
      this._applyTransform();
    }

    setAnimating(animating) {
      if (!this.el || this._animating === animating) return;
      this._animating = Boolean(animating);
      this.el.classList.toggle("is-animating", this._animating);
    }

    _applyTransform() {
      if (!this.el) return;
      const pose = this.pose;
      const x = pose.x - this.width / 2;
      const y = pose.y - this.height / 2;
      const transform =
        `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) ` +
        `rotate(${pose.rotation.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
      if (transform !== this._lastTransform) {
        this.el.style.transform = transform;
        this._lastTransform = transform;
      }
      const opacity = String(pose.opacity);
      if (opacity !== this._lastOpacity) {
        this.el.style.opacity = opacity;
        this._lastOpacity = opacity;
      }
      const z = String(Math.round(pose.z || 1));
      if (z !== this._lastZ) {
        this.el.style.zIndex = z;
        this._lastZ = z;
      }
      if (this.tiltEl) {
        const tilt = `rotateX(${pose.tiltX.toFixed(2)}deg) rotateY(${pose.tiltY.toFixed(2)}deg)`;
        if (tilt !== this._lastTilt) {
          this.tiltEl.style.transform = tilt;
          this._lastTilt = tilt;
        }
      }
    }

    setTiltOnly(tiltX, tiltY) {
      this.pose.tiltX = tiltX;
      this.pose.tiltY = tiltY;
      if (!this.tiltEl) return;
      const tilt = `rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg)`;
      if (tilt !== this._lastTilt) {
        this.tiltEl.style.transform = tilt;
        this._lastTilt = tilt;
      }
    }

    setShine(x, y) {
      if (!this.shineEl) return;
      const nx = U.clamp((x / Math.max(1, this.width)) * 100, 0, 100);
      const ny = U.clamp((y / Math.max(1, this.height)) * 100, 0, 100);
      this.setShineNormalized(nx, ny);
    }

    setShineNormalized(nx, ny) {
      if (!this.shineEl) return;
      const x = (U.clamp(nx, 0, 100) / 100 - 0.5) * this.width;
      const y = (U.clamp(ny, 0, 100) / 100 - 0.5) * this.height;
      this.shineEl.style.setProperty("--sx", x.toFixed(1) + "px");
      this.shineEl.style.setProperty("--sy", y.toFixed(1) + "px");
    }

    /**
     * Map a client-space pointer onto the card's local surface using the pose
     * already held in JS. No getBoundingClientRect() in the pointer hot path.
     */
    setShineFromClient(clientX, clientY, layerRect) {
      if (!this.el) return;
      const pose = this.pose;
      const scaledWidth = this.width * pose.scale;
      const scaledHeight = this.height * pose.scale;
      const dx = clientX - (layerRect.left + pose.x);
      const dy = clientY - (layerRect.top + pose.y);
      const angle = (-pose.rotation * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const localX = dx * cos - dy * sin + scaledWidth / 2;
      const localY = dx * sin + dy * cos + scaledHeight / 2;
      this.setShineNormalized(
        (localX / Math.max(1, scaledWidth)) * 100,
        (localY / Math.max(1, scaledHeight)) * 100
      );
    }

    setConcealed(concealed) {
      if (!this.el) return;
      this.el.classList.toggle("is-concealed", Boolean(concealed));
    }

    setHovered(hovered) {
      if (!this.el) return;
      this.el.classList.toggle("is-hovered", Boolean(hovered));
    }

    setDragging(dragging) {
      if (!this.el) return;
      this.el.classList.toggle("is-dragging", Boolean(dragging));
    }

    getRect() {
      return this.el ? this.el.getBoundingClientRect() : new DOMRect();
    }

    destroy() {
      if (this.el && this.el.parentNode) {
        this.el.parentNode.removeChild(this.el);
      }
      this.el = null;
    }
  }

  CardView._templates = new Map();

  CGE.CardView = CardView;
  CGE.RUNES = RUNES;
  CGE.CARD_BACK_SIGIL = BACK_SIGIL_SVG;
})(window);
