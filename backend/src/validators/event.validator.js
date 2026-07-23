'use strict';
const { z } = require('zod');
const { EVENT_TYPES } = require('../config/constants');
const { paginationQuery, objectId } = require('./common.validator');

const trackEvent = z
  .object({
    userId: objectId.optional(),
    email: z.string().email().optional(),
    externalId: z.string().max(120).optional(),
    type: z.enum(Object.values(EVENT_TYPES)),
    name: z.string().max(120).optional(),
    value: z.coerce.number().min(0).max(1e9).optional(),
    currency: z.string().length(3).optional(),
    quantity: z.coerce.number().int().min(0).max(100000).optional(),
    productId: z.string().max(120).optional(),
    orderId: z.string().max(120).optional(),
    category: z.string().max(120).optional(),
    properties: z.record(z.any()).optional(),
    sessionId: z.string().max(120).optional(),
    source: z.string().max(60).optional(),
    idempotencyKey: z.string().min(6).max(200).optional(),
    occurredAt: z.coerce.date().optional(),
  })
  .refine((d) => d.userId || d.email || d.externalId, {
    message: 'One of userId, email or externalId is required',
  });

const trackBatch = z.object({ events: z.array(trackEvent).min(1).max(500) });

const listQuery = paginationQuery.extend({
  userId: objectId.optional(),
  type: z.enum(Object.values(EVENT_TYPES)).optional(),
  productId: z.string().max(120).optional(),
  category: z.string().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

module.exports = { trackEvent, trackBatch, listQuery };
