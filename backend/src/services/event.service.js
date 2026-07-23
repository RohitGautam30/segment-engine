'use strict';
const mongoose = require('mongoose');
const { User, Event } = require('../models');
const { EVENT_TYPES, LIFECYCLE_STAGES } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const scoringService = require('./scoring.service');
const logger = require('../config/logger');
const { parsePagination, parseSort } = require('../utils/pagination');

/**
 * Maps an event type onto the denormalised counters kept on the user.
 * These counters are what make cohort queries fast.
 */
// Map keys cannot contain dots or start with $, so category values are
// normalised before being used as one.
const categoryKey = (raw) =>
  String(raw).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const CATEGORY_EVENTS = new Set([
  EVENT_TYPES.PRODUCT_VIEW,
  EVENT_TYPES.ADD_TO_CART,
  EVENT_TYPES.CHECKOUT_STARTED,
  EVENT_TYPES.PURCHASE,
]);

// Purchases say more about affinity than a browse does, so they count for more.
const CATEGORY_WEIGHT = {
  [EVENT_TYPES.PRODUCT_VIEW]: 1,
  [EVENT_TYPES.ADD_TO_CART]: 3,
  [EVENT_TYPES.CHECKOUT_STARTED]: 4,
  [EVENT_TYPES.PURCHASE]: 8,
};

function statDelta(event) {
  const inc = { 'stats.totalEvents': 1 };
  const set = { 'stats.lastActivityAt': event.occurredAt };

  if (event.category && CATEGORY_EVENTS.has(event.type)) {
    const key = categoryKey(event.category);
    if (key) inc[`stats.categoryCounts.${key}`] = CATEGORY_WEIGHT[event.type] || 1;
  }

  switch (event.type) {
    case EVENT_TYPES.PAGE_VIEW:
      inc['stats.pageViews'] = 1;
      break;
    case EVENT_TYPES.PRODUCT_VIEW:
      inc['stats.productViews'] = 1;
      break;
    case EVENT_TYPES.ADD_TO_CART:
      inc['stats.cartAdds'] = 1;
      break;
    case EVENT_TYPES.CHECKOUT_STARTED:
      inc['stats.checkouts'] = 1;
      break;
    case EVENT_TYPES.PURCHASE:
      inc['stats.purchaseCount'] = 1;
      inc['stats.totalRevenue'] = Number(event.value || 0);
      set['stats.lastPurchaseAt'] = event.occurredAt;
      break;
    case EVENT_TYPES.REFUND:
      inc['stats.refundCount'] = 1;
      inc['stats.totalRevenue'] = -Number(event.value || 0);
      break;
    case EVENT_TYPES.UNSUBSCRIBE:
      set['consent.email'] = false;
      set['consent.sms'] = false;
      set['consent.push'] = false;
      set['consent.unsubscribedAt'] = event.occurredAt;
      break;
    case EVENT_TYPES.LOGIN:
      inc['stats.sessionCount'] = 1;
      set.lastLoginAt = event.occurredAt;
      break;
    default:
      break;
  }
  return { inc, set };
}

/**
 * Derives the furthest lifecycle stage a customer has reached. Order matters:
 * a buyer stays ORDERED even if their profile is incomplete, because the funnel
 * records progress, not current tidiness.
 */
function stageFor(user) {
  if ((user.stats?.purchaseCount || 0) > 0) return 'ORDERED';
  if ((user.stats?.cartAdds || 0) > 0) return 'ADDED_TO_CART';
  if ((user.profile?.completion || 0) >= 100) return 'PROFILE_COMPLETE';
  return 'SIGNED_UP';
}

/** Advances a user's stage if this event moved them forward. Never moves back. */
async function refreshStage(userId) {
  const user = await User.findById(userId).select('stats profile').lean();
  if (!user) return null;

  const next = stageFor(user);
  const current = user.stats?.lifecycleStage || 'SIGNED_UP';
  if (LIFECYCLE_STAGES.indexOf(next) <= LIFECYCLE_STAGES.indexOf(current)) return current;

  await User.updateOne(
    { _id: userId },
    { $set: { 'stats.lifecycleStage': next, 'stats.stageEnteredAt': new Date() } }
  );
  return next;
}

// Events that can move someone forward in the funnel.
const STAGE_EVENTS = new Set([
  EVENT_TYPES.SIGNUP,
  EVENT_TYPES.PROFILE_COMPLETED,
  EVENT_TYPES.ADD_TO_CART,
  EVENT_TYPES.PURCHASE,
]);

async function resolveUser({ userId, email, externalId }) {
  if (userId) {
    if (!mongoose.Types.ObjectId.isValid(userId)) throw ApiError.badRequest('Invalid userId');
    const user = await User.findOne({ _id: userId, deletedAt: null });
    if (!user) throw ApiError.notFound('User not found');
    return user;
  }
  if (externalId) {
    const user = await User.findOne({ externalId, deletedAt: null });
    if (!user) throw ApiError.notFound('User not found for externalId');
    return user;
  }
  if (email) {
    const user = await User.findOne({ email: String(email).toLowerCase(), deletedAt: null });
    if (!user) throw ApiError.notFound('User not found for email');
    return user;
  }
  throw ApiError.badRequest('One of userId, externalId or email is required');
}

/**
 * Ingest a single activity event.
 * - idempotent when the caller supplies idempotencyKey
 * - updates denormalised user stats
 * - applies the incremental score change
 */
async function track(payload, context = {}) {
  const user = await resolveUser(payload);
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : new Date();

  if (payload.idempotencyKey) {
    const existing = await Event.findOne({ idempotencyKey: payload.idempotencyKey }).lean();
    if (existing) return { event: existing, duplicate: true, score: user.score?.value ?? 0 };
  }

  const doc = {
    userId: user._id,
    type: payload.type,
    name: payload.name,
    value: Number(payload.value || 0),
    currency: payload.currency || 'INR',
    quantity: Number(payload.quantity ?? 1),
    productId: payload.productId,
    orderId: payload.orderId,
    category: payload.category,
    properties: payload.properties || {},
    sessionId: payload.sessionId,
    source: payload.source || context.source || 'api',
    ip: context.ip,
    userAgent: context.userAgent,
    idempotencyKey: payload.idempotencyKey,
    occurredAt,
  };

  let event;
  try {
    event = await Event.create(doc);
  } catch (err) {
    if (err.code === 11000) {
      const existing = await Event.findOne({ idempotencyKey: payload.idempotencyKey }).lean();
      return { event: existing, duplicate: true, score: user.score?.value ?? 0 };
    }
    throw err;
  }

  const { inc, set } = statDelta(event);
  await User.updateOne({ _id: user._id }, { $inc: inc, $set: set });

  // Keep average order value consistent after a purchase or refund.
  if ([EVENT_TYPES.PURCHASE, EVENT_TYPES.REFUND].includes(event.type)) {
    const fresh = await User.findById(user._id).select('stats').lean();
    const count = fresh.stats?.purchaseCount || 0;
    const aov = count > 0 ? (fresh.stats.totalRevenue || 0) / count : 0;
    const update = { 'stats.averageOrderValue': Math.round(aov * 100) / 100 };
    if (event.type === EVENT_TYPES.PURCHASE && !fresh.stats?.firstPurchaseAt) {
      update['stats.firstPurchaseAt'] = event.occurredAt;
    }
    await User.updateOne({ _id: user._id }, { $set: update });
  }

  if (STAGE_EVENTS.has(event.type)) await refreshStage(user._id);

  // Recompute the winning category after its counter moved.
  if (event.category && CATEGORY_EVENTS.has(event.type)) {
    const fresh = await User.findById(user._id).select('stats.categoryCounts').lean();
    const counts = fresh?.stats?.categoryCounts || {};
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top) await User.updateOne({ _id: user._id }, { $set: { 'stats.topCategory': top[0] } });
  }

  const scored = await scoringService.applyEventIncrement(user, event);
  if (scored.applied) {
    await Event.updateOne({ _id: event._id }, { $set: { scoreApplied: scored.applied } });
  }

  logger.debug({ userId: String(user._id), type: event.type, score: scored.score }, 'Event tracked');

  return { event: event.toObject(), duplicate: false, score: scored.score, tier: scored.tier };
}

/** Bulk ingestion. Failures are isolated per event so one bad row cannot poison a batch. */
async function trackBatch(events, context = {}) {
  const results = { accepted: 0, duplicates: 0, failed: 0, errors: [] };
  for (let i = 0; i < events.length; i += 1) {
    try {
      const res = await track(events[i], context);
      if (res.duplicate) results.duplicates += 1;
      else results.accepted += 1;
    } catch (err) {
      results.failed += 1;
      results.errors.push({ index: i, message: err.message });
    }
  }
  return results;
}

async function listEvents(filters = {}, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, ['occurredAt', 'createdAt', 'type', 'value'], { occurredAt: -1 });

  const mongoFilter = {};
  if (filters.userId) mongoFilter.userId = filters.userId;
  if (filters.type) mongoFilter.type = Array.isArray(filters.type) ? { $in: filters.type } : filters.type;
  if (filters.productId) mongoFilter.productId = filters.productId;
  if (filters.category) mongoFilter.category = filters.category;
  if (filters.from || filters.to) {
    mongoFilter.occurredAt = {};
    if (filters.from) mongoFilter.occurredAt.$gte = new Date(filters.from);
    if (filters.to) mongoFilter.occurredAt.$lte = new Date(filters.to);
  }

  const [items, total] = await Promise.all([
    Event.find(mongoFilter).sort(sort).skip(skip).limit(limit).lean(),
    Event.countDocuments(mongoFilter),
  ]);
  return { items, page, limit, total };
}

/** Activity timeline for a single user. */
async function getUserTimeline(userId, { limit = 50, before } = {}) {
  const filter = { userId };
  if (before) filter.occurredAt = { $lt: new Date(before) };
  return Event.find(filter).sort({ occurredAt: -1 }).limit(Math.min(limit, 200)).lean();
}

/** Funnel counts across the standard commerce journey. */
async function getFunnel({ from, to } = {}) {
  const match = {};
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = new Date(from);
    if (to) match.occurredAt.$lte = new Date(to);
  }
  const steps = [
    EVENT_TYPES.SIGNUP,
    EVENT_TYPES.PROFILE_COMPLETED,
    EVENT_TYPES.PRODUCT_VIEW,
    EVENT_TYPES.ADD_TO_CART,
    EVENT_TYPES.CHECKOUT_STARTED,
    EVENT_TYPES.PURCHASE,
  ];

  const rows = await Event.aggregate([
    { $match: { ...match, type: { $in: steps } } },
    { $group: { _id: { type: '$type', user: '$userId' } } },
    { $group: { _id: '$_id.type', users: { $sum: 1 } } },
  ]);

  const byType = Object.fromEntries(rows.map((r) => [r._id, r.users]));
  let previous = null;
  return steps.map((step) => {
    const users = byType[step] || 0;
    const conversion = previous ? Math.round((users / previous) * 10000) / 100 : 100;
    previous = users || previous;
    return { step, users, conversionFromPrevious: conversion };
  });
}

/** Event volume grouped by day, for dashboards. */
async function getEventStats({ from, to, type } = {}) {
  const match = {};
  if (type) match.type = type;
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = new Date(from);
    if (to) match.occurredAt.$lte = new Date(to);
  }
  return Event.aggregate([
    { $match: match },
    {
      $group: {
        _id: { day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } }, type: '$type' },
        count: { $sum: 1 },
        revenue: { $sum: '$value' },
      },
    },
    { $group: { _id: '$_id.day', byType: { $push: { type: '$_id.type', count: '$count', revenue: '$revenue' } }, total: { $sum: '$count' } } },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, date: '$_id', total: 1, byType: 1 } },
  ]);
}

/** Stage funnel across the whole base, with drop-off between steps. */
async function getStageFunnel() {
  const rows = await User.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: '$stats.lifecycleStage', users: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((r) => [r._id || 'SIGNED_UP', r.users]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Each stage shows everyone who reached it *or beyond*, which is what a
  // funnel means: 'added to cart' includes people who went on to order.
  let cumulative = 0;
  const reached = {};
  for (let i = LIFECYCLE_STAGES.length - 1; i >= 0; i -= 1) {
    cumulative += counts[LIFECYCLE_STAGES[i]] || 0;
    reached[LIFECYCLE_STAGES[i]] = cumulative;
  }

  let previous = null;
  return LIFECYCLE_STAGES.map((stage) => {
    const users = reached[stage];
    const conversion = previous ? Math.round((users / previous) * 10000) / 100 : 100;
    previous = users || previous;
    return { stage, atStage: counts[stage] || 0, reached: users, conversionFromPrevious: conversion, shareOfTotal: total ? Math.round((users / total) * 10000) / 100 : 0 };
  });
}

module.exports = {
  track, trackBatch, listEvents, getUserTimeline, getFunnel, getStageFunnel,
  getEventStats, resolveUser, statDelta, stageFor, refreshStage,
};
