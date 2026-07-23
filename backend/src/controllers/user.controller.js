'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok, created, paginated } = require('../utils/response');
const userService = require('../services/user.service');
const cohortService = require('../services/cohort.service');
const eventService = require('../services/event.service');
const audit = require('../services/audit.service');

exports.create = catchAsync(async (req, res) => {
  const user = await userService.adminCreateUser(req.body, req.user._id);
  audit.record(req, { action: 'user.create', resource: 'User', resourceId: user._id, changes: { email: user.email, role: user.role } });
  return created(res, user);
});

exports.list = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await userService.list(req.query);
  return paginated(res, items, { page, limit, total });
});

exports.getById = catchAsync(async (req, res) => {
  const profile = await userService.getProfile360(req.params.id);
  return ok(res, profile);
});

exports.update = catchAsync(async (req, res) => {
  const user = await userService.updateByAdmin(req.params.id, req.body, req.user._id);
  audit.record(req, { action: 'user.update', resource: 'User', resourceId: user._id, changes: req.body });
  return ok(res, user);
});

exports.updateProfile = catchAsync(async (req, res) => {
  const result = await userService.updateProfile(req.params.id, req.body, { ip: req.ip, userAgent: req.get('user-agent') });
  return ok(res, result);
});

exports.remove = catchAsync(async (req, res) => {
  const result = await userService.softDelete(req.params.id);
  audit.record(req, { action: 'user.delete', resource: 'User', resourceId: req.params.id });
  return ok(res, result);
});

exports.timeline = catchAsync(async (req, res) => {
  const items = await eventService.getUserTimeline(req.params.id, { limit: Number(req.query.limit) || 50, before: req.query.before });
  return ok(res, items);
});

exports.cohorts = catchAsync(async (req, res) => {
  const items = await cohortService.cohortsForUser(req.params.id);
  return ok(res, items);
});

exports.recomputeScore = catchAsync(async (req, res) => {
  const result = await userService.recomputeScore(req.params.id);
  audit.record(req, { action: 'user.score.recompute', resource: 'User', resourceId: req.params.id });
  return ok(res, result);
});

exports.overview = catchAsync(async (_req, res) => {
  const data = await userService.getOverview();
  return ok(res, data);
});
