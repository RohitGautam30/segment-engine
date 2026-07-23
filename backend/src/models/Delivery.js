'use strict';
const mongoose = require('mongoose');
const { DELIVERY_STATUS, CHANNELS } = require('../config/constants');

const deliverySchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignRun', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    channel: { type: String, enum: Object.values(CHANNELS), required: true },
    status: { type: String, enum: Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.PENDING, index: true },

    destination: { type: String, trim: true }, // email address / phone / device token
    renderedSubject: { type: String },
    renderedBody: { type: String },

    providerMessageId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    skipReason: { type: String, default: null },
    error: { type: String, default: null },

    sentAt: { type: Date, default: null },
    openedAt: { type: Date, default: null },
    clickedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One delivery per user per run — makes retrying a batch idempotent.
deliverySchema.index({ runId: 1, userId: 1 }, { unique: true });
deliverySchema.index({ campaignId: 1, status: 1 });
deliverySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Delivery', deliverySchema);
