'use strict';
const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../config/constants');

const eventSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: Object.values(EVENT_TYPES), required: true, index: true },
    name: { type: String, trim: true, maxlength: 120 }, // free-form label for CUSTOM events

    // Normalised commerce fields, promoted out of `properties` so they can be indexed.
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },
    quantity: { type: Number, default: 1 },
    productId: { type: String, trim: true, index: true, sparse: true },
    orderId: { type: String, trim: true, index: true, sparse: true },
    category: { type: String, trim: true, index: true, sparse: true },

    properties: { type: mongoose.Schema.Types.Mixed, default: {} },

    sessionId: { type: String, trim: true, index: true, sparse: true },
    source: { type: String, trim: true, default: 'api' },
    ip: { type: String, trim: true },
    userAgent: { type: String, trim: true, maxlength: 512 },

    // Client-supplied key that makes ingestion safely retryable.
    idempotencyKey: { type: String, trim: true },

    occurredAt: { type: Date, default: Date.now, index: true },
    scoreApplied: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

eventSchema.index({ userId: 1, type: 1, occurredAt: -1 });
eventSchema.index({ type: 1, occurredAt: -1 });
eventSchema.index({ occurredAt: -1 });
eventSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

// Optional retention policy: uncomment to auto-expire raw events after 400 days.
// eventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 400 * 24 * 3600 });

module.exports = mongoose.model('Event', eventSchema);
