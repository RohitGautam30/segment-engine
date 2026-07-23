'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { requireAdmin, requireStaff } = require('../middlewares/rbac');
const v = require('../validators/scoring.validator');
const c = require('../controllers/scoring.controller');

router.use(authenticate);

router.get('/rules', requireStaff, c.getRule);
router.patch('/rules', requireAdmin, validate({ body: v.updateRule }), c.updateRule);
router.post('/recompute', requireAdmin, c.recomputeAll);
router.post('/simulate', requireStaff, c.simulate);

module.exports = router;
