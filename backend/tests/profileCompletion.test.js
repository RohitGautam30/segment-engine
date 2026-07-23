'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/test';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.NODE_ENV = 'test';

const userService = require('../src/services/user.service');

test('empty profile scores zero', () => {
  assert.strictEqual(userService.calculateCompletion({}), 0);
});

test('a fully populated profile reaches 100', () => {
  const profile = {
    firstName: 'A', lastName: 'B', phone: '+911', dateOfBirth: new Date(),
    gender: 'FEMALE', country: 'IN', city: 'Delhi', avatarUrl: 'http://x/y.png', company: 'Acme',
  };
  assert.strictEqual(userService.calculateCompletion(profile), 100);
});

test('UNDISCLOSED gender does not count toward completion', () => {
  const withUndisclosed = userService.calculateCompletion({ firstName: 'A', gender: 'UNDISCLOSED' });
  const withStated = userService.calculateCompletion({ firstName: 'A', gender: 'MALE' });
  assert.ok(withStated > withUndisclosed);
});

test('missingProfileFields reports what is left', () => {
  const missing = userService.missingProfileFields({ firstName: 'A' });
  assert.ok(missing.includes('phone'));
  assert.ok(!missing.includes('firstName'));
});
