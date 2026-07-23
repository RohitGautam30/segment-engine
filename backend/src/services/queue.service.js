'use strict';
const os = require('os');
const { Job } = require('../models');
const { JOB_STATUS } = require('../config/constants');
const logger = require('../config/logger');

const WORKER_ID = `${os.hostname()}-${process.pid}`;
const STALE_LOCK_MS = 5 * 60 * 1000;

/** Enqueue a job. `dedupeKey` prevents piling up duplicates of the same work. */
async function enqueue(type, payload = {}, { runAt = new Date(), priority = 0, dedupeKey = null, maxAttempts = 5 } = {}) {
  try {
    return await Job.create({ type, payload, runAt, priority, dedupeKey, maxAttempts });
  } catch (err) {
    if (err.code === 11000) {
      logger.debug({ type, dedupeKey }, 'Job deduplicated');
      return null;
    }
    throw err;
  }
}

/**
 * Atomically claim the next runnable job. The findOneAndUpdate is the whole
 * concurrency story: two workers can never claim the same document.
 */
async function claim(types) {
  const filter = {
    status: JOB_STATUS.PENDING,
    runAt: { $lte: new Date() },
    ...(types?.length ? { type: { $in: types } } : {}),
  };
  return Job.findOneAndUpdate(
    filter,
    { $set: { status: JOB_STATUS.ACTIVE, lockedBy: WORKER_ID, lockedAt: new Date(), heartbeatAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { priority: -1, runAt: 1 }, new: true }
  );
}

const heartbeat = (jobId) => Job.updateOne({ _id: jobId }, { $set: { heartbeatAt: new Date() } });

const complete = (jobId) =>
  Job.updateOne(
    { _id: jobId },
    { $set: { status: JOB_STATUS.COMPLETED, finishedAt: new Date(), lockedBy: null, dedupeKey: null } }
  );

/** Exponential backoff with a cap; exhausted jobs land in DEAD for inspection. */
async function fail(job, error) {
  const attempts = job.attempts || 1;
  if (attempts >= (job.maxAttempts || 5)) {
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: JOB_STATUS.DEAD, lastError: error.message, finishedAt: new Date(), lockedBy: null, dedupeKey: null } }
    );
    logger.error({ jobId: String(job._id), type: job.type, err: error }, 'Job moved to dead letter');
    return;
  }
  const delayMs = Math.min(60 * 60 * 1000, 1000 * 2 ** attempts);
  await Job.updateOne(
    { _id: job._id },
    { $set: { status: JOB_STATUS.PENDING, lastError: error.message, runAt: new Date(Date.now() + delayMs), lockedBy: null, lockedAt: null } }
  );
  logger.warn({ jobId: String(job._id), attempts, retryInMs: delayMs }, 'Job retry scheduled');
}

/** Recovers jobs whose worker died mid-flight. */
async function reclaimStale() {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS);
  const res = await Job.updateMany(
    { status: JOB_STATUS.ACTIVE, heartbeatAt: { $lt: cutoff } },
    { $set: { status: JOB_STATUS.PENDING, lockedBy: null, lockedAt: null } }
  );
  if (res.modifiedCount) logger.warn({ count: res.modifiedCount }, 'Reclaimed stale jobs');
  return res.modifiedCount;
}

const stats = async () => {
  const rows = await Job.aggregate([{ $group: { _id: { status: '$status', type: '$type' }, count: { $sum: 1 } } }]);
  return rows.map((r) => ({ status: r._id.status, type: r._id.type, count: r.count }));
};

module.exports = { enqueue, claim, complete, fail, heartbeat, reclaimStale, stats, WORKER_ID };
