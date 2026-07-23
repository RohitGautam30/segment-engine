'use strict';
const crypto = require('crypto');
const { Cohort, CohortMembership, User } = require('../models');
const ruleEngine = require('./ruleEngine');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { COHORT_TYPE } = require('../config/constants');
const { parsePagination, parseSort } = require('../utils/pagination');

const PREVIEW_PROJECTION = {
  email: 1,
  'profile.firstName': 1,
  'profile.lastName': 1,
  'profile.country': 1,
  'profile.completion': 1,
  'score.value': 1,
  'score.tier': 1,
  'stats.purchaseCount': 1,
  'stats.totalRevenue': 1,
  'stats.lastActivityAt': 1,
  createdAt: 1,
};

const slugify = (name) =>
  String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

async function uniqueSlug(name) {
  const base = slugify(name) || `cohort-${Date.now()}`;
  let slug = base;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await Cohort.exists({ slug })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

/* ------------------------------------------------------------------ */
/* Rule evaluation                                                     */
/* ------------------------------------------------------------------ */

/** Builds the pipeline that selects members of a cohort. */
function buildPipeline(cohort, { project, extraMatch, includeInactive } = {}) {
  if (cohort.type === COHORT_TYPE.STATIC) {
    const ids = cohort.staticMemberIds || [];
    const pipeline = [{ $match: { _id: { $in: ids }, deletedAt: null, ...(extraMatch || {}) } }];
    if (project) pipeline.push({ $project: project });
    return pipeline;
  }
  return ruleEngine.compile(cohort.rules, { project, extraMatch, includeInactive });
}

/** Dry-run a rule tree without saving a cohort. */
async function preview(rules, { limit = 20, includeInactive = false } = {}) {
  ruleEngine.validateRules(rules);
  const pipeline = ruleEngine.compile(rules, { includeInactive, project: PREVIEW_PROJECTION });

  const [countResult, sample] = await Promise.all([
    User.aggregate([...ruleEngine.compile(rules, { includeInactive, project: { _id: 1 } }), { $count: 'total' }]),
    User.aggregate([...pipeline, { $sort: { 'score.value': -1 } }, { $limit: Math.min(limit, 100) }]),
  ]);

  return {
    matchCount: countResult[0]?.total || 0,
    sample,
    explanation: ruleEngine.describe(rules),
  };
}

async function countMembers(cohort, { includeInactive = false } = {}) {
  const pipeline = buildPipeline(cohort, { project: { _id: 1 }, includeInactive });
  const res = await User.aggregate([...pipeline, { $count: 'total' }]);
  return res[0]?.total || 0;
}

/**
 * Materialise membership into CohortMembership.
 * Rows are stamped with a batch id, then anything not stamped in this run is
 * removed, which gives an atomic-feeling swap without dropping the collection.
 */
async function refresh(cohortId, { includeInactive = false } = {}) {
  const startedAt = Date.now();
  const cohort = await Cohort.findById(cohortId);
  if (!cohort) throw ApiError.notFound('Cohort not found');

  const batch = crypto.randomUUID();
  let inserted = 0;

  try {
    const pipeline = buildPipeline(cohort, { project: { _id: 1, 'score.value': 1 }, includeInactive });
    const cursor = User.aggregate(pipeline).cursor({ batchSize: 1000 });

    let buffer = [];
    const flush = async () => {
      if (!buffer.length) return;
      await CohortMembership.bulkWrite(
        buffer.map((doc) => ({
          updateOne: {
            filter: { cohortId: cohort._id, userId: doc._id },
            update: {
              $set: { refreshBatch: batch, scoreAtEntry: doc.score?.value ?? 0 },
              $setOnInsert: { enteredAt: new Date() },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
      inserted += buffer.length;
      buffer = [];
    };

    for await (const doc of cursor) {
      buffer.push(doc);
      if (buffer.length >= 1000) await flush();
    }
    await flush();

    // Sweep members who no longer satisfy the rules.
    const removed = await CohortMembership.deleteMany({ cohortId: cohort._id, refreshBatch: { $ne: batch } });

    const durationMs = Date.now() - startedAt;
    await Cohort.updateOne(
      { _id: cohort._id },
      {
        $set: {
          memberCount: inserted,
          lastRefreshedAt: new Date(),
          lastRefreshDurationMs: durationMs,
          lastRefreshError: null,
        },
      }
    );

    logger.info(
      { cohortId: String(cohort._id), members: inserted, removed: removed.deletedCount, durationMs },
      'Cohort refreshed'
    );
    return { cohortId: cohort._id, memberCount: inserted, removed: removed.deletedCount, durationMs };
  } catch (err) {
    await Cohort.updateOne({ _id: cohort._id }, { $set: { lastRefreshError: err.message, lastRefreshedAt: new Date() } });
    throw err;
  }
}

/**
 * Streams the user ids for a cohort, in _id order, so a campaign can page
 * through a very large audience without loading it all into memory.
 */
async function getMemberPage(cohortId, { after = null, limit = 500 } = {}) {
  const filter = { cohortId };
  if (after) filter.userId = { $gt: after };
  const rows = await CohortMembership.find(filter).sort({ userId: 1 }).limit(limit).select('userId').lean();
  return rows.map((r) => r.userId);
}

async function listMembers(cohortId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const [rows, total] = await Promise.all([
    CohortMembership.find({ cohortId })
      .sort({ enteredAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'email profile score stats createdAt')
      .lean(),
    CohortMembership.countDocuments({ cohortId }),
  ]);
  return { items: rows.map((r) => ({ ...r.userId, enteredAt: r.enteredAt, scoreAtEntry: r.scoreAtEntry })), page, limit, total };
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

async function create(payload, actorId) {
  if (payload.type !== COHORT_TYPE.STATIC) {
    ruleEngine.validateRules(payload.rules);
  }
  const cohort = await Cohort.create({
    ...payload,
    slug: payload.slug ? slugify(payload.slug) : await uniqueSlug(payload.name),
    createdBy: actorId,
    updatedBy: actorId,
  });
  // First materialisation happens inline so the cohort is usable immediately.
  await refresh(cohort._id).catch((err) => logger.warn({ err }, 'Initial cohort refresh failed'));
  return Cohort.findById(cohort._id);
}

async function update(cohortId, patch, actorId) {
  const cohort = await Cohort.findById(cohortId);
  if (!cohort) throw ApiError.notFound('Cohort not found');
  if (patch.rules) ruleEngine.validateRules(patch.rules);

  Object.assign(cohort, patch, { updatedBy: actorId });
  await cohort.save();

  if (patch.rules || patch.type || patch.staticMemberIds) {
    await refresh(cohort._id).catch((err) => logger.warn({ err }, 'Cohort refresh after update failed'));
  }
  return Cohort.findById(cohort._id);
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, ['createdAt', 'name', 'memberCount', 'lastRefreshedAt']);
  const filter = { archivedAt: null };
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.type) filter.type = query.type;
  if (query.search) filter.name = { $regex: String(query.search).slice(0, 60), $options: 'i' };

  const [items, total] = await Promise.all([
    Cohort.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Cohort.countDocuments(filter),
  ]);
  return { items: items.map((c) => ({ ...c, explanation: safeDescribe(c) })), page, limit, total };
}

function safeDescribe(cohort) {
  try {
    return cohort.type === COHORT_TYPE.STATIC ? 'static list' : ruleEngine.describe(cohort.rules);
  } catch {
    return null;
  }
}

async function getById(cohortId) {
  const cohort = await Cohort.findById(cohortId).lean();
  if (!cohort) throw ApiError.notFound('Cohort not found');
  return { ...cohort, explanation: safeDescribe(cohort) };
}

async function archive(cohortId, actorId) {
  const cohort = await Cohort.findByIdAndUpdate(
    cohortId,
    { $set: { archivedAt: new Date(), isActive: false, updatedBy: actorId } },
    { new: true }
  );
  if (!cohort) throw ApiError.notFound('Cohort not found');
  await CohortMembership.deleteMany({ cohortId });
  return cohort;
}

/** Cohorts due for an automatic refresh — driven by the scheduler. */
async function findDueForRefresh(now = new Date()) {
  const cohorts = await Cohort.find({ isActive: true, autoRefresh: true, archivedAt: null })
    .select('_id refreshIntervalMinutes lastRefreshedAt')
    .lean();
  return cohorts
    .filter((c) => !c.lastRefreshedAt || now - new Date(c.lastRefreshedAt) >= c.refreshIntervalMinutes * 60000)
    .map((c) => c._id);
}

/** Which cohorts does this user currently belong to? */
async function cohortsForUser(userId) {
  const rows = await CohortMembership.find({ userId }).populate('cohortId', 'name slug type').lean();
  return rows.filter((r) => r.cohortId).map((r) => ({ ...r.cohortId, enteredAt: r.enteredAt }));
}

module.exports = {
  create,
  update,
  list,
  getById,
  archive,
  preview,
  refresh,
  countMembers,
  listMembers,
  getMemberPage,
  buildPipeline,
  findDueForRefresh,
  cohortsForUser,
  PREVIEW_PROJECTION,
};
