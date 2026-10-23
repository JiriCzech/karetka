/* View coordination: owns card DOM, the hand's visual layout, pile presentation
   and the choreography of draw / cast / discard / destroy animations. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;

  class TableRenderer {
    constructor(options) {
      this.stage = options.stage;
      this.cardLayer = options.cardLayer;
      this.effectsLayer = options.effectsLayer;
      this.engine = options.engine;
      this.bus = options.bus;
      this.config = options.config || CGE.CONFIG;
      this.playZone = options.playZone;
      this.deckZone = options.deckZone;
      this.discardZone = options.discardZone;
      this.deckStack = options.deckStack;
      this.discardStack = options.discardStack;
      this.deckEmpty = options.deckEmpty;
      this.discardEmpty = options.discardEmpty;
      this.deckCount = options.deckCount;
      this.discardCount = options.discardCount;
      this.probe = options.probe;

      this.animator = new CGE.Animator();
      this.views = new Map();
      this.cardSize = { width: 180, height: 257 };
      this.hoveredId = null;
      this.draggingId = null;
      this.discardTopId = null;
      this.discardTopView = null;
      this.deckLayerEls = [];
      this.deckTopEl = null;
      this._visibleDeckLayers = -1;
      this._visibleDiscardEdges = -1;
      this._lastDeckCount = -1;
      this._lastDiscardCount = -1;
      this._lastDiscardEmpty = null;
      this.playZoneRect = null;
      this.deckStackRect = null;
      this.discardStackRect = null;
      this._resizeFrame = null;
      this._timers = new Set();
      this._unsubs = [];
      this._mounted = false;
    }

    init() {
      this._measure();
      this._buildDeckStackPool();
      this._bindEvents();
      this._mounted = true;
      this.updatePiles();
      this.reflowHand({ instant: true });

      if (typeof ResizeObserver !== "undefined") {
        this._resizeObserver = new ResizeObserver(() => this._queueResize());
        this._resizeObserver.observe(this.stage);
      } else {
        global.addEventListener("resize", () => this._queueResize());
      }
      return this;
    }

    _bindEvents() {
      this._unsubs.push(
        this.bus.on("card:drawn", ({ card }) => {
          this.animateDraw(card).catch((error) => console.error("[Arcana draw]", error));
        }),
        this.bus.on("card:played", (outcome) => {
          this.playOutCard(outcome).catch((error) => console.error("[Arcana play]", error));
        }),
        this.bus.on("state:changed", () => this.updatePiles()),
        this.bus.on("game:reset", () => this.resetVisuals())
      );
    }

    destroy() {
      for (const unsubscribe of this._unsubs) unsubscribe();
      this._unsubs = [];
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this.animator.cancelAll();
      for (const timer of this._timers) clearTimeout(timer);
      this._timers.clear();
      for (const view of this.views.values()) view.destroy();
      this.views.clear();
    }

    _measure() {
      const probeRect = this.probe.getBoundingClientRect();
      this.cardSize.width = probeRect.width || 180;
      this.cardSize.height = probeRect.height || 257;
      this.stageRect = this.stage.getBoundingClientRect();
      this.layerRect = this.cardLayer.getBoundingClientRect();
      this.playZoneRect = this.playZone.getBoundingClientRect();
      this.deckStackRect = this.deckStack.getBoundingClientRect();
      this.discardStackRect = this.discardStack.getBoundingClientRect();
      for (const view of this.views.values()) {
        view.setDimensions(this.cardSize.width, this.cardSize.height);
      }
    }

    _queueResize() {
      if (this._resizeFrame != null) return;
      this._resizeFrame = requestAnimationFrame(() => {
        this._resizeFrame = null;
        this._handleResize();
      });
    }

    _handleResize() {
      this._measure();
      this.reflowHand({ animate: true, resize: true });
      if (this.discardTopView) {
        const pose = this.getDiscardPose();
        pose.rotation = -2;
        pose.z = 90;
        this.discardTopView.setPose(pose);
      }
      if (this.hoveredId) {
        const view = this.views.get(this.hoveredId);
        if (view && view.mode === "hand") this._applyHoverPose(view);
      }
      this.updatePiles();
    }

    _later(fn, delay) {
      const id = setTimeout(() => {
        this._timers.delete(id);
        fn();
      }, delay);
      this._timers.add(id);
      return id;
    }

    /* ----------------------------- piles -------------------------------- */

    updatePiles() {
      const counts = this.engine.getCounts();

      if (counts.deck !== this._lastDeckCount) {
        this._lastDeckCount = counts.deck;
        this.deckCount.textContent = String(counts.deck);
        this.deckZone.classList.toggle("is-empty", counts.deck === 0);
        this.deckZone.setAttribute(
          "aria-label",
          counts.deck > 0
            ? `Draw pile, ${counts.deck} cards. Draw a card.`
            : "Draw pile, empty."
        );
        this._renderDeckStack(counts.deck);
      }

      if (counts.discard !== this._lastDiscardCount) {
        this._lastDiscardCount = counts.discard;
        this.discardCount.textContent = String(counts.discard);
        this._renderDiscardEdges(counts.discard);
      }

      const discardEmpty = counts.discard === 0 || !this.discardTopView;
      if (discardEmpty !== this._lastDiscardEmpty) {
        this._lastDiscardEmpty = discardEmpty;
        this.discardZone.classList.toggle("is-empty", discardEmpty);
      }
    }

    /**
     * A fixed pool of eight layer nodes covers every pile size. The visible
     * subset changes, but the DOM is never rebuilt during a draw. That removes
     * the texture pop while keeping the pile thickness tied to card count.
     */
    _buildDeckStackPool() {
      if (this.deckLayerEls.length) return;
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < 8; i += 1) {
        const layer = document.createElement("span");
        layer.className = "deck-layer is-hidden";
        layer.innerHTML = `<span class="deck-layer__sigil" aria-hidden="true">${CGE.CARD_BACK_SIGIL || ""}</span>`;
        fragment.appendChild(layer);
        this.deckLayerEls.push(layer);
      }
      this.deckStack.appendChild(fragment);
    }

    _renderDeckStack(count) {
      const visible = count <= 0 ? 0 : Math.min(this.deckLayerEls.length, count);
      if (visible === this._visibleDeckLayers) return;
      this._visibleDeckLayers = visible;

      for (let i = 0; i < this.deckLayerEls.length; i += 1) {
        const layer = this.deckLayerEls[i];
        const isVisible = i < visible;
        layer.classList.toggle("is-hidden", !isVisible);
        layer.classList.toggle("is-top", i === visible - 1);
        if (!isVisible) continue;

        const offsetIndex = i - (visible - 1) / 2;
        const rotation =
          visible === 1
            ? 0
            : offsetIndex * 0.34 + (i % 2 ? 0.14 : -0.14);
        layer.style.setProperty("--tx", (offsetIndex * 1.15).toFixed(2) + "px");
        layer.style.setProperty("--ty", (-i * 2.9).toFixed(2) + "px");
        layer.style.setProperty("--rot", rotation.toFixed(2) + "deg");
        layer.style.zIndex = String(i + 1);
      }

      this.deckTopEl = visible > 0 ? this.deckLayerEls[visible - 1] : null;
    }

    _renderDiscardEdges(count) {
      if (!this.discardStack.dataset.ready) {
        for (let i = 0; i < 4; i += 1) {
          const edge = document.createElement("span");
          edge.className = "discard-edge is-hidden";
          this.discardStack.appendChild(edge);
        }
        this.discardStack.dataset.ready = "true";
      }

      // The top card is a real card view, so count 1 gets zero decorative
      // edges. Counts 2+ reveal exactly count-1 edges, capped at four.
      const visible = count <= 1 ? 0 : Math.min(4, count - 1);
      this.discardStack.style.opacity = count > 0 ? "" : "0.22";
      if (visible === this._visibleDiscardEdges) return;
      this._visibleDiscardEdges = visible;
      const edges = this.discardStack.querySelectorAll(".discard-edge");
      edges.forEach((edge, index) => {
        edge.classList.toggle("is-hidden", index >= visible);
      });
    }

    getDeckPose() {
      const rect = this.deckStackRect;
      const visible = this._visibleDeckLayers;
      const topIndex = Math.max(0, visible - 1);
      const ty = visible > 0 ? -topIndex * 2.9 : 0;
      const tx = visible > 0 ? (topIndex / 2) * 1.15 : 0;
      const rotation =
        visible <= 1
          ? 0
          : (topIndex / 2) * 0.34 + (topIndex % 2 ? 0.14 : -0.14);
      const hoverLift = this.deckZone.matches(":hover") ? -7 : 0;
      // Match the actual top layer's rotation. Starting at an arbitrary angle
      // makes the back appear to twist (and its motif to change) on click.
      const pose = this._poseFromRect(rect, rotation, 2400);
      pose.x += tx;
      pose.y += ty + hoverLift;
      return pose;
    }

    getDiscardPose() {
      return this._poseFromRect(this.discardStackRect, -4, 90);
    }

    getPlayPose() {
      const pose = this._poseFromRect(this.playZoneRect, 0, 5000);
      pose.scale = 1.02;
      return pose;
    }

    getPlayZoneRect() {
      return this.playZoneRect;
    }

    getLayerRect() {
      return this.layerRect;
    }

    _poseFromRect(rect, rotation, z) {
      const scale = rect.width / this.cardSize.width;
      return {
        x: rect.left - this.layerRect.left + rect.width / 2,
        y: rect.top - this.layerRect.top + rect.height / 2,
        rotation: rotation || 0,
        scale: scale || 1,
        opacity: 1,
        tiltX: 0,
        tiltY: 0,
        z: z || 100,
      };
    }

    /* ------------------------------ views ------------------------------- */

    createView(card, mode, concealed) {
      const view = new CGE.CardView(card, {
        width: this.cardSize.width,
        height: this.cardSize.height,
        mode: mode || "hand",
        concealed: Boolean(concealed),
      });
      this.views.set(card.instanceId, view);
      this.cardLayer.appendChild(view.el);
      return view;
    }

    removeView(view) {
      if (!view) return;
      this.animator.cancel(view);
      if (this.hoveredId === view.instance.instanceId) this.hoveredId = null;
      if (this.draggingId === view.instance.instanceId) this.draggingId = null;
      this.views.delete(view.instance.instanceId);
      view.destroy();
    }

    resetVisuals() {
      this.animator.cancelAll();
      for (const view of Array.from(this.views.values())) {
        view.destroy();
      }
      this.views.clear();
      this.hoveredId = null;
      this.draggingId = null;
      this.discardTopId = null;
      this.discardTopView = null;
      this._visibleDeckLayers = -1;
      this._visibleDiscardEdges = -1;
      this._lastDeckCount = -1;
      this._lastDiscardCount = -1;
      this._lastDiscardEmpty = null;
      this.playZone.classList.remove("is-dragover", "is-casting");
      this.updatePiles();
    }

    /* --------------------------- hand layout ---------------------------- */

    reflowHand(options) {
      const opts = options || {};
      const hand = this.engine.state.hand;
      const eligible = [];
      for (const card of hand) {
        const view = this.views.get(card.instanceId);
        if (!view) continue;
        if (view.mode === "dragging" || view.mode === "playing" || view.mode === "destroying") {
          continue;
        }
        eligible.push({ card, view });
      }

      const poses = CGE.computeHandLayout({
        stageWidth: this.stageRect.width,
        stageHeight: this.stageRect.height,
        cardWidth: this.cardSize.width,
        cardHeight: this.cardSize.height,
        count: eligible.length,
        config: this.config,
      });

      eligible.forEach(({ view }, index) => {
        const rest = poses[index];
        if (!rest) return;
        view.restPose = rest;

        if (view.mode === "drawing" || view.mode === "returning") {
          return;
        }

        const hovering = this.hoveredId === view.instance.instanceId;
        const target = hovering
          ? CGE.computeHoverPose(rest, {
              stageWidth: this.stageRect.width,
              stageHeight: this.stageRect.height,
              cardWidth: this.cardSize.width,
              cardHeight: this.cardSize.height,
              config: this.config,
            })
          : rest;

        if (view.mode === "hand") {
          if (opts.instant) {
            if (!this._poseMatches(view.pose, target)) view.setPose(target);
          } else if (
            !this._poseMatches(view.pose, target) &&
            !(
              this.animator.tweens.has(view) &&
              this._poseMatches(this.animator.tweens.get(view).to, target)
            )
          ) {
            this.animator.tweenTo(view, target, {
              duration: opts.resize ? 180 : this.config.motion.reflow,
              ease: U.easeOutCubic,
            });
          }
        }
      });
    }

    _poseMatches(a, b) {
      return (
        Math.abs(a.x - b.x) < 0.3 &&
        Math.abs(a.y - b.y) < 0.3 &&
        Math.abs(a.rotation - b.rotation) < 0.04 &&
        Math.abs(a.scale - b.scale) < 0.0015 &&
        Math.abs(a.opacity - b.opacity) < 0.005 &&
        Math.abs(a.tiltX - b.tiltX) < 0.05 &&
        Math.abs(a.tiltY - b.tiltY) < 0.05 &&
        Math.round(a.z) === Math.round(b.z)
      );
    }

    _applyHoverPose(view) {
      if (!view.restPose) return;
      const target = CGE.computeHoverPose(view.restPose, {
        stageWidth: this.stageRect.width,
        stageHeight: this.stageRect.height,
        cardWidth: this.cardSize.width,
        cardHeight: this.cardSize.height,
        config: this.config,
      });
      this.animator.tweenTo(view, target, {
        duration: this.config.motion.hoverIn,
        ease: U.easeOutCubic,
      });
    }

    hitTestHand(clientX, clientY) {
      const point = this._toLayerPoint(clientX, clientY);
      const hovered = this.hoveredId ? this.views.get(this.hoveredId) : null;
      if (hovered && hovered.mode === "hand") {
        if (
          U.pointInRotatedRect(
            point.x,
            point.y,
            hovered.pose.x,
            hovered.pose.y,
            this.cardSize.width * hovered.pose.scale,
            this.cardSize.height * hovered.pose.scale,
            hovered.pose.rotation
          )
        ) {
          return hovered.instance.instanceId;
        }
      }

      const hand = this.engine.state.hand;
      for (let i = hand.length - 1; i >= 0; i -= 1) {
        const card = hand[i];
        const view = this.views.get(card.instanceId);
        if (!view || view.mode !== "hand") continue;
        if (
          U.pointInRotatedRect(
            point.x,
            point.y,
            view.pose.x,
            view.pose.y,
            this.cardSize.width * view.pose.scale,
            this.cardSize.height * view.pose.scale,
            view.pose.rotation
          )
        ) {
          return card.instanceId;
        }
      }
      return null;
    }

    getViewAtPoint(clientX, clientY) {
      const id = this.hitTestHand(clientX, clientY);
      return id ? this.views.get(id) : null;
    }

    setHovered(instanceId) {
      if (this.draggingId) return;
      if (this.hoveredId === instanceId) return;

      const previous = this.hoveredId ? this.views.get(this.hoveredId) : null;
      if (previous) {
        previous.setHovered(false);
        if (previous.mode === "hand" && previous.restPose) {
          this.animator.tweenTo(previous, previous.restPose, {
            duration: this.config.motion.hoverOut,
            ease: U.easeOutCubic,
          });
        }
      }

      this.hoveredId = instanceId || null;
      if (!instanceId) return;

      const view = this.views.get(instanceId);
      if (!view || view.mode !== "hand" || !view.restPose) {
        this.hoveredId = null;
        return;
      }
      view.setHovered(true);
      this._applyHoverPose(view);
    }

    clearHover() {
      this.setHovered(null);
    }

    _toLayerPoint(clientX, clientY) {
      return {
        x: clientX - this.layerRect.left,
        y: clientY - this.layerRect.top,
      };
    }

    /* ------------------------------ drawing ----------------------------- */

    async animateDraw(card) {
      if (this.views.has(card.instanceId)) return;
      const view = this.createView(card, "drawing", true);
      const start = this.getDeckPose();
      view.setPose(Object.assign({}, start, { z: 2400, opacity: 1 }));
      this.reflowHand({ animate: true });

      const target = Object.assign({}, view.restPose || CGE.computeHandLayout({
        stageWidth: this.stageRect.width,
        stageHeight: this.stageRect.height,
        cardWidth: this.cardSize.width,
        cardHeight: this.cardSize.height,
        count: this.engine.state.hand.length,
        config: this.config,
      })[0], {
        z: 2400,
        opacity: 1,
      });

      const compact = this.stageRect.width < 700;
      let revealed = false;
      const flight = this.animator.tweenTo(view, target, {
        duration: this.config.motion.draw,
        ease: U.easeInOutCubic,
        arcHeight: compact ? 56 : 94,
        // Keep the emerging card exactly deck-sized while it is still over the
        // pile, then grow it after it has cleared the stack. This removes the
        // misleading moment where two differently sized card backs overlap.
        scaleDelay: 0.36,
        onUpdate: (raw) => {
          if (!revealed && raw >= 0.47) {
            revealed = true;
            view.setConcealed(false);
            view.el.classList.add("is-drawing");
          }
        },
      });

      const completed = await flight;
      if (!this.views.has(card.instanceId) || !view.el) return;
      if (!completed) {
        // An interrupted flight (reset / resize conflict) still settles safely.
        if (view.mode === "drawing") {
          view.setMode("hand");
          view.setConcealed(false);
        }
        return;
      }
      view.setConcealed(false);
      view.setMode("hand");
      this.reflowHand({ animate: true });
    }

    /* --------------------------- drag lifecycle ------------------------- */

    beginDrag(view) {
      this.clearHover();
      this.animator.cancel(view);
      this.draggingId = view.instance.instanceId;
      view.setHovered(false);
      view.setMode("dragging");
      view.setDragging(true);
      view.setPose({ z: 4500, scale: Math.max(1.06, view.pose.scale), opacity: 1 });
      this.reflowHand({ animate: true });
    }

    endDrag() {
      this.draggingId = null;
    }

    returnCardToHand(view) {
      if (!view || !view.el) return;
      const stillInHand = this.engine.state.hand.some(
        (card) => card.instanceId === view.instance.instanceId
      );
      if (!stillInHand) {
        this.removeView(view);
        return;
      }
      this.draggingId = null;
      view.setMode("returning");
      view.setDragging(false);
      this.reflowHand({ animate: true });
      const target = Object.assign({}, view.restPose || view.pose, {
        z: 1400,
        scale: 1,
        opacity: 1,
        tiltX: 0,
        tiltY: 0,
        rotation: view.restPose ? view.restPose.rotation : 0,
      });
      this.animator
        .tweenTo(view, target, {
          duration: this.config.motion.dragReturn,
          ease: U.easeOutCubic,
          arcHeight: 14,
        })
        .then((completed) => {
          if (!completed || !view.el || !this.views.has(view.instance.instanceId)) return;
          if (view.mode !== "returning") return;
          view.setMode("hand");
          this.reflowHand({ animate: true });
        });
    }

    /* ------------------------------- play ------------------------------- */

    async playOutCard(outcome) {
      const card = outcome.card;
      const view = this.views.get(card.instanceId);
      if (!view || !view.el) return;
      this.draggingId = null;
      this.clearHover();
      this.animator.cancel(view);
      view.setMode("playing");
      view.setDragging(false);
      this.reflowHand({ animate: true });

      const playPose = this.getPlayPose();
      playPose.rotation = 0;
      playPose.tiltX = 0;
      playPose.tiltY = 0;
      playPose.z = 5000;
      playPose.opacity = 1;

      const arrived = await this.animator.tweenTo(view, playPose, {
        duration: this.config.motion.cast,
        ease: U.easeOutCubic,
      });
      if (!arrived || !this.views.has(card.instanceId) || !view.el) return;

      const center = {
        x: playPose.x + this.layerRect.left,
        y: playPose.y + this.layerRect.top,
      };
      this._showCastEffect(center, outcome);
      this.playZone.classList.add("is-casting");
      this._later(() => this.playZone.classList.remove("is-casting"), 680);
      await U.wait(U.prefersReducedMotion() ? 20 : 185);
      if (!this.views.has(card.instanceId) || !view.el) return;

      if (outcome.disposition === "destroy") {
        await this._animateDestroy(view, center, outcome);
      } else {
        await this._animateDiscard(view, outcome);
      }
    }

    async _animateDiscard(view, outcome) {
      const target = this.getDiscardPose();
      target.rotation = -7;
      target.z = 1500;
      const completed = await this.animator.tweenTo(view, target, {
        duration: this.config.motion.discardFlight,
        ease: U.easeInOutCubic,
        arcHeight: 54,
      });
      if (!completed || !this.views.has(view.instance.instanceId) || !view.el) return;

      const previousTop = this.discardTopView;
      const landing = this.getDiscardPose();
      landing.rotation = -4;
      landing.z = 90;
      view.setPose(landing);
      view.setMode("discard");
      view.setConcealed(false);
      view.el.classList.remove("is-casting");
      this.discardTopId = view.instance.instanceId;
      this.discardTopView = view;

      if (previousTop && previousTop !== view) {
        this.animator
          .tweenTo(
            previousTop,
            Object.assign({}, previousTop.pose, {
              y: previousTop.pose.y + 5,
              scale: previousTop.pose.scale * 0.965,
              opacity: 0,
              z: 80,
            }),
            { duration: 210, ease: U.easeOutCubic }
          )
          .then(() => {
            if (this.views.has(previousTop.instance.instanceId)) {
              this.removeView(previousTop);
            }
          });
      }

      const discardRect = this.discardStackRect;
      this._showDiscardLanding({
        x: discardRect.left + discardRect.width / 2,
        y: discardRect.top + discardRect.height / 2,
      });
      this.discardZone.classList.add("is-landing");
      this._later(() => this.discardZone.classList.remove("is-landing"), 520);
      this.updatePiles();
    }

    async _animateDestroy(view, center, outcome) {
      this._showDissolve(center, outcome);
      view.setMode("destroying");
      const completed = await this.animator.tweenTo(
        view,
        {
          scale: 0.16,
          opacity: 0,
          rotation: view.pose.rotation + 22,
          tiltX: -8,
          tiltY: 12,
          z: 5200,
        },
        { duration: this.config.motion.destroy, ease: U.easeInOutQuart }
      );
      if (!completed) return;
      if (this.views.has(view.instance.instanceId)) this.removeView(view);
      this.updatePiles();
    }

    /* ----------------------------- effects ------------------------------ */

    _showCastEffect(center, outcome) {
      const definition = outcome.definition;
      const sparkColor =
        (definition.palette && definition.palette.c) || "#f1d9a0";
      const burst = document.createElement("div");
      burst.className = "cast-burst";
      burst.style.left = center.x + "px";
      burst.style.top = center.y + "px";
      let sparks = "";
      for (let i = 0; i < 14; i += 1) {
        const angle = (360 / 14) * i + (i % 3) * 7;
        const radius = 60 + (i % 4) * 22;
        sparks += `<i class="cast-spark" style="--a:${angle}deg;--r:${radius}px;--spark:${sparkColor};--delay:${(i % 5) * 0.018}s"></i>`;
      }
      burst.innerHTML =
        `<span class="cast-ring"></span><span class="cast-ring is-second"></span>` +
        `<span class="cast-core"></span>${sparks}`;
      this.effectsLayer.appendChild(burst);

      const result = outcome.effectResult || {};
      const label = result.label || outcome.definition.effectLabel || "";
      const labelEl = document.createElement("div");
      labelEl.className = "cast-label";
      if (result.delta < 0) labelEl.classList.add("is-negative");
      else if (!result.delta) labelEl.classList.add("is-neutral");
      labelEl.textContent = label;
      labelEl.style.left = center.x + "px";
      labelEl.style.top = center.y + "px";
      this.effectsLayer.appendChild(labelEl);

      this._later(() => {
        burst.remove();
        labelEl.remove();
      }, 1250);
    }

    _showDiscardLanding(center) {
      const ring = document.createElement("div");
      ring.className = "discard-ring";
      ring.style.left = center.x + "px";
      ring.style.top = center.y + "px";
      this.effectsLayer.appendChild(ring);
      this._later(() => ring.remove(), 700);
    }

    _showDissolve(center, outcome) {
      const holder = document.createElement("div");
      holder.className = "cast-burst";
      holder.style.left = center.x + "px";
      holder.style.top = center.y + "px";
      const color = (outcome.definition.palette && outcome.definition.palette.c) || "#ead39a";
      let motes = "";
      for (let i = 0; i < 20; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 35 + Math.random() * 115;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 25;
        motes += `<i class="dissolve-mote" style="--dx:${dx.toFixed(1)}px;--dy:${dy.toFixed(1)}px;--s:${(2 + Math.random() * 4).toFixed(1)}px;--spark:${color};--delay:${(Math.random() * 0.1).toFixed(2)}s"></i>`;
      }
      holder.innerHTML = motes;
      this.effectsLayer.appendChild(holder);
      this._later(() => holder.remove(), 1200);
    }
  }

  CGE.TableRenderer = TableRenderer;
})(window);
