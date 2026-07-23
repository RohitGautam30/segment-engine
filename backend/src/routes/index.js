'use strict';
const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/events', require('./event.routes'));
router.use('/cohorts', require('./cohort.routes'));
router.use('/campaigns', require('./campaign.routes'));
router.use('/scoring', require('./scoring.routes'));
router.use('/system', require('./system.routes'));

router.get('/', (_req, res) =>
  res.json({
    name: 'Customer Segmentation & Campaign API',
    version: 'v1',
    endpoints: ['/auth', '/users', '/events', '/cohorts', '/campaigns', '/scoring', '/system'],
  })
);

module.exports = router;
