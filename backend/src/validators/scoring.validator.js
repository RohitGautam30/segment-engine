'use strict';
const { z } = require('zod');

const updateRule = z.object({
  eventPoints: z.record(z.number().min(-500).max(500)).optional(),
  eventCaps: z.record(z.number().min(0).max(10000)).optional(),
  monetary: z
    .object({
      enabled: z.boolean().optional(),
      pointsPerCurrencyUnit: z.number().min(0).max(100).optional(),
      cap: z.number().min(0).max(100000).optional(),
    })
    .strict()
    .optional(),
  recency: z
    .object({
      enabled: z.boolean().optional(),
      halfLifeDays: z.number().min(1).max(3650).optional(),
      inactivityPenaltyPerDay: z.number().min(0).max(100).optional(),
      inactivityGraceDays: z.number().min(0).max(365).optional(),
      maxPenalty: z.number().min(0).max(10000).optional(),
    })
    .strict()
    .optional(),
  profileBonus: z
    .object({ enabled: z.boolean().optional(), maxPoints: z.number().min(0).max(1000).optional() })
    .strict()
    .optional(),
  maxScore: z.number().min(1).max(1000000).optional(),
  minScore: z.number().min(-1000000).max(0).optional(),
});

module.exports = { updateRule };
