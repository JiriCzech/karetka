/* Pure hand geometry. No DOM reads, no stored per-count positions. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});
  const U = CGE.utils;

  CGE.computeHandLayout = function computeHandLayout(options) {
    const stageWidth = options.stageWidth;
    const stageHeight = options.stageHeight;
    const cardWidth = options.cardWidth;
    const cardHeight = options.cardHeight;
    const count = Math.max(0, options.count);
    const config = options.config || CGE.CONFIG;
    const fan = config.fan;

    if (count <= 0) return [];

    const edgeReserve = Math.min(120, stageWidth * 0.07);
    const spanLimit = Math.max(
      cardWidth * 1.5,
      Math.min(stageWidth * fan.maxSpanRatio, fan.maxSpanPx, stageWidth - edgeReserve * 2)
    );

    const spacing =
      count <= 1
        ? 0
        : Math.min(cardWidth * fan.spacingRatio, (spanLimit - cardWidth) / (count - 1));
    const span = spacing * (count - 1);
    const centerX = stageWidth / 2;
    const baseY = stageHeight - cardHeight * fan.baseYOffsetRatio;
    const arcLift = Math.min(fan.arcLift, 10 + count * 1.4);
    const maxRotation = count <= 1 ? 0 : fan.maxRotation;

    // The slight centre dip and outward rotations are deliberate. Every value
    // below is derived symmetrically from t, so the "organic" fan never becomes
    // accidental drift: odd hands have a true centred card and even hands mirror.
    const poses = [];
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
      poses.push({
        x: centerX + (t * span) / 2,
        y: baseY - t * t * arcLift,
        rotation: t * maxRotation,
        scale: 1,
        opacity: 1,
        tiltX: 0,
        tiltY: 0,
        z: 100 + index,
      });
    }
    return poses;
  };

  CGE.computeHoverPose = function computeHoverPose(restPose, options) {
    const fan = (options.config || CGE.CONFIG).fan;
    const compact = options.stageWidth < 700;
    const scale = compact ? fan.hoverScaleCompact : fan.hoverScaleDesktop;
    const pose = {
      x: restPose.x,
      y: restPose.y - options.cardHeight * fan.hoverLiftRatio,
      rotation: restPose.rotation * 0.14,
      scale,
      opacity: 1,
      tiltX: 0,
      tiltY: 0,
      z: 3000 + Math.round(restPose.z || 0),
    };
    return U.clampToViewport(
      pose,
      options.cardWidth,
      options.cardHeight,
      options.stageWidth,
      options.stageHeight,
      fan.edgePadding
    );
  };
})(window);
