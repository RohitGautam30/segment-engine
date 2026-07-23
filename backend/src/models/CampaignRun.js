'use strict';
const mongoose = require('mongoose');
const { RUN_STATUS } = require('../config/constants');

const campaignRunSchema = new mongoose.Schema(
  {
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    status: { type: String, enum: Object.values(RUN_STATUS), default: RUN_STATUS.QUEUED, index: true },

    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    trigger: { type: String, enum: ['MANUAL', 'SCHEDULE', 'RECURRING', 'TEST'], default: 'MANUAL' },
    isDryRun: { type: Boolean, default: false },

    audienceSize: { type: Number, default: 0 },
    processed: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },

    cursor: { type: mongoose.Schema.Types.ObjectId, default: null }, // resume point for batching
    snapshotCohortIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cohort' }],

    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

campaignRunSchema.index({ campaignId: 1, createdAt: -1 });

module.exports = mongoose.model('CampaignRun', campaignRunSchema);
