'use strict';
const ApiError = require('../utils/ApiError');
const { resolveWindow } = require('../utils/dates');
const { isAllowedField, fieldType } = require('./fieldRegistry');
const { EVENT_TYPES, USER_STATUS } = require('../config/constants');

/**
 * Rule engine: compiles a declarative rule tree into a MongoDB aggregation
 * pipeline over the `users` collection.
 *
 * Supported node shapes
 * ---------------------
 * Group:      { op: 'AND' | 'OR' | 'NOT', conditions: [ ...nodes ] }
 * Attribute:  { type: 'attribute', field, operator, value }
 * Score:      { type: 'score', operator, value }              // sugar for score.value
 * Tier:       { type: 'tier', operator, value }               // sugar for score.tier
 * Tag:        { type: 'tag', operator: 'has'|'hasNot'|'hasAny'|'hasAll', value }
 * Event:      { type: 'event', event, aggregate, property, operator, value, window, filters }
 * NotDone:    { type: 'event_not_performed', event, window }
 */

const MAX_DEPTH = 6;
const MAX_CONDITIONS = 60;
const MAX_EVENT_CONDITIONS = 12;

const COMPARISON_OPS = new Set(['eq', 'ne', 'gt', 'gte', 'lt', 'lte']);
const SET_OPS = new Set(['in', 'nin']);
const STRING_OPS = new Set(['contains', 'notContains', 'startsWith', 'endsWith']);
const EXIST_OPS = new Set(['exists', 'notExists']);
const RANGE_OPS = new Set(['between']);
const TAG_OPS = new Set(['has', 'hasNot', 'hasAny', 'hasAll']);

const AGGREGATES = new Set(['count', 'sum', 'avg', 'max', 'min', 'last_occurred_at', 'first_occurred_at']);
const AGG_NUMERIC_PROPS = new Set(['value', 'quantity']);

const EXPR_OP = { eq: '$eq', ne: '$ne', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' };

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const isGroup = (node) => node && typeof node === 'object' && typeof node.op === 'string';

function fail(message, path) {
  throw ApiError.unprocessable(`Invalid segmentation rule${path ? ` at ${path}` : ''}: ${message}`, {
    code: 'INVALID_RULE',
  });
}

function coerceValue(field, value) {
  const type = fieldType(field);
  const cast = (v) => {
    if (type === 'date') {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) fail(`"${v}" is not a valid date`, field);
      return d;
    }
    if (type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) fail(`"${v}" is not a number`, field);
      return n;
    }
    if (type === 'boolean') return v === true || v === 'true';
    return v;
  };
  return Array.isArray(value) ? value.map(cast) : cast(value);
}

function validateNode(node, depth, path, counters) {
  if (depth > MAX_DEPTH) fail(`nesting deeper than ${MAX_DEPTH} levels`, path);
  if (!node || typeof node !== 'object') fail('expected an object', path);

  if (isGroup(node)) {
    const op = node.op.toUpperCase();
    if (!['AND', 'OR', 'NOT'].includes(op)) fail(`unknown group operator "${node.op}"`, path);
    if (!Array.isArray(node.conditions) || node.conditions.length === 0) {
      fail('group requires a non-empty "conditions" array', path);
    }
    if (op === 'NOT' && node.conditions.length !== 1) fail('NOT accepts exactly one condition', path);
    node.conditions.forEach((child, i) => validateNode(child, depth + 1, `${path}.conditions[${i}]`, counters));
    return;
  }

  counters.total += 1;
  if (counters.total > MAX_CONDITIONS) fail(`more than ${MAX_CONDITIONS} conditions`, path);

  const type = node.type;
  switch (type) {
    case 'attribute': {
      if (!isAllowedField(node.field)) fail(`field "${node.field}" is not queryable`, path);
      validateOperator(node.operator, node.value, path);
      break;
    }
    case 'score':
    case 'tier': {
      validateOperator(node.operator, node.value, path);
      break;
    }
    case 'tag': {
      if (!TAG_OPS.has(node.operator)) fail(`tag operator must be one of ${[...TAG_OPS].join(', ')}`, path);
      if (node.value == null) fail('tag condition requires a value', path);
      break;
    }
    case 'event': {
      counters.events += 1;
      if (counters.events > MAX_EVENT_CONDITIONS) fail(`more than ${MAX_EVENT_CONDITIONS} event conditions`, path);
      if (node.event !== 'ANY' && !Object.values(EVENT_TYPES).includes(node.event)) {
        fail(`unknown event type "${node.event}"`, path);
      }
      const agg = node.aggregate || 'count';
      if (!AGGREGATES.has(agg)) fail(`unknown aggregate "${agg}"`, path);
      if (['sum', 'avg', 'max', 'min'].includes(agg) && !AGG_NUMERIC_PROPS.has(node.property || 'value')) {
        fail(`aggregate "${agg}" may only use property value or quantity`, path);
      }
      validateOperator(node.operator, node.value, path);
      break;
    }
    case 'event_not_performed': {
      counters.events += 1;
      if (node.event !== 'ANY' && !Object.values(EVENT_TYPES).includes(node.event)) {
        fail(`unknown event type "${node.event}"`, path);
      }
      break;
    }
    default:
      fail(`unknown condition type "${type}"`, path);
  }
}

function validateOperator(operator, value, path) {
  if (!operator) fail('operator is required', path);
  if (SET_OPS.has(operator)) {
    if (!Array.isArray(value) || value.length === 0) fail(`operator "${operator}" requires a non-empty array`, path);
    if (value.length > 500) fail(`operator "${operator}" accepts at most 500 values`, path);
    return;
  }
  if (RANGE_OPS.has(operator)) {
    if (!Array.isArray(value) || value.length !== 2) fail('operator "between" requires [min, max]', path);
    return;
  }
  if (EXIST_OPS.has(operator)) return;
  if (COMPARISON_OPS.has(operator) || STRING_OPS.has(operator)) {
    if (value === undefined || value === null) fail(`operator "${operator}" requires a value`, path);
    return;
  }
  fail(`unknown operator "${operator}"`, path);
}

function validateRules(rules) {
  const root = isGroup(rules) ? rules : { op: 'AND', conditions: [rules] };
  const counters = { total: 0, events: 0 };
  validateNode(root, 0, '$', counters);
  return { root, counters };
}

/* ------------------------------------------------------------------ */
/* Expression building                                                 */
/* ------------------------------------------------------------------ */

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a $expr fragment comparing a document field against a literal. */
function fieldExpr(field, operator, rawValue) {
  const ref = `$${field}`;
  const type = fieldType(field);
  const value = EXIST_OPS.has(operator) ? rawValue : coerceValue(field, rawValue);
  const fallback = type === 'number' ? 0 : null;
  const lhs = type === 'number' ? { $ifNull: [ref, fallback] } : ref;

  if (COMPARISON_OPS.has(operator)) return { [EXPR_OP[operator]]: [lhs, value] };
  if (operator === 'in') return { $in: [lhs, value] };
  if (operator === 'nin') return { $not: [{ $in: [lhs, value] }] };
  if (operator === 'between') return { $and: [{ $gte: [lhs, value[0]] }, { $lte: [lhs, value[1]] }] };
  if (operator === 'exists') return { $and: [{ $ne: [{ $type: ref }, 'missing'] }, { $ne: [ref, null] }] };
  if (operator === 'notExists') return { $or: [{ $eq: [{ $type: ref }, 'missing'] }, { $eq: [ref, null] }] };

  if (STRING_OPS.has(operator)) {
    const needle = escapeRegex(value);
    const pattern =
      operator === 'startsWith' ? `^${needle}` : operator === 'endsWith' ? `${needle}$` : needle;
    const match = {
      $regexMatch: { input: { $ifNull: [{ $toString: ref }, ''] }, regex: pattern, options: 'i' },
    };
    return operator === 'notContains' ? { $not: [match] } : match;
  }

  return fail(`operator "${operator}" cannot be applied to ${field}`);
}

function tagExpr(operator, value) {
  const values = Array.isArray(value) ? value : [value];
  const tags = { $ifNull: ['$tags', []] };
  const anyMatch = { $gt: [{ $size: { $setIntersection: [tags, values] } }, 0] };
  const allMatch = { $eq: [{ $size: { $setIntersection: [tags, values] } }, values.length] };
  if (operator === 'has' || operator === 'hasAny') return anyMatch;
  if (operator === 'hasAll') return allMatch;
  return { $not: [anyMatch] }; // hasNot
}

/* ------------------------------------------------------------------ */
/* Event condition -> $lookup                                          */
/* ------------------------------------------------------------------ */

function buildEventLookup(node, alias, now) {
  const agg = node.aggregate || 'count';
  const win = resolveWindow(node.window, now);

  const match = [{ $eq: ['$userId', '$$uid'] }];
  if (node.event && node.event !== 'ANY') match.push({ $eq: ['$type', node.event] });
  if (win?.from) match.push({ $gte: ['$occurredAt', win.from] });
  if (win?.to) match.push({ $lte: ['$occurredAt', win.to] });

  // Optional narrowing on normalised commerce dimensions only.
  const filters = node.filters || {};
  for (const key of ['productId', 'category', 'orderId', 'currency', 'name']) {
    if (filters[key] != null) {
      const v = filters[key];
      match.push(Array.isArray(v) ? { $in: ['$' + key, v] } : { $eq: ['$' + key, v] });
    }
  }

  const property = AGG_NUMERIC_PROPS.has(node.property) ? node.property : 'value';
  const groupStage = {
    count: { _id: null, v: { $sum: 1 } },
    sum: { _id: null, v: { $sum: { $ifNull: [`$${property}`, 0] } } },
    avg: { _id: null, v: { $avg: { $ifNull: [`$${property}`, 0] } } },
    max: { _id: null, v: { $max: { $ifNull: [`$${property}`, 0] } } },
    min: { _id: null, v: { $min: { $ifNull: [`$${property}`, 0] } } },
    last_occurred_at: { _id: null, v: { $max: '$occurredAt' } },
    first_occurred_at: { _id: null, v: { $min: '$occurredAt' } },
  }[agg];

  return {
    $lookup: {
      from: 'events',
      let: { uid: '$_id' },
      pipeline: [{ $match: { $expr: { $and: match } } }, { $group: groupStage }, { $project: { _id: 0, v: 1 } }],
      as: alias,
    },
  };
}

function eventValueExpr(alias, agg) {
  const first = { $arrayElemAt: [`$${alias}.v`, 0] };
  const isDateAgg = agg === 'last_occurred_at' || agg === 'first_occurred_at';
  return isDateAgg ? first : { $ifNull: [first, 0] };
}

function eventCompareExpr(node, alias) {
  const agg = node.aggregate || 'count';
  const isDateAgg = agg === 'last_occurred_at' || agg === 'first_occurred_at';
  const lhs = eventValueExpr(alias, agg);

  let value = node.value;
  if (isDateAgg) {
    value = new Date(node.value);
    if (Number.isNaN(value.getTime())) fail(`"${node.value}" is not a valid date`);
  } else if (Array.isArray(value)) {
    value = value.map(Number);
  } else {
    value = Number(value);
  }

  const op = node.operator || 'gte';
  if (COMPARISON_OPS.has(op)) return { [EXPR_OP[op]]: [lhs, value] };
  if (op === 'between') return { $and: [{ $gte: [lhs, value[0]] }, { $lte: [lhs, value[1]] }] };
  if (op === 'exists') return { $ne: [lhs, isDateAgg ? null : 0] };
  if (op === 'notExists') return { $eq: [lhs, isDateAgg ? null : 0] };
  return fail(`operator "${op}" is not valid for an event aggregate`);
}

/* ------------------------------------------------------------------ */
/* Compiler                                                            */
/* ------------------------------------------------------------------ */

function compileNode(node, ctx) {
  if (isGroup(node)) {
    const op = node.op.toUpperCase();
    const children = node.conditions.map((c) => compileNode(c, ctx));
    if (op === 'AND') return { $and: children };
    if (op === 'OR') return { $or: children };
    return { $not: [children[0]] };
  }

  switch (node.type) {
    case 'attribute':
      return fieldExpr(node.field, node.operator, node.value);
    case 'score':
      return fieldExpr('score.value', node.operator, node.value);
    case 'tier':
      return fieldExpr('score.tier', node.operator, node.value);
    case 'tag':
      return tagExpr(node.operator, node.value);
    case 'event': {
      const alias = `_ev${ctx.lookups.length}`;
      ctx.lookups.push(buildEventLookup(node, alias, ctx.now));
      return eventCompareExpr(node, alias);
    }
    case 'event_not_performed': {
      const alias = `_ev${ctx.lookups.length}`;
      ctx.lookups.push(buildEventLookup({ ...node, aggregate: 'count' }, alias, ctx.now));
      return { $eq: [eventValueExpr(alias, 'count'), 0] };
    }
    default:
      return fail(`unknown condition type "${node.type}"`);
  }
}

/**
 * Simple top-level AND conditions are hoisted into a plain $match placed
 * before the $lookup stages. That lets the query planner use the indexes on
 * users and cuts the number of documents each lookup has to touch.
 */
function hoistPrefilter(root) {
  if (!isGroup(root) || root.op.toUpperCase() !== 'AND') return {};
  const match = {};
  for (const node of root.conditions) {
    if (isGroup(node)) continue;
    let field = null;
    if (node.type === 'attribute' && isAllowedField(node.field)) field = node.field;
    else if (node.type === 'score') field = 'score.value';
    else if (node.type === 'tier') field = 'score.tier';
    if (!field || match[field]) continue;

    const op = node.operator;
    if (COMPARISON_OPS.has(op)) {
      const v = coerceValue(field, node.value);
      match[field] = op === 'eq' ? v : { [`$${op}`]: v };
    } else if (SET_OPS.has(op)) {
      match[field] = { [`$${op}`]: coerceValue(field, node.value) };
    } else if (op === 'between') {
      const [a, b] = coerceValue(field, node.value);
      match[field] = { $gte: a, $lte: b };
    }
  }
  return match;
}

/**
 * @returns {Array} aggregation pipeline that yields the matching users
 */
function compile(rules, options = {}) {
  const {
    now = new Date(),
    includeInactive = false,
    extraMatch = {},
    project = null,
  } = options;

  const { root } = validateRules(rules);
  const ctx = { lookups: [], now };
  const expr = compileNode(root, ctx);

  const baseMatch = {
    deletedAt: null,
    ...(includeInactive ? {} : { status: USER_STATUS.ACTIVE }),
    ...hoistPrefilter(root),
    ...extraMatch,
  };

  const pipeline = [{ $match: baseMatch }, ...ctx.lookups, { $match: { $expr: expr } }];

  if (ctx.lookups.length) {
    pipeline.push({ $project: ctx.lookups.reduce((acc, l) => ({ ...acc, [l.$lookup.as]: 0 }), {}) });
  }
  if (project) pipeline.push({ $project: project });

  return pipeline;
}

/** Human-readable rendering of a rule tree, used in the UI and audit logs. */
function describe(rules) {
  const render = (node) => {
    if (isGroup(node)) {
      const op = node.op.toUpperCase();
      if (op === 'NOT') return `NOT (${render(node.conditions[0])})`;
      return `(${node.conditions.map(render).join(` ${op} `)})`;
    }
    switch (node.type) {
      case 'attribute':
        return `${node.field} ${node.operator} ${JSON.stringify(node.value)}`;
      case 'score':
        return `score ${node.operator} ${node.value}`;
      case 'tier':
        return `tier ${node.operator} ${JSON.stringify(node.value)}`;
      case 'tag':
        return `tags ${node.operator} ${JSON.stringify(node.value)}`;
      case 'event': {
        const win = node.window ? ` in last ${Object.entries(node.window).map(([k, v]) => `${v} ${k}`).join(', ')}` : ' all time';
        return `${node.aggregate || 'count'}(${node.event}${node.property ? `.${node.property}` : ''})${win} ${node.operator} ${node.value}`;
      }
      case 'event_not_performed': {
        const win = node.window ? ` in last ${Object.entries(node.window).map(([k, v]) => `${v} ${k}`).join(', ')}` : '';
        return `did NOT perform ${node.event}${win}`;
      }
      default:
        return '?';
    }
  };
  return render(isGroup(rules) ? rules : { op: 'AND', conditions: [rules] });
}

module.exports = { compile, validateRules, describe, MAX_DEPTH, MAX_CONDITIONS };
