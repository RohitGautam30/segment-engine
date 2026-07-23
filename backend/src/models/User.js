'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, USER_STATUS, LIFECYCLE_STAGES } = require('../config/constants');

const SALT_ROUNDS = 12;

const profileSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 24 },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'], default: 'UNDISCLOSED' },
    dateOfBirth: { type: Date },
    country: { type: String, trim: true, uppercase: true, maxlength: 2 },
    city: { type: String, trim: true, maxlength: 80 },
    avatarUrl: { type: String, trim: true },
    company: { type: String, trim: true, maxlength: 120 },
    // percentage 0-100, recomputed whenever the profile changes
    completion: { type: Number, default: 0, min: 0, max: 100, index: true },
    completedAt: { type: Date, default: null },
  },
  { _id: false }
);

// Denormalised behavioural counters. These exist so cohort queries can filter
// on behaviour with plain indexed fields instead of scanning the event log.
const statsSchema = new mongoose.Schema(
  {
    totalEvents: { type: Number, default: 0 },
    pageViews: { type: Number, default: 0 },
    productViews: { type: Number, default: 0 },
    cartAdds: { type: Number, default: 0 },
    checkouts: { type: Number, default: 0 },
    purchaseCount: { type: Number, default: 0, index: true },
    refundCount: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0, index: true },
    averageOrderValue: { type: Number, default: 0 },
    firstPurchaseAt: { type: Date, default: null },
    lastPurchaseAt: { type: Date, default: null, index: true },
    lastActivityAt: { type: Date, default: null, index: true },
    daysSinceLastActivity: { type: Number, default: null },
    sessionCount: { type: Number, default: 0 },
    // Category affinity, maintained from events. Lets you segment on what a
    // person actually shops for rather than a self-declared preference.
    categoryCounts: { type: Map, of: Number, default: () => new Map() },
    topCategory: { type: String, default: null, index: true },
    // Furthest stage this customer has reached in the lifecycle funnel.
    lifecycleStage: { type: String, enum: LIFECYCLE_STAGES, default: 'SIGNED_UP', index: true },
    stageEnteredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const scoreSchema = new mongoose.Schema(
  {
    value: { type: Number, default: 0, min: 0, index: true },
    tier: { type: String, default: 'BRONZE', index: true },
    breakdown: {
      engagement: { type: Number, default: 0 },
      monetary: { type: Number, default: 0 },
      recency: { type: Number, default: 0 },
      profile: { type: Number, default: 0 },
    },
    version: { type: Number, default: 1 },
    computedAt: { type: Date, default: null },
    stale: { type: Boolean, default: false, index: true },
  },
  { _id: false }
);

const consentSchema = new mongoose.Schema(
  {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: false },
    push: { type: Boolean, default: false },
    unsubscribedAt: { type: Date, default: null },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, select: false },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.USER, index: true },
    status: { type: String, enum: Object.values(USER_STATUS), default: USER_STATUS.ACTIVE, index: true },

    externalId: { type: String, trim: true, sparse: true, index: true },
    source: { type: String, trim: true, default: 'organic' },

    profile: { type: profileSchema, default: () => ({}) },
    stats: { type: statsSchema, default: () => ({}) },
    score: { type: scoreSchema, default: () => ({}) },
    consent: { type: consentSchema, default: () => ({}) },

    tags: { type: [String], default: [], index: true },
    traits: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },

    lastContactedAt: { type: Date, default: null, index: true },
    contactCount30d: { type: Number, default: 0 },

    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, select: false },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.tokenVersion;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Compound indexes tuned for the cohort query planner.
userSchema.index({ status: 1, 'score.value': -1 });
userSchema.index({ status: 1, 'stats.lastActivityAt': -1 });
userSchema.index({ status: 1, 'stats.totalRevenue': -1 });
userSchema.index({ 'profile.country': 1, 'score.tier': 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'stats.lifecycleStage': 1, 'score.value': -1 });

userSchema.virtual('fullName').get(function fullName() {
  return [this.profile?.firstName, this.profile?.lastName].filter(Boolean).join(' ') || null;
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash') || !this.passwordHash) return next();
  if (this.passwordHash.startsWith('$2')) return next(); // already hashed
  this.passwordHash = await bcrypt.hash(this.passwordHash, SALT_ROUNDS);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.setPassword = function setPassword(plain) {
  this.passwordHash = plain; // hashed by the pre-save hook
  this.tokenVersion += 1; // invalidates every issued token
};

userSchema.statics.hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS);

module.exports = mongoose.model('User', userSchema);
