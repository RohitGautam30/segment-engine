'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.NODE_ENV = 'test';

const scoring = require('../src/services/scoring.service');

test('tiers map correctly to thresholds', () => {
  assert.strictEqual(scoring.tierFor(0), 'BRONZE');
  assert.strictEqual(scoring.tierFor(249), 'BRONZE');
  assert.strictEqual(scoring.tierFor(250), 'SILVER');
  assert.strictEqual(scoring.tierFor(500), 'GOLD');
  assert.strictEqual(scoring.tierFor(999), 'PLATINUM');
});

test('decay halves the weight at exactly one half-life', () => {
  assert.ok(Math.abs(scoring.decayFactor(45, 45) - 0.5) < 1e-9);
  assert.ok(Math.abs(scoring.decayFactor(90, 45) - 0.25) < 1e-9);
  assert.strictEqual(scoring.decayFactor(0, 45), 1);
});

test('purchase points combine engagement and monetary value', () => {
  const rule = {
    eventPoints: new Map([['PURCHASE', 40]]),
    monetary: { enabled: true, pointsPerCurrencyUnit: 0.02, cap: 300 },
  };
  const result = scoring.pointsForEvent({ type: 'PURCHASE', value: 5000 }, rule);
  assert.strictEqual(result.engagement, 40);
  assert.strictEqual(result.monetary, 100);
  assert.strictEqual(result.total, 140);
});

test('refunds subtract monetary value', () => {
  const rule = {
    eventPoints: new Map([['REFUND', -25]]),
    monetary: { enabled: true, pointsPerCurrencyUnit: 0.02, cap: 300 },
  };
  const result = scoring.pointsForEvent({ type: 'REFUND', value: 1000 }, rule);
  assert.strictEqual(result.total, -45);
});

test('simulate clamps to the configured maximum', () => {
  const rule = {
    eventPoints: new Map([['PURCHASE', 40]]),
    monetary: { enabled: true, pointsPerCurrencyUnit: 0.02, cap: 300 },
    maxScore: 1000,
    minScore: 0,
  };
  const events = Array.from({ length: 100 }, () => ({ type: 'PURCHASE', value: 10000 }));
  assert.strictEqual(scoring.simulate(events, rule).score, 1000);
});
