'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok, created, paginated } = require('../utils/response');
const campaignService = require('../services/campaign.service');
const audit = require('../services/audit.service');

exports.create = catchAsync(async (req, res) => {
  const campaign = await campaignService.create(req.body, req.user._id);
  audit.record(req, { action: 'campaign.create', resource: 'Campaign', resourceId: campaign._id, changes: { name: campaign.name } });
  return created(res, campaign);
});

exports.list = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await campaignService.list(req.query);
  return paginated(res, items, { page, limit, total });
});

exports.getById = catchAsync(async (req, res) => ok(res, await campaignService.getById(req.params.id)));

exports.update = catchAsync(async (req, res) => {
  const campaign = await campaignService.update(req.params.id, req.body, req.user._id);
  audit.record(req, { action: 'campaign.update', resource: 'Campaign', resourceId: campaign._id, changes: req.body });
  return ok(res, campaign);
});

exports.estimate = catchAsync(async (req, res) => ok(res, await campaignService.estimateAudience(req.params.id)));

/** Kick off a run. Returns immediately; the worker does the sending. */
exports.launch = catchAsync(async (req, res) => {
  const run = await campaignService.launch(req.params.id, {
    actorId: req.user._id,
    isDryRun: req.body?.isDryRun,
    refreshCohorts: req.body?.refreshCohorts !== false,
  });
  audit.record(req, {
    action: req.body?.isDryRun ? 'campaign.dryrun' : 'campaign.launch',
    resource: 'Campaign',
    resourceId: req.params.id,
    changes: { runId: String(run._id) },
  });
  return created(res, run);
});

/** Ad-hoc send from the console: hand-picked audience + message, in one call. */
exports.quickSend = catchAsync(async (req, res) => {
  const result = await campaignService.quickSend(req.body, req.user._id);
  audit.record(req, {
    action: 'campaign.quicksend',
    resource: 'Campaign',
    resourceId: result.campaign._id,
    changes: { recipients: req.body.userIds.length, dryRun: !!req.body.isDryRun },
  });
  return created(res, result);
});

exports.schedule = catchAsync(async (req, res) => {
  const campaign = await campaignService.schedule(req.params.id, req.user._id);
  audit.record(req, { action: 'campaign.schedule', resource: 'Campaign', resourceId: campaign._id });
  return ok(res, campaign);
});

exports.pause = catchAsync(async (req, res) => {
  const campaign = await campaignService.pause(req.params.id);
  audit.record(req, { action: 'campaign.pause', resource: 'Campaign', resourceId: campaign._id });
  return ok(res, campaign);
});

exports.resume = catchAsync(async (req, res) => {
  const campaign = await campaignService.resume(req.params.id);
  audit.record(req, { action: 'campaign.resume', resource: 'Campaign', resourceId: campaign._id });
  return ok(res, campaign);
});

exports.archive = catchAsync(async (req, res) => {
  const campaign = await campaignService.archive(req.params.id, req.user._id);
  audit.record(req, { action: 'campaign.archive', resource: 'Campaign', resourceId: campaign._id });
  return ok(res, campaign);
});

exports.runs = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await campaignService.listRuns(req.params.id, req.query);
  return paginated(res, items, { page, limit, total });
});

exports.runReport = catchAsync(async (req, res) => ok(res, await campaignService.getRunReport(req.params.runId)));
