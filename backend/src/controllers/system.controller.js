'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok } = require('../utils/response');
const db = require('../config/db');
const queue = require('../services/queue.service');
const { AuditLog } = require('../models');
const { parsePagination } = require('../utils/pagination');
const { paginated } = require('../utils/response');

exports.health = (_req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });

exports.ready = (_req, res) => {
  const healthy = db.isHealthy();
  return res.status(healthy ? 200 : 503).json({ status: healthy ? 'ready' : 'degraded', database: healthy ? 'up' : 'down' });
};

exports.queueStats = catchAsync(async (_req, res) => ok(res, await queue.stats()));

exports.auditLogs = catchAsync(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.resourceId) filter.resourceId = String(req.query.resourceId);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  return paginated(res, items, { page, limit, total });
});
