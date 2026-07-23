'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { requireStaff, requireCampaignOperator } = require('../middlewares/rbac');
const { idParam } = require('../validators/common.validator');
const v = require('../validators/cohort.validator');
const c = require('../controllers/cohort.controller');

router.use(authenticate);

router.get('/schema', requireStaff, c.schema);
router.post('/preview', requireStaff, validate({ body: v.preview }), c.preview);

router.route('/')
  .post(requireCampaignOperator, validate({ body: v.create }), c.create)
  .get(requireStaff, validate({ query: v.listQuery }), c.list);

router.route('/:id')
  .get(requireStaff, validate({ params: idParam }), c.getById)
  .patch(requireCampaignOperator, validate({ params: idParam, body: v.update }), c.update)
  .delete(requireCampaignOperator, validate({ params: idParam }), c.archive);

router.post('/:id/refresh', requireStaff, validate({ params: idParam }), c.refresh);
router.get('/:id/members', requireStaff, validate({ params: idParam }), c.members);

module.exports = router;
