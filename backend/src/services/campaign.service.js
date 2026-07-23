'use strict';
const dayjs = require('dayjs');
const { Campaign, CampaignRun, Delivery, Cohort, CohortMembership, User } = require('../models');
const { CAMPAIGN_STATUS, RUN_STATUS, DELIVERY_STATUS, JOB_TYPES, COHORT_TYPE } = require('../config/constants');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const env = require('../config/env');
const queue = require('./queue.service');
const cohortService = require('./cohort.service');
const templateService = require('./template.service');
const { getChannel } = require('./channels');
const { parsePagination, parseSort } = require('../utils/pagination');

/* ------------------------------------------------------------------ */
/* CRUD + lifecycle                                                    */
/* ------------------------------------------------------------------ */

async function assertCohortsExist(ids = []) {
  if (!ids.length) return;
  const count = await Cohort.countDocuments({ _id: { $in: ids }, archivedAt: null });
  if (count !== ids.length) throw ApiError.badRequest('One or more cohorts do not exist');
}

function computeNextRun(schedule) {
  if (!schedule) return null;
  if (schedule.mode === 'SCHEDULED') return schedule.sendAt ? new Date(schedule.sendAt) : null;
  if (schedule.mode === 'RECURRING') {
    return schedule.sendAt ? new Date(schedule.sendAt) : dayjs().add(schedule.intervalMinutes || 60, 'minute').toDate();
  }
  return null;
}

async function create(payload, actorId) {
  await assertCohortsExist([...(payload.cohortIds || []), ...(payload.excludeCohortIds || [])]);

  const unknownVars = templateService
    .extractVariables(`${payload.content?.subject || ''} ${payload.content?.body || ''}`)
    .filter((v) => !v.startsWith('user.'));
  if (unknownVars.length) {
    throw ApiError.badRequest(`Unknown template variables: ${unknownVars.join(', ')}. Only user.* is available.`);
  }

  const campaign = await Campaign.create({
    ...payload,
    status: CAMPAIGN_STATUS.DRAFT,
    nextRunAt: computeNextRun(payload.schedule),
    createdBy: actorId,
    updatedBy: actorId,
  });
  return campaign;
}

async function update(campaignId, patch, actorId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if ([CAMPAIGN_STATUS.RUNNING].includes(campaign.status)) {
    throw ApiError.conflict('Cannot edit a campaign while it is running');
  }
  if (patch.cohortIds || patch.excludeCohortIds) {
    await assertCohortsExist([...(patch.cohortIds || []), ...(patch.excludeCohortIds || [])]);
  }
  Object.assign(campaign, patch, { updatedBy: actorId });
  if (patch.schedule) campaign.nextRunAt = computeNextRun(campaign.schedule);
  await campaign.save();
  return campaign;
}

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const sort = parseSort(query.sort, ['createdAt', 'name', 'lastRunAt', 'status']);
  const filter = { archivedAt: null };
  if (query.status) filter.status = query.status;
  if (query.channel) filter.channel = query.channel;
  if (query.search) filter.name = { $regex: String(query.search).slice(0, 60), $options: 'i' };

  const [items, total] = await Promise.all([
    Campaign.find(filter).sort(sort).skip(skip).limit(limit).populate('cohortIds', 'name slug memberCount').lean(),
    Campaign.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

async function getById(campaignId) {
  const campaign = await Campaign.findById(campaignId)
    .populate('cohortIds', 'name slug memberCount lastRefreshedAt')
    .populate('excludeCohortIds', 'name slug memberCount')
    .lean();
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
}

/** Estimated reach after exclusions, consent and frequency capping. */
async function estimateAudience(campaignId) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign) throw ApiError.notFound('Campaign not found');

  const included = await CohortMembership.distinct('userId', { cohortId: { $in: campaign.cohortIds } });
  const excluded = campaign.excludeCohortIds?.length
    ? await CohortMembership.distinct('userId', { cohortId: { $in: campaign.excludeCohortIds } })
    : [];
  const excludedSet = new Set(excluded.map(String));
  const candidateIds = included.filter((id) => !excludedSet.has(String(id)));

  const filter = buildEligibilityFilter(campaign, candidateIds);
  const reachable = await User.countDocuments(filter);

  return {
    cohortReach: included.length,
    afterExclusions: candidateIds.length,
    eligible: reachable,
    cappedAt: campaign.throttle?.maxRecipients || null,
    finalEstimate: campaign.throttle?.maxRecipients ? Math.min(reachable, campaign.throttle.maxRecipients) : reachable,
  };
}

function buildEligibilityFilter(campaign, userIds) {
  const filter = { _id: { $in: userIds }, deletedAt: null, status: 'ACTIVE' };
  const throttle = campaign.throttle || {};

  if (throttle.respectConsent !== false) {
    const consentField = { EMAIL: 'consent.email', SMS: 'consent.sms', PUSH: 'consent.push' }[campaign.channel];
    if (consentField) filter[consentField] = true;
  }
  if (throttle.minScore != null) filter['score.value'] = { $gte: throttle.minScore };
  if (throttle.frequencyCapDays > 0) {
    filter.$or = [
      { lastContactedAt: null },
      { lastContactedAt: { $lt: dayjs().subtract(throttle.frequencyCapDays, 'day').toDate() } },
    ];
  }
  return filter;
}

/* ------------------------------------------------------------------ */
/* Running a campaign                                                  */
/* ------------------------------------------------------------------ */

/**
 * Launch: refreshes the targeted cohorts, creates a run, and hands execution
 * to the worker. Returns immediately so the API stays responsive.
 */
async function launch(campaignId, { actorId, trigger = 'MANUAL', isDryRun = false, refreshCohorts = true } = {}) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (!campaign.cohortIds?.length) throw ApiError.badRequest('Campaign has no target cohort');
  if (campaign.status === CAMPAIGN_STATUS.RUNNING) throw ApiError.conflict('Campaign is already running');
  if (campaign.archivedAt) throw ApiError.conflict('Campaign is archived');

  if (refreshCohorts) {
    // Segment freshness matters more than latency here — a stale cohort sends
    // the wrong message to the wrong people.
    for (const cohortId of campaign.cohortIds) {
      // eslint-disable-next-line no-await-in-loop
      await cohortService.refresh(cohortId).catch((err) => logger.warn({ err, cohortId }, 'Pre-launch refresh failed'));
    }
  }

  const run = await CampaignRun.create({
    campaignId: campaign._id,
    status: RUN_STATUS.QUEUED,
    triggeredBy: actorId,
    trigger,
    isDryRun,
    snapshotCohortIds: campaign.cohortIds,
  });

  campaign.status = CAMPAIGN_STATUS.RUNNING;
  campaign.lastRunAt = new Date();
  campaign.stats.totalRuns += 1;
  await campaign.save();

  await queue.enqueue(JOB_TYPES.CAMPAIGN_RUN, { runId: String(run._id) }, { dedupeKey: `run:${run._id}`, priority: 5 });

  return run;
}

/** Executes one run: builds the audience, then processes it in batches. */
async function executeRun(runId) {
  const run = await CampaignRun.findById(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  if ([RUN_STATUS.COMPLETED, RUN_STATUS.CANCELLED].includes(run.status)) return run;

  const campaign = await Campaign.findById(run.campaignId);
  if (!campaign) throw new Error('Campaign not found for run');

  run.status = RUN_STATUS.BUILDING_AUDIENCE;
  run.startedAt = run.startedAt || new Date();
  await run.save();

  const included = await CohortMembership.distinct('userId', { cohortId: { $in: run.snapshotCohortIds } });
  const excluded = campaign.excludeCohortIds?.length
    ? await CohortMembership.distinct('userId', { cohortId: { $in: campaign.excludeCohortIds } })
    : [];
  const excludedSet = new Set(excluded.map(String));
  const candidateIds = included.filter((id) => !excludedSet.has(String(id)));

  run.audienceSize = candidateIds.length;
  run.status = RUN_STATUS.SENDING;
  await run.save();

  const filter = buildEligibilityFilter(campaign, candidateIds);
  const maxRecipients = campaign.throttle?.maxRecipients || Infinity;
  const batchSize = env.CAMPAIGN_BATCH_SIZE;
  const channel = getChannel(campaign.channel);

  let cursor = run.cursor || null;
  let processedTotal = run.processed || 0;

  /* eslint-disable no-await-in-loop */
  while (processedTotal < maxRecipients) {
    const pageFilter = cursor ? { ...filter, _id: { $in: candidateIds, $gt: cursor } } : filter;
    const batch = await User.find(pageFilter).sort({ _id: 1 }).limit(batchSize).lean();
    if (!batch.length) break;

    const outcome = await processBatch({ campaign, run, users: batch, channel });

    processedTotal += batch.length;
    cursor = batch[batch.length - 1]._id;

    await CampaignRun.updateOne(
      { _id: run._id },
      {
        $set: { cursor },
        $inc: { processed: batch.length, sent: outcome.sent, failed: outcome.failed, skipped: outcome.skipped },
      }
    );

    const current = await CampaignRun.findById(run._id).select('status').lean();
    if (current.status === RUN_STATUS.CANCELLED) {
      logger.info({ runId: String(run._id) }, 'Run cancelled mid-flight');
      return CampaignRun.findById(run._id);
    }
    if (batch.length < batchSize) break;
  }
  /* eslint-enable no-await-in-loop */

  const finished = await CampaignRun.findByIdAndUpdate(
    run._id,
    { $set: { status: RUN_STATUS.COMPLETED, finishedAt: new Date() } },
    { new: true }
  );

  await Campaign.updateOne(
    { _id: campaign._id },
    {
      $set: { status: nextCampaignStatus(campaign), nextRunAt: nextRecurringDate(campaign) },
      $inc: {
        'stats.totalTargeted': finished.audienceSize,
        'stats.totalSent': finished.sent,
        'stats.totalFailed': finished.failed,
        'stats.totalSkipped': finished.skipped,
      },
    }
  );

  logger.info(
    { runId: String(run._id), sent: finished.sent, failed: finished.failed, skipped: finished.skipped },
    'Campaign run completed'
  );
  return finished;
}

function nextCampaignStatus(campaign) {
  if (campaign.schedule?.mode === 'RECURRING') {
    const ended = campaign.schedule.endsAt && new Date(campaign.schedule.endsAt) <= new Date();
    return ended ? CAMPAIGN_STATUS.COMPLETED : CAMPAIGN_STATUS.SCHEDULED;
  }
  return CAMPAIGN_STATUS.COMPLETED;
}

function nextRecurringDate(campaign) {
  if (campaign.schedule?.mode !== 'RECURRING') return null;
  if (campaign.schedule.endsAt && new Date(campaign.schedule.endsAt) <= new Date()) return null;
  return dayjs().add(campaign.schedule.intervalMinutes || 60, 'minute').toDate();
}

function inQuietHours(throttle, now = new Date()) {
  if (!throttle?.quietHours?.enabled) return false;
  const hour = now.getHours();
  const { startHour, endHour } = throttle.quietHours;
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

/** Renders and dispatches one batch, writing a Delivery row per recipient. */
async function processBatch({ campaign, run, users, channel }) {
  const result = { sent: 0, failed: 0, skipped: 0 };
  const quiet = inQuietHours(campaign.throttle);

  for (const user of users) {
    // The unique (runId, userId) index makes a retried batch a no-op.
    let delivery;
    try {
      delivery = await Delivery.create({
        campaignId: campaign._id,
        runId: run._id,
        userId: user._id,
        channel: campaign.channel,
        status: DELIVERY_STATUS.PENDING,
      });
    } catch (err) {
      if (err.code === 11000) continue; // already handled in an earlier attempt
      throw err;
    }

    const context = templateService.buildContext(user);
    const renderedSubject = templateService.render(campaign.content.subject, context);
    const renderedBody = templateService.render(campaign.content.body, context, { escape: false });

    const { destination, reason } = channel.resolveDestination(user, campaign);
    let skipReason = null;
    if (!destination) skipReason = reason;
    else if (quiet) skipReason = 'QUIET_HOURS';
    else if (run.isDryRun) skipReason = 'DRY_RUN';

    if (skipReason) {
      await Delivery.updateOne(
        { _id: delivery._id },
        { $set: { status: DELIVERY_STATUS.SKIPPED, skipReason, destination, renderedSubject, renderedBody } }
      );
      result.skipped += 1;
      continue;
    }

    try {
      const sendResult = await channel.send({
        destination,
        subject: renderedSubject,
        body: renderedBody,
        fromName: campaign.content.fromName,
        fromEmail: campaign.content.fromEmail,
        meta: { campaignId: String(campaign._id), runId: String(run._id), userId: String(user._id) },
      });

      await Delivery.updateOne(
        { _id: delivery._id },
        {
          $set: {
            status: DELIVERY_STATUS.SENT,
            destination,
            renderedSubject,
            renderedBody,
            providerMessageId: sendResult.providerMessageId,
            sentAt: new Date(),
          },
          $inc: { attempts: 1 },
        }
      );
      await User.updateOne({ _id: user._id }, { $set: { lastContactedAt: new Date() }, $inc: { contactCount30d: 1 } });
      result.sent += 1;
    } catch (err) {
      await Delivery.updateOne(
        { _id: delivery._id },
        { $set: { status: DELIVERY_STATUS.FAILED, destination, error: err.message }, $inc: { attempts: 1 } }
      );
      result.failed += 1;
      logger.warn({ err, userId: String(user._id), campaignId: String(campaign._id) }, 'Delivery failed');
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Controls & reporting                                                */
/* ------------------------------------------------------------------ */

async function pause(campaignId) {
  const campaign = await Campaign.findByIdAndUpdate(
    campaignId,
    { $set: { status: CAMPAIGN_STATUS.PAUSED, nextRunAt: null } },
    { new: true }
  );
  if (!campaign) throw ApiError.notFound('Campaign not found');
  await CampaignRun.updateMany(
    { campaignId, status: { $in: [RUN_STATUS.QUEUED, RUN_STATUS.SENDING, RUN_STATUS.BUILDING_AUDIENCE] } },
    { $set: { status: RUN_STATUS.CANCELLED, finishedAt: new Date() } }
  );
  return campaign;
}

async function resume(campaignId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.status !== CAMPAIGN_STATUS.PAUSED) throw ApiError.badRequest('Campaign is not paused');
  campaign.status = campaign.schedule?.mode === 'IMMEDIATE' ? CAMPAIGN_STATUS.DRAFT : CAMPAIGN_STATUS.SCHEDULED;
  campaign.nextRunAt = computeNextRun(campaign.schedule);
  await campaign.save();
  return campaign;
}

async function listRuns(campaignId, query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const [items, total] = await Promise.all([
    CampaignRun.find({ campaignId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CampaignRun.countDocuments({ campaignId }),
  ]);
  return { items, page, limit, total };
}

async function getRunReport(runId) {
  const run = await CampaignRun.findById(runId).lean();
  if (!run) throw ApiError.notFound('Run not found');
  const [byStatus, skipReasons] = await Promise.all([
    Delivery.aggregate([{ $match: { runId: run._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Delivery.aggregate([
      { $match: { runId: run._id, skipReason: { $ne: null } } },
      { $group: { _id: '$skipReason', count: { $sum: 1 } } },
    ]),
  ]);
  const sent = byStatus.find((s) => s._id === DELIVERY_STATUS.SENT)?.count || 0;
  return {
    run,
    deliveryBreakdown: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    skipReasons: Object.fromEntries(skipReasons.map((s) => [s._id, s.count])),
    deliveryRate: run.audienceSize ? Math.round((sent / run.audienceSize) * 10000) / 100 : 0,
  };
}

/** Campaigns whose scheduled time has arrived. */
async function findDueCampaigns(now = new Date()) {
  return Campaign.find({
    status: { $in: [CAMPAIGN_STATUS.SCHEDULED] },
    nextRunAt: { $ne: null, $lte: now },
    archivedAt: null,
  })
    .select('_id')
    .lean();
}

async function schedule(campaignId, actorId) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw ApiError.notFound('Campaign not found');
  if (campaign.schedule?.mode === 'IMMEDIATE') throw ApiError.badRequest('Campaign schedule mode is IMMEDIATE; launch it instead');
  campaign.status = CAMPAIGN_STATUS.SCHEDULED;
  campaign.nextRunAt = computeNextRun(campaign.schedule);
  campaign.updatedBy = actorId;
  await campaign.save();
  return campaign;
}

async function archive(campaignId, actorId) {
  const campaign = await Campaign.findByIdAndUpdate(
    campaignId,
    { $set: { archivedAt: new Date(), status: CAMPAIGN_STATUS.CANCELLED, nextRunAt: null, updatedBy: actorId } },
    { new: true }
  );
  if (!campaign) throw ApiError.notFound('Campaign not found');
  return campaign;
}

/**
 * Ad-hoc send: takes a hand-picked list of users, wraps them in a STATIC
 * cohort, creates a campaign around it and runs it. This is what the console's
 * "select these people and message them" action calls, so an ad-hoc blast
 * still produces the same Cohort / Campaign / Run / Delivery records as a
 * planned one — nothing bypasses the audit trail.
 *
 * `sync` executes inline and returns the finished run, so the UI works even
 * when no worker process is running. Large audiences should always go async.
 */
async function quickSend(payload, actorId) {
  const { name, subject, body, channel = 'EMAIL', userIds, throttle = {}, isDryRun = false, sync = true } = payload;

  if (!userIds?.length) throw ApiError.badRequest('Select at least one recipient');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cohort = await Cohort.create({
    name: `${name} — audience ${stamp}`,
    slug: `adhoc-${stamp.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`,
    description: `Hand-picked audience for "${name}"`,
    type: COHORT_TYPE.STATIC,
    rules: { op: 'AND', conditions: [] },
    staticMemberIds: userIds,
    autoRefresh: false,
    createdBy: actorId,
  });

  const campaign = await Campaign.create({
    name,
    description: 'Created from the console',
    channel,
    cohortIds: [cohort._id],
    content: { subject, body, fromName: 'Segment Console', fromEmail: 'hello@example.com' },
    schedule: { mode: 'IMMEDIATE' },
    throttle,
    createdBy: actorId,
    updatedBy: actorId,
  });

  const run = await launch(campaign._id, { actorId, trigger: 'MANUAL', isDryRun, refreshCohorts: true });

  if (sync) {
    if (userIds.length > 5000) throw ApiError.badRequest('Audience too large for a synchronous send; use the queue');
    const finished = await executeRun(run._id);
    return { campaign, cohort, run: finished, report: await getRunReport(finished._id) };
  }

  return { campaign, cohort, run, report: null };
}

module.exports = {
  create,
  update,
  list,
  getById,
  estimateAudience,
  launch,
  quickSend,
  executeRun,
  pause,
  resume,
  schedule,
  archive,
  listRuns,
  getRunReport,
  findDueCampaigns,
  buildEligibilityFilter,
  inQuietHours,
};
