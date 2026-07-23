'use strict';
const { JOB_TYPES } = require('../config/constants');
const campaignService = require('../services/campaign.service');
const cohortService = require('../services/cohort.service');
const scoringService = require('../services/scoring.service');
const logger = require('../config/logger');

const handlers = {
  [JOB_TYPES.CAMPAIGN_RUN]: async (job) => {
    const run = await campaignService.executeRun(job.payload.runId);
    return { runId: String(run._id), sent: run.sent, failed: run.failed, skipped: run.skipped };
  },

  [JOB_TYPES.COHORT_REFRESH]: async (job) => {
    if (job.payload.cohortId) return cohortService.refresh(job.payload.cohortId);
    const due = await cohortService.findDueForRefresh();
    const results = [];
    for (const id of due) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await cohortService.refresh(id).catch((err) => ({ cohortId: id, error: err.message })));
    }
    return { refreshed: results.length };
  },

  [JOB_TYPES.SCORE_RECOMPUTE]: async (job) => {
    if (job.payload.userId) return scoringService.recomputeUserScore(job.payload.userId);
    // Chip away at the stale backlog rather than locking up on a huge sweep.
    const filter = job.payload.full ? {} : { 'score.stale': true };
    const result = await scoringService.recomputeBatch({ filter, limit: job.payload.limit || 2000 });
    logger.info(result, 'Score recompute batch finished');
    return result;
  },
};

module.exports = handlers;
