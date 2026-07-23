'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.NODE_ENV = 'test';

const { stageFor } = require('../src/services/event.service');
const { LIFECYCLE_STAGES } = require('../src/config/constants');
const ruleEngine = require('../src/services/ruleEngine');

test('a fresh registration sits at SIGNED_UP', () => {
  assert.strictEqual(stageFor({ profile: { completion: 40 }, stats: {} }), 'SIGNED_UP');
});

test('a finished profile advances to PROFILE_COMPLETE', () => {
  assert.strictEqual(stageFor({ profile: { completion: 100 }, stats: {} }), 'PROFILE_COMPLETE');
});

test('a cart add advances to ADDED_TO_CART', () => {
  assert.strictEqual(stageFor({ profile: { completion: 100 }, stats: { cartAdds: 1 } }), 'ADDED_TO_CART');
});

test('a purchase advances to ORDERED', () => {
  assert.strictEqual(
    stageFor({ profile: { completion: 100 }, stats: { cartAdds: 4, purchaseCount: 1 } }),
    'ORDERED'
  );
});

test('ordering outranks an incomplete profile — the funnel records progress, not tidiness', () => {
  assert.strictEqual(stageFor({ profile: { completion: 20 }, stats: { purchaseCount: 2 } }), 'ORDERED');
});

test('a cart add outranks an incomplete profile', () => {
  assert.strictEqual(stageFor({ profile: { completion: 10 }, stats: { cartAdds: 3 } }), 'ADDED_TO_CART');
});

test('the stage list is ordered so index comparison detects forward movement', () => {
  assert.deepStrictEqual(LIFECYCLE_STAGES, ['SIGNED_UP', 'PROFILE_COMPLETE', 'ADDED_TO_CART', 'ORDERED']);
  assert.ok(LIFECYCLE_STAGES.indexOf('ORDERED') > LIFECYCLE_STAGES.indexOf('ADDED_TO_CART'));
});

test('stage is queryable from a cohort rule', () => {
  const pipeline = ruleEngine.compile({
    op: 'AND',
    conditions: [
      { type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'ADDED_TO_CART' },
      { type: 'score', operator: 'gte', value: 200 },
    ],
  });
  assert.strictEqual(pipeline[0].$match['stats.lifecycleStage'], 'ADDED_TO_CART');
  assert.strictEqual(pipeline[0].$match['score.value'].$gte, 200);
});

test('stage combines with a negative event condition', () => {
  const pipeline = ruleEngine.compile({
    op: 'AND',
    conditions: [
      { type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'ADDED_TO_CART' },
      { type: 'event_not_performed', event: 'PURCHASE', window: { days: 7 } },
    ],
  });
  assert.ok(pipeline.some((s) => s.$lookup), 'expected an events lookup for the negative condition');
});
