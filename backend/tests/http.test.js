'use strict';
const test = require('node:test');
const assert = require('node:assert');

process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/never-connected';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.NODE_ENV = 'test';

const request = require('supertest');
const app = require('../src/app');

/* These exercise the middleware chain only — routing, validation, auth gates
   and the error envelope — so they run without a database. */

test('health endpoint responds without a database', async () => {
  const res = await request(app).get('/api/v1/system/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
});

test('api index lists the mounted resources', async () => {
  const res = await request(app).get('/api/v1');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.endpoints.includes('/campaigns'));
});

test('unknown routes return a structured 404', async () => {
  const res = await request(app).get('/api/v1/nope');
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.success, false);
  assert.strictEqual(res.body.error.code, 'NOT_FOUND');
  assert.ok(res.body.requestId);
});

test('every response carries a request id header', async () => {
  const res = await request(app).get('/api/v1/system/health');
  assert.ok(res.headers['x-request-id']);
});

test('validation rejects a malformed login before touching the database', async () => {
  const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
  assert.strictEqual(res.status, 422);
  assert.strictEqual(res.body.error.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.details.some((d) => d.path === 'email'));
});

test('protected routes reject a missing token', async () => {
  const res = await request(app).get('/api/v1/users');
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
});

test('protected routes reject a forged token', async () => {
  const res = await request(app).get('/api/v1/users').set('Authorization', 'Bearer not.a.real.token');
  assert.strictEqual(res.status, 401);
});

test('quick-send route is mounted and gated by auth', async () => {
  const res = await request(app).post('/api/v1/campaigns/quick-send').send({ name: 'x' });
  assert.strictEqual(res.status, 401, 'should demand auth, not 404');
});

test('event ingestion rejects an unknown api key', async () => {
  const res = await request(app)
    .post('/api/v1/events/track')
    .set('x-api-key', 'wrong-key')
    .send({ type: 'PAGE_VIEW', userId: '507f1f77bcf86cd799439011' });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.error.code, 'INVALID_API_KEY');
});

test('malformed json produces a clean 400', async () => {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('Content-Type', 'application/json')
    .send('{"email":');
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.error.code, 'MALFORMED_JSON');
});
