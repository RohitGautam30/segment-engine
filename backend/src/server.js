'use strict';
const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const db = require('./config/db');
const { startScheduler } = require('./jobs/scheduler');

let server;
let scheduler;

async function start() {
  await db.connect();

  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `${env.APP_NAME} API listening`);
  });

  // In a single-process deployment the API also drives the scheduler.
  // Run `npm run start:worker` separately to scale sending horizontally.
  if (env.WORKER_ENABLED) scheduler = startScheduler();
}

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  const timeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000).unref();

  try {
    if (scheduler) scheduler.stop();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.disconnect();
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled rejection');
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  shutdown('uncaughtException');
});

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
