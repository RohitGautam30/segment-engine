'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok } = require('../utils/response');
const scoringService = require('../services/scoring.service');
const queue = require('../services/queue.service');
const { JOB_TYPES, SCORE_TIERS } = require('../config/constants');
const audit = require('../services/audit.service');

exports.getRule = catchAsync(async (_req, res) => {
  const rule = await scoringService.getActiveRule({ force: true });
  return ok(res, { rule, tiers: SCORE_TIERS });
});

exports.updateRule = catchAsync(async (req, res) => {
  const rule = await scoringService.updateScoringRule(req.body, req.user._id);
  audit.record(req, { action: 'scoring.rule.update', resource: 'ScoringRule', resourceId: rule._id, changes: req.body });
  return ok(res, rule);
});

/** Queue a full recompute across all users. */
exports.recomputeAll = catchAsync(async (req, res) => {
  const job = await queue.enqueue(JOB_TYPES.SCORE_RECOMPUTE, { full: true }, { dedupeKey: 'score:recompute:full', priority: 1 });
  audit.record(req, { action: 'scoring.recompute.all', resource: 'ScoringRule' });
  return ok(res, { queued: !!job, jobId: job?._id || null });
});

exports.simulate = catchAsync(async (req, res) => {
  const rule = await scoringService.getActiveRule();
  return ok(res, scoringService.simulate(req.body.events || [], rule));
});
