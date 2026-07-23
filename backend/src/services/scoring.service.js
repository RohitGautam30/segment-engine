'use strict';
const { User, Event, ScoringRule } = require('../models');
const { SCORE_TIERS, EVENT_TYPES } = require('../config/constants');
const { daysBetween } = require('../utils/dates');
const logger = require('../config/logger');

let cachedRule = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60_000;

async function getActiveRule({ force = false } = {}) {
  if (!force && cachedRule && Date.now() - cachedAt < CACHE_TTL_MS) return cachedRule;
  let rule = await ScoringRule.findOne({ name: 'default' });
  if (!rule) rule = await ScoringRule.create({ name: 'default' });
  cachedRule = rule;
  cachedAt = Date.now();
  return rule;
}

const invalidateCache = () => {
  cachedRule = null;
  cachedAt = 0;
};

const toPlainMap = (m) => (m instanceof Map ? Object.fromEntries(m) : m || {});

function tierFor(score) {
  return (SCORE_TIERS.find((t) => score >= t.min) || SCORE_TIERS[SCORE_TIERS.length - 1]).name;
}

/** Exponential decay factor for an event that happened `ageDays` ago. */
function decayFactor(ageDays, halfLifeDays) {
  if (!halfLifeDays || halfLifeDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function clamp(value, rule) {
  return Math.round(Math.min(rule.maxScore, Math.max(rule.minScore, value)) * 100) / 100;
}

/**
 * Incremental scoring: applied inline when an event is ingested so the score
 * is fresh immediately. No decay is applied here (the event just happened);
 * the periodic full recompute reconciles decay and caps.
 */
function pointsForEvent(event, rule) {
  const points = toPlainMap(rule.eventPoints);
  let engagement = Number(points[event.type] ?? 0);
  let monetary = 0;

  if (rule.monetary?.enabled && event.type === EVENT_TYPES.PURCHASE) {
    monetary = Number(event.value || 0) * Number(rule.monetary.pointsPerCurrencyUnit || 0);
  }
  if (rule.monetary?.enabled && event.type === EVENT_TYPES.REFUND) {
    monetary = -Number(event.value || 0) * Number(rule.monetary.pointsPerCurrencyUnit || 0);
  }
  return { engagement, monetary, total: engagement + monetary };
}

async function applyEventIncrement(userDoc, event, rule) {
  const scoringRule = rule || (await getActiveRule());
  const { engagement, monetary, total } = pointsForEvent(event, scoringRule);
  if (!total) return { applied: 0, score: userDoc.score?.value ?? 0 };

  const current = userDoc.score?.value ?? 0;
  const next = clamp(current + total, scoringRule);

  await User.updateOne(
    { _id: userDoc._id },
    {
      $set: { 'score.value': next, 'score.tier': tierFor(next), 'score.stale': true },
      $inc: { 'score.breakdown.engagement': engagement, 'score.breakdown.monetary': monetary },
    }
  );

  return { applied: total, score: next, tier: tierFor(next) };
}

/**
 * Full recompute from the raw event log. This is the source of truth:
 * decay, per-event-type caps, inactivity penalty and profile bonus all
 * get applied here.
 */
async function recomputeUserScore(userId, rule) {
  const scoringRule = rule || (await getActiveRule());
  const user = await User.findById(userId);
  if (!user) return null;

  const points = toPlainMap(scoringRule.eventPoints);
  const caps = toPlainMap(scoringRule.eventCaps);
  const now = new Date();

  const buckets = await Event.aggregate([
    { $match: { userId: user._id } },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        revenue: { $sum: { $ifNull: ['$value', 0] } },
        // decay-weighted count: sum of 0.5 ^ (ageDays / halfLife)
        weighted: {
          $sum: {
            $pow: [
              0.5,
              {
                $divide: [
                  { $divide: [{ $subtract: [now, '$occurredAt'] }, 86400000] },
                  Math.max(1, scoringRule.recency?.halfLifeDays || 45),
                ],
              },
            ],
          },
        },
      },
    },
  ]);

  const useDecay = scoringRule.recency?.enabled !== false;

  let engagement = 0;
  let monetary = 0;

  for (const bucket of buckets) {
    const perEvent = Number(points[bucket._id] ?? 0);
    const effectiveCount = useDecay ? bucket.weighted : bucket.count;
    let contribution = perEvent * effectiveCount;

    const cap = caps[bucket._id];
    if (cap != null && contribution > cap) contribution = cap;
    engagement += contribution;

    if (scoringRule.monetary?.enabled) {
      if (bucket._id === EVENT_TYPES.PURCHASE) monetary += bucket.revenue * scoringRule.monetary.pointsPerCurrencyUnit;
      if (bucket._id === EVENT_TYPES.REFUND) monetary -= bucket.revenue * scoringRule.monetary.pointsPerCurrencyUnit;
    }
  }

  if (scoringRule.monetary?.cap != null) {
    monetary = Math.min(monetary, scoringRule.monetary.cap);
  }

  // Profile completeness bonus
  let profileBonus = 0;
  if (scoringRule.profileBonus?.enabled) {
    profileBonus = ((user.profile?.completion || 0) / 100) * scoringRule.profileBonus.maxPoints;
  }

  // Inactivity penalty
  let recencyPenalty = 0;
  if (scoringRule.recency?.enabled !== false && user.stats?.lastActivityAt) {
    const idleDays = daysBetween(user.stats.lastActivityAt, now);
    const grace = scoringRule.recency.inactivityGraceDays ?? 14;
    if (idleDays > grace) {
      recencyPenalty = Math.min(
        scoringRule.recency.maxPenalty ?? 100,
        (idleDays - grace) * (scoringRule.recency.inactivityPenaltyPerDay ?? 0.5)
      );
    }
  }

  const total = clamp(engagement + monetary + profileBonus - recencyPenalty, scoringRule);
  const tier = tierFor(total);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        'score.value': total,
        'score.tier': tier,
        'score.breakdown.engagement': Math.round(engagement * 100) / 100,
        'score.breakdown.monetary': Math.round(monetary * 100) / 100,
        'score.breakdown.profile': Math.round(profileBonus * 100) / 100,
        'score.breakdown.recency': -Math.round(recencyPenalty * 100) / 100,
        'score.version': scoringRule.version,
        'score.computedAt': now,
        'score.stale': false,
        'stats.daysSinceLastActivity': user.stats?.lastActivityAt
          ? Math.floor(daysBetween(user.stats.lastActivityAt, now))
          : null,
      },
    }
  );

  return { userId: user._id, score: total, tier };
}

/** Batch recompute, used by the SCORE_RECOMPUTE job. */
async function recomputeBatch({ filter = {}, limit = 1000 } = {}) {
  const rule = await getActiveRule({ force: true });
  const users = await User.find({ deletedAt: null, ...filter }).select('_id').limit(limit).lean();
  let processed = 0;
  for (const u of users) {
    try {
      await recomputeUserScore(u._id, rule);
      processed += 1;
    } catch (err) {
      logger.error({ err, userId: u._id }, 'Score recompute failed');
    }
  }
  return { processed, total: users.length };
}

async function updateScoringRule(patch, actorId) {
  const rule = await getActiveRule({ force: true });
  const editable = ['eventPoints', 'eventCaps', 'monetary', 'recency', 'profileBonus', 'maxScore', 'minScore'];
  for (const key of editable) {
    if (patch[key] !== undefined) rule[key] = patch[key];
  }
  rule.version += 1;
  rule.updatedBy = actorId;
  await rule.save();
  invalidateCache();
  // Everything is now stale; the periodic job will work through the backlog.
  await User.updateMany({ deletedAt: null }, { $set: { 'score.stale': true } });
  return rule;
}

/** What-if preview: score a hypothetical event stream without persisting. */
function simulate(events, rule) {
  const points = toPlainMap(rule.eventPoints);
  let engagement = 0;
  let monetary = 0;
  for (const e of events) {
    engagement += Number(points[e.type] ?? 0);
    if (e.type === EVENT_TYPES.PURCHASE) monetary += Number(e.value || 0) * rule.monetary.pointsPerCurrencyUnit;
  }
  const total = clamp(engagement + Math.min(monetary, rule.monetary.cap), rule);
  return { score: total, tier: tierFor(total), engagement, monetary };
}

module.exports = {
  getActiveRule,
  invalidateCache,
  tierFor,
  decayFactor,
  pointsForEvent,
  applyEventIncrement,
  recomputeUserScore,
  recomputeBatch,
  updateScoringRule,
  simulate,
};
