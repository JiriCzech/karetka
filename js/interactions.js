/* Pointer intent layer. Hover and drag are resolved geometrically rather than
   relying on pointerenter/leave, which keeps the enlarged card from flickering
   as it moves out from under the cursor. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;

  class InteractionController {
    constructor(options) {
      this.stage = options.stage;
      this.cardLayer = options.cardLayer;
      this.engine = options.engine;
      this.renderer = options.renderer;
      this.playZone = options.playZone;
      this.onPlayRequested = options.onPlayRequested || (() => ({ ok: false }));
      this.config = options.config || CGE.CONFIG;

      this.drag = null;
      this._dragFrame = null;
      this._shineFrame = null;
      this._shineView = null;
      this._shineX = 0;
      this._shineY = 0;
      this._lastPointerType = "mouse";
      this._unsubs = [];

      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onPointerCancel = this._onPointerCancel.bind(this);
      this._onPointerLeave = this._onPointerLeave.bind(this);
      this._onLostPointerCapture = this._onLostPointerCapture.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);
      this._tickDrag = this._tickDrag.bind(this);
      this._flushShine = this._flushShine.bind(this);

      this._bind();
    }

    _bind() {
      this.stage.addEventListener("pointerdown", this._onPointerDown);
      this.stage.addEventListener("pointermove", this._onPointerMove);
      this.stage.addEventListener("pointerup", this._onPointerUp);
      this.stage.addEventListener("pointercancel", this._onPointerCancel);
      this.stage.addEventListener("pointerleave", this._onPointerLeave);
      this.stage.addEventListener("lostpointercapture", this._onLostPointerCapture);
      global.addEventListener("keydown", this._onKeyDown);
      if (this.engine && this.engine.bus) {
        this._unsubs.push(this.engine.bus.on("game:reset", () => this.cancelDrag()));
      }
    }

    destroy() {
      this.cancelDrag(true);
      if (this._shineFrame != null) {
        cancelAnimationFrame(this._shineFrame);
        this._shineFrame = null;
      }
      this.stage.removeEventListener("pointerdown", this._onPointerDown);
      this.stage.removeEventListener("pointermove", this._onPointerMove);
      this.stage.removeEventListener("pointerup", this._onPointerUp);
      this.stage.removeEventListener("pointercancel", this._onPointerCancel);
      this.stage.removeEventListener("pointerleave", this._onPointerLeave);
      this.stage.removeEventListener("lostpointercapture", this._onLostPointerCapture);
      global.removeEventListener("keydown", this._onKeyDown);
      for (const unsubscribe of this._unsubs) unsubscribe();
      this._unsubs = [];
    }

    _eventToView(event) {
      const target = event.target instanceof Element ? event.target.closest(".card") : null;
      if (!target) return null;
      const id = target.dataset.cardId;
      return id ? this.renderer.views.get(id) || null : null;
    }

    _onPointerDown(event) {
      if (event.button != null && event.button !== 0) return;
      if (this.drag) return;
      this._lastPointerType = event.pointerType || "mouse";

      const view = this._eventToView(event);
      if (!view || view.mode !== "hand") return;
      if (!this.engine.state.hand.some((card) => card.instanceId === view.instance.instanceId)) {
        return;
      }

      event.preventDefault();
      this._lastPointerType = event.pointerType || "mouse";

      const layerRect = this.renderer.getLayerRect();
      const playZoneRect = this.renderer.getPlayZoneRect();
      const centerX = layerRect.left + view.pose.x;
      const centerY = layerRect.top + view.pose.y;
      const scaledWidth = view.width * view.pose.scale;
      const scaledHeight = view.height * view.pose.scale;
      const offsetX = U.clamp(centerX - event.clientX, -scaledWidth * 0.28, scaledWidth * 0.28);
      const offsetY = U.clamp(centerY - event.clientY, -scaledHeight * 0.27, scaledHeight * 0.18);

      this.renderer.clearHover();
      this.renderer.beginDrag(view);

      this.drag = {
        view,
        pointerId: event.pointerId,
        layerRect,
        playZoneRect,
        offsetX,
        offsetY,
        targetX: event.clientX + offsetX,
        targetY: event.clientY + offsetY - 14,
        rotation: view.restPose ? view.restPose.rotation * 0.2 : 0,
        tiltX: 0,
        tiltY: 0,
        scale: 1.085,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: performance.now(),
        overZone: false,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };

      try {
        this.stage.setPointerCapture(event.pointerId);
      } catch (error) {
        // Pointer capture is an enhancement; document-level bubbling is enough.
      }

      this._setZoneActive(false);
      this._startDragLoop();
    }

    _onPointerMove(event) {
      if (this.drag && event.pointerId === this.drag.pointerId) {
        event.preventDefault();
        const drag = this.drag;
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        const now = performance.now();
        const dt = Math.max(8, now - drag.lastTime);
        drag.lastTime = now;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        drag.pointerX = event.clientX;
        drag.pointerY = event.clientY;

        drag.targetX = event.clientX + drag.offsetX;
        drag.targetY = event.clientY + drag.offsetY - 14;

        const speedX = (dx / dt) * 1000;
        const speedY = (dy / dt) * 1000;
        const restRotation = drag.view.restPose ? drag.view.restPose.rotation : 0;
        drag.rotation = restRotation * 0.18 + U.clamp(speedX * 0.011, -8, 8);
        drag.tiltY = U.clamp(speedX * 0.006, -12, 12);
        drag.tiltX = U.clamp(-speedY * 0.005, -9, 9);
        drag.scale = 1.085;
        this._updateZoneState();
        return;
      }

      if (this._lastPointerType === "touch" && event.pointerType === "touch") return;
      if (event.pointerType === "touch") return;

      const id = this.renderer.hitTestHand(event.clientX, event.clientY);
      if (id !== this.renderer.hoveredId) {
        this.renderer.setHovered(id);
      }
      if (id) {
        const view = this.renderer.views.get(id);
        if (view) this._queueShine(view, event.clientX, event.clientY);
      }
    }

    _queueShine(view, clientX, clientY) {
      this._shineView = view;
      this._shineX = clientX;
      this._shineY = clientY;
      if (this._shineFrame == null) {
        this._shineFrame = requestAnimationFrame(this._flushShine);
      }
    }

    _flushShine() {
      this._shineFrame = null;
      if (!this._shineView || !this._shineView.el) return;
      this._shineView.setShineFromClient(
        this._shineX,
        this._shineY,
        this.renderer.getLayerRect()
      );
    }

    _onPointerUp(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      event.preventDefault();
      const drag = this.drag;
      const view = drag.view;

      // Use the latest ResizeObserver-updated zone if the window changed mid-drag.
      drag.playZoneRect = this.renderer.getPlayZoneRect();
      this._updateZoneState();
      const valid = drag.overZone;
      this._stopDragLoop();
      this.drag = null;
      this.renderer.endDrag();
      view.setDragging(false);
      this._setZoneActive(false);

      try {
        if (this.stage.hasPointerCapture(event.pointerId)) {
          this.stage.releasePointerCapture(event.pointerId);
        }
      } catch (error) {
        // No capture to release.
      }

      if (valid) {
        const outcome = this.onPlayRequested(view);
        if (!outcome || !outcome.ok) {
          this.renderer.returnCardToHand(view);
          this._pulseZoneDenied();
        }
      } else {
        this.renderer.returnCardToHand(view);
      }
    }

    _onPointerCancel(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.cancelDrag();
    }

    _onPointerLeave(event) {
      if (this.drag) return;
      if (event.relatedTarget) return;
      this.renderer.clearHover();
    }

    _onLostPointerCapture(event) {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      if (this._releasingCapture) return;
      this.cancelDrag();
    }

    _onKeyDown(event) {
      if (event.key === "Escape" && this.drag) {
        this.cancelDrag();
      }
    }

    _startDragLoop() {
      if (this._dragFrame != null) return;
      this._dragFrame = requestAnimationFrame(this._tickDrag);
    }

    _stopDragLoop() {
      if (this._dragFrame != null) {
        cancelAnimationFrame(this._dragFrame);
        this._dragFrame = null;
      }
    }

    _tickDrag(now) {
      this._dragFrame = null;
      const drag = this.drag;
      if (!drag || !drag.view.el) return;

      const dt = Math.min(34, Math.max(8, now - (drag.frameTime || now - 16)));
      drag.frameTime = now;
      const follow = 1 - Math.exp(-dt / 34);
      const settle = 1 - Math.exp(-dt / 150);
      const view = drag.view;
      const restRotation = view.restPose ? view.restPose.rotation : 0;

      view.pose.x += (drag.targetX - view.pose.x) * follow;
      view.pose.y += (drag.targetY - view.pose.y) * follow;
      view.pose.rotation += (drag.rotation - view.pose.rotation) * follow;
      view.pose.scale += (drag.scale - view.pose.scale) * follow;
      view.pose.tiltX += (drag.tiltX - view.pose.tiltX) * follow;
      view.pose.tiltY += (drag.tiltY - view.pose.tiltY) * follow;
      view.pose.z = 4500;
      view.applyPose();
      view.setShineFromClient(drag.pointerX, drag.pointerY, drag.layerRect);

      drag.rotation += (restRotation * 0.18 - drag.rotation) * settle;
      drag.tiltX *= 1 - settle * 0.9;
      drag.tiltY *= 1 - settle * 0.9;

      this._dragFrame = requestAnimationFrame(this._tickDrag);
    }

    _playZoneRect() {
      return this.drag ? this.drag.playZoneRect : this.renderer.getPlayZoneRect();
    }

    _cardCenterClient(drag) {
      return {
        x: drag.targetX + drag.layerRect.left,
        y: drag.targetY + drag.layerRect.top,
      };
    }

    _isOverPlayZone() {
      if (!this.drag) return false;
      const rect = this._playZoneRect();
      const center = this._cardCenterClient(this.drag);
      const pointerInside = U.pointInRect(this.drag.pointerX, this.drag.pointerY, rect, 4);
      const cardInside = U.pointInRect(center.x, center.y, rect, 18);
      return pointerInside || cardInside;
    }

    _updateZoneState() {
      if (!this.drag) return;
      const over = this._isOverPlayZone();
      if (over !== this.drag.overZone) {
        this.drag.overZone = over;
        this._setZoneActive(over);
      }
    }

    _setZoneActive(active) {
      this.playZone.classList.toggle("is-dragover", Boolean(active));
    }

    _pulseZoneDenied() {
      this.playZone.classList.remove("is-casting");
      requestAnimationFrame(() => {
        this.playZone.classList.add("is-casting");
        setTimeout(() => this.playZone.classList.remove("is-casting"), 620);
      });
    }

    cancelDrag(silent) {
      if (!this.drag) return;
      const drag = this.drag;
      this._stopDragLoop();
      this.drag = null;
      this.renderer.endDrag();
      drag.view.setDragging(false);
      this._setZoneActive(false);

      if (!silent && this.renderer.views.has(drag.view.instance.instanceId)) {
        this.renderer.returnCardToHand(drag.view);
      }
    }
  }

  CGE.InteractionController = InteractionController;
})(window);
