'use strict';
const { User, Event, CohortMembership, Delivery } = require('../models');
const ApiError = require('../utils/ApiError');
const { USER_STATUS, EVENT_TYPES, ROLES } = require('../config/constants');
const { parsePagination, parseSort } = require('../utils/pagination');
const eventService = require('./event.service');
const scoringService = require('./scoring.service');
const tokenService = require('./token.service');

// Fields that count toward profile completion, and their weights.
const COMPLETION_FIELDS = [
  { path: 'firstName', weight: 15 },
  { path: 'lastName', weight: 10 },
  { path: 'phone', weight: 20 },
  { path: 'dateOfBirth', weight: 10 },
  { path: 'gender', weight: 5, truthy: (v) => v && v !== 'UNDISCLOSED' },
  { path: 'country', weight: 15 },
  { path: 'city', weight: 10 },
  { path: 'avatarUrl', weight: 10 },
  { path: 'company', weight: 5 },
];

function calculateCompletion(profile = {}) {
  let score = 0;
  for (const field of COMPLETION_FIELDS) {
    const value = profile[field.path];
    const filled = field.truthy ? field.truthy(value) : value != null && String(value).trim() !== '';
    if (filled) score += field.weight;
  }
  return Math.min(100, score);
}

function missingProfileFields(profile = {}) {
  return COMPLETION_FIELDS.filter((f) => {
    const value = profile[f.path];
    return f.truthy ? !f.truthy(value) : value == null || String(value).trim() === '';
  }).map((f) => f.path);
}

/** Self-service signup. Emits the SIGNUP event, which seeds the score. */
async function signup(payload, context = {}) {
  const email = String(payload.email).toLowerCase();
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists');

  const user = new User({
    email,
    passwordHash: payload.password,
    role: ROLES.USER,
    status: USER_STATUS.ACTIVE,
    source: payload.source || 'signup',
    externalId: payload.externalId,
    profile: payload.profile || {},
  });
  user.profile.completion = calculateCompletion(user.profile.toObject ? user.profile.toObject() : user.profile);
  await user.save();

  await eventService.track({ userId: user._id, type: EVENT_TYPES.SIGNUP, source: payload.source || 'signup' }, context);
  if (user.profile.completion >= 100) {
    await eventService.track({ userId: user._id, type: EVENT_TYPES.PROFILE_COMPLETED }, context);
  }

  return User.findById(user._id);
}

/** Admin-created user. Password is optional; an invited user sets it later. */
async function adminCreateUser(payload, actorId) {
  const email = String(payload.email).toLowerCase();
  if (await User.exists({ email })) throw ApiError.conflict('An account with this email already exists');

  const user = new User({
    email,
    role: payload.role || ROLES.USER,
    status: payload.password ? USER_STATUS.ACTIVE : USER_STATUS.INVITED,
    source: payload.source || 'admin',
    externalId: payload.externalId,
    profile: payload.profile || {},
    tags: payload.tags || [],
    consent: payload.consent || {},
    createdBy: actorId,
  });
  if (payload.password) user.passwordHash = payload.password;
  user.profile.completion = calculateCompletion(user.profile.toObject ? user.profile.toObject() : user.profile);
  await user.save();

  await eventService.track({ userId: user._id, type: EVENT_TYPES.SIGNUP, source: 'admin' });
  return User.findById(user._id);
}

/**
 * Profile update. Recomputes completion and emits PROFILE_COMPLETED the
 * first time the profile reaches 100% — that event is what feeds the score.
 */
async function updateProfile(userId, profilePatch, context = {}) {
  const user = await User.findOne({ _id: userId, deletedAt: null });
  if (!user) throw ApiError.notFound('User not found');

  const wasComplete = (user.profile?.completion || 0) >= 100;
  Object.assign(user.profile, profilePatch);
  const completion = calculateCompletion(user.profile.toObject ? user.profile.toObject() : user.profile);
  user.profile.completion = completion;
  if (completion >= 100 && !user.profile.completedAt) user.profile.completedAt = new Date();
  await user.save();

  if (completion >= 100 && !wasComplete) {
    await eventService.track({ userId: user._id, type: EVENT_TYPES.PROFILE_COMPLETED }, context);
  } else {
    await eventService.track({ userId: user._id, type: EVENT_TYPES.PROFILE_UPDATED }, context);
  }

  const fresh = await User.findById(user._id);
  return { user: fresh, completion, missingFields: missingProfileFields(fresh.profile) };
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, [
    'createdAt', 'email', 'score.value', 'stats.totalRevenue', 'stats.lastActivityAt', 'profile.completion',
  ]);

  const filter = { deletedAt: null };
  if (query.status) filter.status = query.status;
  if (query.role) filter.role = query.role;
  if (query.tier) filter['score.tier'] = query.tier;
  if (query.tag) filter.tags = query.tag;
  if (query.category) filter['stats.topCategory'] = query.category;
  if (query.stage) filter['stats.lifecycleStage'] = query.stage;
  if (query.country) filter['profile.country'] = String(query.country).toUpperCase();
  if (query.minScore != null || query.maxScore != null) {
    filter['score.value'] = {};
    if (query.minScore != null) filter['score.value'].$gte = Number(query.minScore);
    if (query.maxScore != null) filter['score.value'].$lte = Number(query.maxScore);
  }
  if (query.search) {
    const term = String(query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { email: { $regex: term, $options: 'i' } },
      { 'profile.firstName': { $regex: term, $options: 'i' } },
      { 'profile.lastName': { $regex: term, $options: 'i' } },
      { externalId: term },
    ];
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function getById(userId) {
  const user = await User.findOne({ _id: userId, deletedAt: null }).lean();
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

/** Full 360 view: profile, score breakdown, recent activity, cohorts, messages. */
async function getProfile360(userId) {
  const user = await getById(userId);
  const [timeline, cohorts, deliveries, eventCounts] = await Promise.all([
    eventService.getUserTimeline(userId, { limit: 25 }),
    CohortMembership.find({ userId }).populate('cohortId', 'name slug').lean(),
    Delivery.find({ userId }).sort({ createdAt: -1 }).limit(10).populate('campaignId', 'name channel').lean(),
    Event.aggregate([{ $match: { userId: user._id } }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
  ]);

  return {
    user,
    missingProfileFields: missingProfileFields(user.profile),
    timeline,
    cohorts: cohorts.filter((c) => c.cohortId).map((c) => ({ ...c.cohortId, enteredAt: c.enteredAt })),
    recentMessages: deliveries,
    eventCounts: Object.fromEntries(eventCounts.map((e) => [e._id, e.count])),
  };
}

async function updateByAdmin(userId, patch, actorId) {
  const user = await User.findOne({ _id: userId, deletedAt: null });
  if (!user) throw ApiError.notFound('User not found');

  const allowed = ['role', 'status', 'tags', 'consent', 'externalId', 'source'];
  for (const key of allowed) if (patch[key] !== undefined) user[key] = patch[key];
  if (patch.profile) {
    Object.assign(user.profile, patch.profile);
    user.profile.completion = calculateCompletion(user.profile.toObject ? user.profile.toObject() : user.profile);
  }
  if (patch.traits) for (const [k, v] of Object.entries(patch.traits)) user.traits.set(k, v);

  user.updatedBy = actorId;
  await user.save();

  if (patch.status && patch.status !== USER_STATUS.ACTIVE) await tokenService.revokeAllForUser(user._id);
  return User.findById(user._id);
}

async function softDelete(userId) {
  const user = await User.findOne({ _id: userId, deletedAt: null });
  if (!user) throw ApiError.notFound('User not found');
  user.status = USER_STATUS.DELETED;
  user.deletedAt = new Date();
  user.tokenVersion += 1;
  await user.save();
  await Promise.all([CohortMembership.deleteMany({ userId }), tokenService.revokeAllForUser(userId)]);
  return { deleted: true };
}

async function recomputeScore(userId) {
  const result = await scoringService.recomputeUserScore(userId);
  if (!result) throw ApiError.notFound('User not found');
  return result;
}

/** Aggregate dashboard numbers. */
async function getOverview() {
  const [totals, tiers, stages, recentSignups] = await Promise.all([
    User.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          users: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ['$status', USER_STATUS.ACTIVE] }, 1, 0] } },
          avgScore: { $avg: '$score.value' },
          revenue: { $sum: '$stats.totalRevenue' },
          buyers: { $sum: { $cond: [{ $gt: ['$stats.purchaseCount', 0] }, 1, 0] } },
          avgCompletion: { $avg: '$profile.completion' },
        },
      },
    ]),
    User.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$score.tier', count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$stats.lifecycleStage', count: { $sum: 1 } } }]),
    User.countDocuments({ deletedAt: null, createdAt: { $gte: new Date(Date.now() - 7 * 864e5) } }),
  ]);

  const t = totals[0] || {};
  return {
    users: t.users || 0,
    activeUsers: t.active || 0,
    buyers: t.buyers || 0,
    conversionRate: t.users ? Math.round(((t.buyers || 0) / t.users) * 10000) / 100 : 0,
    averageScore: Math.round((t.avgScore || 0) * 100) / 100,
    averageProfileCompletion: Math.round((t.avgCompletion || 0) * 100) / 100,
    totalRevenue: Math.round((t.revenue || 0) * 100) / 100,
    signupsLast7Days: recentSignups,
    tierDistribution: Object.fromEntries(tiers.map((x) => [x._id || 'UNKNOWN', x.count])),
    stageDistribution: Object.fromEntries(stages.map((x) => [x._id || 'SIGNED_UP', x.count])),
  };
}

module.exports = {
  signup,
  adminCreateUser,
  updateProfile,
  list,
  getById,
  getProfile360,
  updateByAdmin,
  softDelete,
  recomputeScore,
  getOverview,
  calculateCompletion,
  missingProfileFields,
};
