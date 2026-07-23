'use strict';
const env = require('../config/env');
const logger = require('../config/logger');
const queue = require('../services/queue.service');
const campaignService = require('../services/campaign.service');
const { JOB_TYPES } = require('../config/constants');

/**
 * Lightweight in-process scheduler. It only enqueues work — the worker
 * executes it — so running several API replicas is safe: duplicate jobs are
 * collapsed by the queue's dedupeKey.
 */
function startScheduler() {
  const timers = [];

  const every = (ms, name, fn) => {
    const t = setInterval(() => {
      Promise.resolve(fn()).catch((err) => logger.error({ err, task: name }, 'Scheduled task failed'));
    }, ms);
    t.unref();
    timers.push(t);
  };

  // Fire campaigns whose scheduled time has arrived.
  every(60_000, 'due-campaigns', async () => {
    const due = await campaignService.findDueCampaigns();
    for (const campaign of due) {
      // eslint-disable-next-line no-await-in-loop
      await campaignService.launch(campaign._id, { trigger: 'SCHEDULE' }).catch((err) =>
        logger.warn({ err, campaignId: campaign._id }, 'Scheduled launch failed')
      );
    }
  });

  every(env.COHORT_REFRESH_MINUTES * 60_000, 'cohort-refresh', () =>
    queue.enqueue(JOB_TYPES.COHORT_REFRESH, {}, { dedupeKey: 'cohort:refresh:due' })
  );

  every(env.SCORE_RECOMPUTE_CRON_MINUTES * 60_000, 'score-recompute', () =>
    queue.enqueue(JOB_TYPES.SCORE_RECOMPUTE, { limit: 5000 }, { dedupeKey: 'score:recompute:stale' })
  );

  every(120_000, 'reclaim-stale-jobs', () => queue.reclaimStale());

  logger.info('Scheduler started');
  return { stop: () => timers.forEach(clearInterval) };
}

module.exports = { startScheduler };
