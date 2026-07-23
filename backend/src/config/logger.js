'use strict';
const pino = require('pino');
const env = require('./env');

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.refreshToken',
  'password',
  'passwordHash',
];

const logger = pino({
  name: env.APP_NAME,
  level: env.isTest ? 'silent' : env.isProd ? 'info' : 'debug',
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: env.isProd ? undefined : { target: 'pino/file', options: { destination: 1 } },
});

module.exports = logger;
