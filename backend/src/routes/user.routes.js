'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { requireAdmin, requireStaff, requireSelfOrStaff } = require('../middlewares/rbac');
const { idParam } = require('../validators/common.validator');
const v = require('../validators/user.validator');
const c = require('../controllers/user.controller');

router.use(authenticate);

router.get('/overview', requireStaff, c.overview);

router.route('/')
  .post(requireAdmin, validate({ body: v.adminCreate }), c.create)
  .get(requireStaff, validate({ query: v.listQuery }), c.list);

router.route('/:id')
  .get(validate({ params: idParam }), requireSelfOrStaff('id'), c.getById)
  .patch(validate({ params: idParam, body: v.adminUpdate }), requireAdmin, c.update)
  .delete(validate({ params: idParam }), requireAdmin, c.remove);

router.patch('/:id/profile', validate({ params: idParam, body: v.updateProfile }), requireSelfOrStaff('id'), c.updateProfile);
router.get('/:id/timeline', validate({ params: idParam }), requireSelfOrStaff('id'), c.timeline);
router.get('/:id/cohorts', validate({ params: idParam }), requireStaff, c.cohorts);
router.post('/:id/recompute-score', validate({ params: idParam }), requireStaff, c.recomputeScore);

module.exports = router;
