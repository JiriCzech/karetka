/* Card definitions are pure data. Add a definition here, then register an
   effect handler in the demo (or your own game) — no rendering changes needed. */
(function (global) {
  "use strict";

  const CGE = (global.CGE = global.CGE || {});

  CGE.CARD_DEFINITIONS = [
    {
      id: "ember-spark",
      name: "Ember Spark",
      type: "Spell",
      description: "A coal that refuses to forget the fire.",
      effectLabel: "+1 Power",
      effect: { type: "power.add", amount: 1 },
      disposition: "discard",
      cost: 1,
      rarity: "common",
      rune: "spark",
      palette: { a: "#2a1a15", b: "#7d3c27", c: "#f0a959" },
      artwork: null,
      flavor: "Small, bright, and hungry.",
    },
    {
      id: "arcane-surge",
      name: "Arcane Surge",
      type: "Rite",
      description: "The old current answers those who listen.",
      effectLabel: "+3 Power",
      effect: { type: "power.add", amount: 3 },
      disposition: "discard",
      cost: 3,
      rarity: "rare",
      rune: "surge",
      palette: { a: "#111b31", b: "#2f5c9c", c: "#84c8ee" },
      artwork: null,
      flavor: "A river with no banks.",
    },
    {
      id: "mana-siphon",
      name: "Mana Siphon",
      type: "Hex",
      description: "Draw the warmth from the air and leave it cold.",
      effectLabel: "-1 Power",
      effect: { type: "power.add", amount: -1 },
      disposition: "discard",
      cost: 1,
      rarity: "common",
      rune: "siphon",
      palette: { a: "#0f2424", b: "#29635b", c: "#7ed0b0" },
      artwork: null,
      flavor: "Every gift has a price.",
    },
    {
      id: "hex-of-ruin",
      name: "Hex of Ruin",
      type: "Curse",
      description: "A name spoken backwards, and a little luck lost.",
      effectLabel: "-2 Power",
      effect: { type: "power.add", amount: -2 },
      disposition: "discard",
      cost: 2,
      rarity: "rare",
      rune: "hex",
      palette: { a: "#23132c", b: "#5f3378", c: "#cf8ce3" },
      artwork: null,
      flavor: "The dark remembers.",
    },
    {
      id: "temporal-reset",
      name: "Temporal Reset",
      type: "Chrono",
      description: "Return the moment to its first breath.",
      effectLabel: "Reset Power",
      effect: { type: "power.set", amount: 0 },
      disposition: "destroy",
      cost: 2,
      rarity: "epic",
      rune: "hourglass",
      palette: { a: "#252014", b: "#8b7442", c: "#f4d792" },
      artwork: null,
      flavor: "Once spent, it never was.",
    },
    {
      id: "void-ember",
      name: "Void Ember",
      type: "Rite",
      description: "A spark torn from a place without light.",
      effectLabel: "+2 Power",
      effect: { type: "power.add", amount: 2 },
      disposition: "destroy",
      cost: 2,
      rarity: "epic",
      rune: "void",
      palette: { a: "#1c1129", b: "#5b2f7e", c: "#d798ff" },
      artwork: null,
      flavor: "It burns without burning.",
    },
  ];

  CGE.buildDeck = function buildDeck(options) {
    const opts = options || {};
    const serialStart = opts.serialStart || 1;
    const seed = opts.seed == null ? CGE.CONFIG.deckSeed : opts.seed;
    const definitionsById = new Map(
      CGE.CARD_DEFINITIONS.map((definition) => [definition.id, definition])
    );
    const bag = [];

    for (const entry of CGE.DECK_RECIPE) {
      const definition = definitionsById.get(entry.definitionId);
      if (!definition) {
        throw new Error("Unknown card definition in DECK_RECIPE: " + entry.definitionId);
      }
      for (let i = 0; i < entry.count; i += 1) {
        bag.push(definition);
      }
    }

    const random = CGE.utils.mulberry32(seed);
    CGE.utils.shuffle(bag, random);

    let serial = serialStart;
    return bag.map((definition) => {
      const instance = {
        instanceId: "card-" + serial,
        definitionId: definition.id,
        definition,
        zone: "deck",
      };
      serial += 1;
      return instance;
    });
  };

  CGE.getCardDefinition = function getCardDefinition(id) {
    return CGE.CARD_DEFINITIONS.find((definition) => definition.id === id) || null;
  };
})(window);
