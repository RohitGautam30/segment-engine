'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.NODE_ENV = 'test';

const ruleEngine = require('../src/services/ruleEngine');

test('compiles a simple score condition into a hoisted $match', () => {
  const pipeline = ruleEngine.compile({ op: 'AND', conditions: [{ type: 'score', operator: 'gte', value: 500 }] });
  assert.strictEqual(pipeline[0].$match['score.value'].$gte, 500);
  assert.strictEqual(pipeline[0].$match.status, 'ACTIVE');
});

test('rejects fields that are not on the allow-list', () => {
  assert.throws(
    () => ruleEngine.compile({ type: 'attribute', field: 'passwordHash', operator: 'eq', value: 'x' }),
    /not queryable/
  );
});

test('rejects an unknown operator', () => {
  assert.throws(
    () => ruleEngine.compile({ type: 'attribute', field: 'email', operator: '$where', value: 'x' }),
    /Invalid segmentation rule/
  );
});

test('event conditions produce a $lookup against events', () => {
  const pipeline = ruleEngine.compile({
    type: 'event',
    event: 'PURCHASE',
    aggregate: 'count',
    operator: 'gte',
    value: 2,
    window: { days: 30 },
  });
  const lookup = pipeline.find((s) => s.$lookup);
  assert.ok(lookup, 'expected a $lookup stage');
  assert.strictEqual(lookup.$lookup.from, 'events');
  assert.ok(JSON.stringify(lookup.$lookup.pipeline).includes('PURCHASE'));
});

test('event_not_performed compiles to a zero-count check', () => {
  const pipeline = ruleEngine.compile({ type: 'event_not_performed', event: 'PURCHASE', window: { days: 7 } });
  const matchExpr = pipeline.find((s) => s.$match && s.$match.$expr);
  assert.ok(JSON.stringify(matchExpr).includes('$eq'));
});

test('nested AND/OR trees compile to nested boolean expressions', () => {
  const pipeline = ruleEngine.compile({
    op: 'AND',
    conditions: [
      { type: 'score', operator: 'gte', value: 100 },
      {
        op: 'OR',
        conditions: [
          { type: 'attribute', field: 'profile.country', operator: 'in', value: ['IN', 'US'] },
          { type: 'tag', operator: 'has', value: 'vip' },
        ],
      },
    ],
  });
  const expr = pipeline.find((s) => s.$match && s.$match.$expr).$match.$expr;
  assert.ok(expr.$and, 'top level should be $and');
  assert.ok(JSON.stringify(expr).includes('$or'));
});

test('enforces a maximum nesting depth', () => {
  let node = { type: 'score', operator: 'gte', value: 1 };
  for (let i = 0; i < 10; i += 1) node = { op: 'AND', conditions: [node] };
  assert.throws(() => ruleEngine.compile(node), /nesting deeper/);
});

test('escapes regex metacharacters in contains', () => {
  const pipeline = ruleEngine.compile({ type: 'attribute', field: 'email', operator: 'contains', value: '.*(' });
  const json = JSON.stringify(pipeline);
  assert.ok(json.includes('\\\\.\\\\*\\\\('), 'metacharacters should be escaped');
});

test('coerces date strings for date-typed fields', () => {
  const pipeline = ruleEngine.compile({ type: 'attribute', field: 'createdAt', operator: 'gte', value: '2024-01-01T00:00:00.000Z' });
  assert.ok(pipeline[0].$match.createdAt.$gte instanceof Date);
});

test('describe() renders a readable summary', () => {
  const text = ruleEngine.describe({
    op: 'AND',
    conditions: [
      { type: 'score', operator: 'gte', value: 400 },
      { type: 'event', event: 'PURCHASE', aggregate: 'count', operator: 'gte', value: 2, window: { days: 90 } },
    ],
  });
  assert.match(text, /score gte 400/);
  assert.match(text, /PURCHASE/);
});
