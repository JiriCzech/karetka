/* Public tuning surface. Game rules live outside this file. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});

  CGE.CONFIG = Object.freeze({
    maxHandSize: 10,
    startingHand: 5,
    deckSeed: 0x5eed1a,
    zones: Object.freeze({
      playfield: "playfield",
    }),
    fan: Object.freeze({
      maxSpanRatio: 0.78,
      maxSpanPx: 980,
      spacingRatio: 0.66,
      maxRotation: 14,
      arcLift: 22,
      baseYOffsetRatio: 0.36,
      hoverLiftRatio: 0.3,
      hoverScaleDesktop: 1.17,
      hoverScaleCompact: 1.23,
      edgePadding: 12,
    }),
    motion: Object.freeze({
      reflow: 305,
      hoverIn: 220,
      hoverOut: 195,
      draw: 640,
      dragReturn: 360,
      dragLift: 120,
      cast: 250,
      discardFlight: 500,
      destroy: 500,
      staggerDeal: 115,
      staggerBulkDraw: 95,
    }),
  });

  CGE.DECK_RECIPE = Object.freeze([
    { definitionId: "ember-spark", count: 6 },
    { definitionId: "arcane-surge", count: 3 },
    { definitionId: "mana-siphon", count: 4 },
    { definitionId: "hex-of-ruin", count: 3 },
    { definitionId: "temporal-reset", count: 2 },
    { definitionId: "void-ember", count: 2 },
  ]);
})(window);
