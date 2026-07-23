'use strict';
const mongoose = require('mongoose');

/**
 * Materialised cohort membership. Keeping this separate from the Cohort
 * document avoids unbounded array growth and lets campaigns page through
 * a large audience with a cursor.
 */
const membershipSchema = new mongoose.Schema(
  {
    cohortId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cohort', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scoreAtEntry: { type: Number, default: 0 },
    enteredAt: { type: Date, default: Date.now },
    refreshBatch: { type: String, index: true }, // used to sweep stale rows after a refresh
  },
  { timestamps: false }
);

membershipSchema.index({ cohortId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ cohortId: 1, enteredAt: -1 });

module.exports = mongoose.model('CohortMembership', membershipSchema);
