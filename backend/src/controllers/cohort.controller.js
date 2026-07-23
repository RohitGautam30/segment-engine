'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok, created, paginated } = require('../utils/response');
const cohortService = require('../services/cohort.service');
const { listFields } = require('../services/fieldRegistry');
const { OPERATORS } = require('../validators/cohort.validator');
const { EVENT_TYPES, LIFECYCLE_STAGES } = require('../config/constants');
const audit = require('../services/audit.service');

exports.create = catchAsync(async (req, res) => {
  const cohort = await cohortService.create(req.body, req.user._id);
  audit.record(req, { action: 'cohort.create', resource: 'Cohort', resourceId: cohort._id, changes: { name: cohort.name } });
  return created(res, cohort);
});

exports.list = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await cohortService.list(req.query);
  return paginated(res, items, { page, limit, total });
});

exports.getById = catchAsync(async (req, res) => ok(res, await cohortService.getById(req.params.id)));

exports.update = catchAsync(async (req, res) => {
  const cohort = await cohortService.update(req.params.id, req.body, req.user._id);
  audit.record(req, { action: 'cohort.update', resource: 'Cohort', resourceId: cohort._id, changes: req.body });
  return ok(res, cohort);
});

exports.archive = catchAsync(async (req, res) => {
  const cohort = await cohortService.archive(req.params.id, req.user._id);
  audit.record(req, { action: 'cohort.archive', resource: 'Cohort', resourceId: cohort._id });
  return ok(res, cohort);
});

/** Dry-run a rule tree and see who it would match before saving anything. */
exports.preview = catchAsync(async (req, res) => {
  const result = await cohortService.preview(req.body.rules, {
    limit: req.body.limit,
    includeInactive: req.body.includeInactive,
  });
  return ok(res, result);
});

exports.refresh = catchAsync(async (req, res) => {
  const result = await cohortService.refresh(req.params.id);
  audit.record(req, { action: 'cohort.refresh', resource: 'Cohort', resourceId: req.params.id });
  return ok(res, result);
});

exports.members = catchAsync(async (req, res) => {
  const { items, page, limit, total } = await cohortService.listMembers(req.params.id, req.query);
  return paginated(res, items, { page, limit, total });
});

/** Schema discovery endpoint so a UI can build the rule editor dynamically. */
exports.schema = catchAsync(async (_req, res) =>
  ok(res, {
    fields: listFields(),
    operators: OPERATORS,
    eventTypes: Object.values(EVENT_TYPES),
    lifecycleStages: LIFECYCLE_STAGES,
    aggregates: ['count', 'sum', 'avg', 'max', 'min', 'last_occurred_at', 'first_occurred_at'],
    groupOperators: ['AND', 'OR', 'NOT'],
    conditionTypes: ['attribute', 'score', 'tier', 'tag', 'event', 'event_not_performed'],
  })
);
