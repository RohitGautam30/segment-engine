'use strict';
const mongoose = require('mongoose');
const { CAMPAIGN_STATUS, CHANNELS } = require('../config/constants');

const contentSchema = new mongoose.Schema(
  {
    subject: { type: String, trim: true, maxlength: 200 },   // EMAIL
    preheader: { type: String, trim: true, maxlength: 200 },
    body: { type: String, required: true },                   // supports {{user.profile.firstName}}
    ctaUrl: { type: String, trim: true },
    fromName: { type: String, trim: true },
    fromEmail: { type: String, trim: true, lowercase: true },
    webhookUrl: { type: String, trim: true },                 // WEBHOOK channel
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    mode: { type: String, enum: ['IMMEDIATE', 'SCHEDULED', 'RECURRING'], default: 'IMMEDIATE' },
    sendAt: { type: Date, default: null },
    intervalMinutes: { type: Number, default: null, min: 15 }, // RECURRING
    endsAt: { type: Date, default: null },
    timezone: { type: String, default: 'Asia/Kolkata' },
  },
  { _id: false }
);

// Guard-rails that stop a campaign from over-messaging a segment.
const throttleSchema = new mongoose.Schema(
  {
    maxRecipients: { type: Number, default: null },
    minScore: { type: Number, default: null },
    respectConsent: { type: Boolean, default: true },
    frequencyCapDays: { type: Number, default: 0 }, // skip anyone contacted within N days
    quietHours: {
      enabled: { type: Boolean, default: false },
      startHour: { type: Number, default: 21, min: 0, max: 23 },
      endHour: { type: Number, default: 8, min: 0, max: 23 },
    },
  },
  { _id: false }
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 1000 },
    channel: { type: String, enum: Object.values(CHANNELS), required: true, index: true },
    status: { type: String, enum: Object.values(CAMPAIGN_STATUS), default: CAMPAIGN_STATUS.DRAFT, index: true },

    cohortIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cohort', required: true }],
    excludeCohortIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Cohort' }],

    content: { type: contentSchema, required: true },
    schedule: { type: scheduleSchema, default: () => ({}) },
    throttle: { type: throttleSchema, default: () => ({}) },

    stats: {
      totalRuns: { type: Number, default: 0 },
      totalTargeted: { type: Number, default: 0 },
      totalSent: { type: Number, default: 0 },
      totalFailed: { type: Number, default: 0 },
      totalSkipped: { type: Number, default: 0 },
    },

    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null, index: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true } }
);

campaignSchema.index({ status: 1, nextRunAt: 1 });

module.exports = mongoose.model('Campaign', campaignSchema);
