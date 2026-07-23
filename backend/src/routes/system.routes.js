'use strict';
const router = require('express').Router();
const { authenticate } = require('../middlewares/auth');
const { requireAdmin } = require('../middlewares/rbac');
const c = require('../controllers/system.controller');

router.get('/health', c.health);
router.get('/ready', c.ready);
router.get('/queue', authenticate, requireAdmin, c.queueStats);
router.get('/audit-logs', authenticate, requireAdmin, c.auditLogs);

module.exports = router;
