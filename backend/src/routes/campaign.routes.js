'use strict';
const router = require('express').Router();
const validate = require('../middlewares/validate');
const { authenticate } = require('../middlewares/auth');
const { requireStaff, requireCampaignOperator } = require('../middlewares/rbac');
const { idParam, objectId } = require('../validators/common.validator');
const { z } = require('zod');
const v = require('../validators/campaign.validator');
const c = require('../controllers/campaign.controller');

router.use(authenticate);

router.route('/')
  .post(requireCampaignOperator, validate({ body: v.create }), c.create)
  .get(requireStaff, validate({ query: v.listQuery }), c.list);

router.post('/quick-send', requireCampaignOperator, validate({ body: v.quickSend }), c.quickSend);

router.get('/runs/:runId', requireStaff, validate({ params: z.object({ runId: objectId }) }), c.runReport);

router.route('/:id')
  .get(requireStaff, validate({ params: idParam }), c.getById)
  .patch(requireCampaignOperator, validate({ params: idParam, body: v.update }), c.update)
  .delete(requireCampaignOperator, validate({ params: idParam }), c.archive);

router.get('/:id/estimate', requireStaff, validate({ params: idParam }), c.estimate);
router.post('/:id/launch', requireCampaignOperator, validate({ params: idParam, body: v.launch }), c.launch);
router.post('/:id/schedule', requireCampaignOperator, validate({ params: idParam }), c.schedule);
router.post('/:id/pause', requireCampaignOperator, validate({ params: idParam }), c.pause);
router.post('/:id/resume', requireCampaignOperator, validate({ params: idParam }), c.resume);
router.get('/:id/runs', requireStaff, validate({ params: idParam }), c.runs);

module.exports = router;
