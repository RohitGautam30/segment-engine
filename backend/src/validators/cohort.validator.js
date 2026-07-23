'use strict';
const { z } = require('zod');
const { COHORT_TYPE, EVENT_TYPES } = require('../config/constants');
const { paginationQuery, objectId, window } = require('./common.validator');

const OPERATORS = [
  'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
  'in', 'nin', 'between',
  'contains', 'notContains', 'startsWith', 'endsWith',
  'exists', 'notExists',
];

// Recursive rule schema. Deep semantic checks (field allow-list, aggregate
// compatibility) live in ruleEngine.validateRules; this is the shape gate.
const ruleNode = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['AND', 'OR', 'NOT', 'and', 'or', 'not']),
      conditions: z.array(ruleNode).min(1).max(60),
    }),
    z.object({
      type: z.literal('attribute'),
      field: z.string().min(1).max(120),
      operator: z.enum(OPERATORS),
      value: z.any().optional(),
    }),
    z.object({ type: z.literal('score'), operator: z.enum(OPERATORS), value: z.any() }),
    z.object({ type: z.literal('tier'), operator: z.enum(OPERATORS), value: z.any() }),
    z.object({
      type: z.literal('tag'),
      operator: z.enum(['has', 'hasNot', 'hasAny', 'hasAll']),
      value: z.union([z.string(), z.array(z.string())]),
    }),
    z.object({
      type: z.literal('event'),
      event: z.union([z.enum(Object.values(EVENT_TYPES)), z.literal('ANY')]),
      aggregate: z.enum(['count', 'sum', 'avg', 'max', 'min', 'last_occurred_at', 'first_occurred_at']).optional(),
      property: z.enum(['value', 'quantity']).optional(),
      operator: z.enum(OPERATORS),
      value: z.any(),
      window,
      filters: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    }),
    z.object({
      type: z.literal('event_not_performed'),
      event: z.union([z.enum(Object.values(EVENT_TYPES)), z.literal('ANY')]),
      window,
    }),
  ])
);

const create = z
  .object({
    name: z.string().min(2).max(120),
    slug: z.string().max(80).optional(),
    description: z.string().max(1000).optional(),
    type: z.enum(Object.values(COHORT_TYPE)).optional(),
    rules: ruleNode.optional(),
    staticMemberIds: z.array(objectId).max(50000).optional(),
    isActive: z.boolean().optional(),
    autoRefresh: z.boolean().optional(),
    refreshIntervalMinutes: z.coerce.number().int().min(5).max(10080).optional(),
  })
  .refine((d) => (d.type === COHORT_TYPE.STATIC ? !!d.staticMemberIds : !!d.rules), {
    message: 'Dynamic cohorts require "rules"; static cohorts require "staticMemberIds"',
  });

const update = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(1000).optional(),
  rules: ruleNode.optional(),
  staticMemberIds: z.array(objectId).max(50000).optional(),
  isActive: z.boolean().optional(),
  autoRefresh: z.boolean().optional(),
  refreshIntervalMinutes: z.coerce.number().int().min(5).max(10080).optional(),
});

const preview = z.object({
  rules: ruleNode,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  includeInactive: z.boolean().optional(),
});

const listQuery = paginationQuery.extend({
  isActive: z.coerce.boolean().optional(),
  type: z.enum(Object.values(COHORT_TYPE)).optional(),
  search: z.string().max(60).optional(),
});

module.exports = { create, update, preview, listQuery, ruleNode, OPERATORS };
