'use strict';
const mongoose = require('mongoose');
const { JOB_TYPES, JOB_STATUS } = require('../config/constants');

/**
 * Mongo-backed work queue. Workers claim jobs with an atomic
 * findOneAndUpdate, so multiple worker processes can run safely without
 * introducing Redis. Swap this for BullMQ if you outgrow it.
 */
const jobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(JOB_TYPES), required: true, index: true },
    status: { type: String, enum: Object.values(JOB_STATUS), default: JOB_STATUS.PENDING, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    priority: { type: Number, default: 0 },
    runAt: { type: Date, default: Date.now, index: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },

    lockedBy: { type: String, default: null },
    lockedAt: { type: Date, default: null },
    heartbeatAt: { type: Date, default: null },

    dedupeKey: { type: String, default: null },
    lastError: { type: String, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, runAt: 1, priority: -1 });
jobSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, status: { $in: ['PENDING', 'ACTIVE'] } } }
);

module.exports = mongoose.model('Job', jobSchema);
