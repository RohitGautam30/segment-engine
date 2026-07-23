'use strict';
const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../config/constants');

/**
 * A single active scoring configuration drives every score in the system.
 * Editing it bumps `version` and marks all scores stale for recomputation.
 */
const scoringRuleSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'default', unique: true },
    isActive: { type: Boolean, default: true, index: true },
    version: { type: Number, default: 1 },

    // Points awarded per occurrence of each event type.
    eventPoints: {
      type: Map,
      of: Number,
      default: () => new Map(Object.entries({
        [EVENT_TYPES.SIGNUP]: 10,
        [EVENT_TYPES.LOGIN]: 1,
        [EVENT_TYPES.PROFILE_COMPLETED]: 25,
        [EVENT_TYPES.PROFILE_UPDATED]: 2,
        [EVENT_TYPES.PAGE_VIEW]: 0.5,
        [EVENT_TYPES.PRODUCT_VIEW]: 2,
        [EVENT_TYPES.ADD_TO_CART]: 8,
        [EVENT_TYPES.REMOVE_FROM_CART]: -4,
        [EVENT_TYPES.CHECKOUT_STARTED]: 12,
        [EVENT_TYPES.PURCHASE]: 40,
        [EVENT_TYPES.REFUND]: -25,
        [EVENT_TYPES.SUPPORT_TICKET]: -2,
        [EVENT_TYPES.EMAIL_OPENED]: 1,
        [EVENT_TYPES.EMAIL_CLICKED]: 3,
        [EVENT_TYPES.UNSUBSCRIBE]: -30,
        [EVENT_TYPES.CUSTOM]: 1,
      })),
    },

    // Caps how much any single event type may contribute, preventing gaming.
    eventCaps: { type: Map, of: Number, default: () => new Map([['PAGE_VIEW', 50], ['LOGIN', 30], ['PRODUCT_VIEW', 80]]) },

    monetary: {
      enabled: { type: Boolean, default: true },
      pointsPerCurrencyUnit: { type: Number, default: 0.02 }, // 0.02 pts per ₹1 => ₹5,000 = 100 pts
      cap: { type: Number, default: 300 },
    },

    // Exponential time decay applied to engagement points during full recompute.
    recency: {
      enabled: { type: Boolean, default: true },
      halfLifeDays: { type: Number, default: 45 },
      inactivityPenaltyPerDay: { type: Number, default: 0.5 },
      inactivityGraceDays: { type: Number, default: 14 },
      maxPenalty: { type: Number, default: 100 },
    },

    profileBonus: {
      enabled: { type: Boolean, default: true },
      maxPoints: { type: Number, default: 50 }, // scaled by profile.completion
    },

    maxScore: { type: Number, default: 1000 },
    minScore: { type: Number, default: 0 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScoringRule', scoringRuleSchema);
