'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate, authenticateAny } = require('../middlewares/auth');
const { requireStaff } = require('../middlewares/rbac');
const { ingestLimiter } = require('../middlewares/rateLimit');
const v = require('../validators/event.validator');
const c = require('../controllers/event.controller');

// Ingestion accepts either a logged-in session or a server-side API key.
router.post('/track', ingestLimiter, authenticateAny, validate({ body: v.trackEvent }), c.track);
router.post('/track/batch', ingestLimiter, authenticateAny, validate({ body: v.trackBatch }), c.trackBatch);

// Analytics are staff-only.
router.get('/', authenticate, requireStaff, validate({ query: v.listQuery }), c.list);
router.get('/funnel', authenticate, requireStaff, c.funnel);
router.get('/stage-funnel', authenticate, requireStaff, c.stageFunnel);
router.get('/stats', authenticate, requireStaff, c.stats);

module.exports = router;
