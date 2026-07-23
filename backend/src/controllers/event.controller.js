'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok, created, paginated } = require('../utils/response');
const eventService = require('../services/event.service');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

exports.track = catchAsync(async (req, res) => {
  const result = await eventService.track(req.body, ctx(req));
  return result.duplicate ? ok(res, result) : created(res, result);
});

exports.trackBatch = catchAsync(async (req, res) => {
  const result = await eventService.trackBatch(req.body.events, ctx(req));
  return ok(res, result);
});

exports.list = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await eventService.listEvents(req.query, req.query);
  return paginated(res, items, { page, limit, total });
});

exports.funnel = catchAsync(async (req, res) => {
  const data = await eventService.getFunnel({ from: req.query.from, to: req.query.to });
  return ok(res, data);
});

/** The four-stage lifecycle funnel named in the spec. */
exports.stageFunnel = catchAsync(async (_req, res) => {
  const data = await eventService.getStageFunnel();
  return ok(res, data);
});

exports.stats = catchAsync(async (req, res) => {
  const data = await eventService.getEventStats({ from: req.query.from, to: req.query.to, type: req.query.type });
  return ok(res, data);
});
