'use strict';
const mongoose = require('mongoose');
const { COHORT_TYPE } = require('../config/constants');

const cohortSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 1000 },
    type: { type: String, enum: Object.values(COHORT_TYPE), default: COHORT_TYPE.DYNAMIC, index: true },

    /**
     * Rule tree, e.g.
     * {
     *   op: 'AND',
     *   conditions: [
     *     { type: 'score',     operator: 'gte', value: 500 },
     *     { type: 'attribute', field: 'profile.country', operator: 'in', value: ['IN'] },
     *     { type: 'event',     event: 'PURCHASE', aggregate: 'count',
     *       operator: 'gte', value: 2, window: { days: 30 } }
     *   ]
     * }
     */
    rules: { type: mongoose.Schema.Types.Mixed, required: true },

    // STATIC cohorts carry an explicit member list instead of a rule tree.
    staticMemberIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    isActive: { type: Boolean, default: true, index: true },
    autoRefresh: { type: Boolean, default: true },
    refreshIntervalMinutes: { type: Number, default: 60, min: 5 },

    memberCount: { type: Number, default: 0 },
    lastRefreshedAt: { type: Date, default: null },
    lastRefreshDurationMs: { type: Number, default: null },
    lastRefreshError: { type: String, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

cohortSchema.index({ isActive: 1, autoRefresh: 1, lastRefreshedAt: 1 });

module.exports = mongoose.model('Cohort', cohortSchema);
