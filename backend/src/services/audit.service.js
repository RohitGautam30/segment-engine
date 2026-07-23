'use strict';
const { AuditLog } = require('../models');
const logger = require('../config/logger');

/** Fire-and-forget audit trail. Never blocks or fails the request. */
function record(req, { action, resource, resourceId, changes }) {
  const entry = {
    actorId: req.user?._id,
    actorEmail: req.user?.email,
    action,
    resource,
    resourceId: resourceId ? String(resourceId) : undefined,
    changes,
    ip: req.ip,
    requestId: req.id,
  };
  AuditLog.create(entry).catch((err) => logger.warn({ err, action }, 'Audit log write failed'));
}

module.exports = { record };
