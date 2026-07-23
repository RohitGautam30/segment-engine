'use strict';
const env = require('../config/env');
const logger = require('../config/logger');
const db = require('../config/db');
const queue = require('../services/queue.service');
const handlers = require('../jobs/handlers');

let running = true;
let inFlight = 0;

async function runJob(job) {
  const handler = handlers[job.type];
  const heartbeat = setInterval(() => queue.heartbeat(job._id).catch(() => {}), 30_000).unref();

  try {
    if (!handler) throw new Error(`No handler registered for job type ${job.type}`);
    const result = await handler(job);
    await queue.complete(job._id);
    logger.info({ jobId: String(job._id), type: job.type, result }, 'Job completed');
  } catch (err) {
    await queue.fail(job, err);
  } finally {
    clearInterval(heartbeat);
    inFlight -= 1;
  }
}

async function loop() {
  while (running) {
    if (inFlight >= env.WORKER_CONCURRENCY) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const job = await queue.claim().catch((err) => {
      logger.error({ err }, 'Failed to claim job');
      return null;
    });

    if (!job) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, env.WORKER_POLL_MS));
      continue;
    }
    inFlight += 1;
    runJob(job); // intentionally not awaited: concurrency is capped above
  }
}

async function start() {
  await db.connect();
  await queue.reclaimStale();
  logger.info({ workerId: queue.WORKER_ID, concurrency: env.WORKER_CONCURRENCY }, 'Worker started');
  loop();
}

async function shutdown(signal) {
  logger.info({ signal }, 'Worker shutting down');
  running = false;
  const deadline = Date.now() + 20_000;
  while (inFlight > 0 && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 250));
  }
  await db.disconnect();
  process.exit(0);
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

start().catch((err) => {
  logger.fatal({ err }, 'Worker failed to start');
  process.exit(1);
});
