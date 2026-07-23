'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { z } = require('zod');

const csv = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_NAME: z.string().default('segment-engine'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_MAX_POOL: z.coerce.number().int().positive().default(20),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  INGEST_API_KEYS: z.string().default(''),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  INGEST_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(2000),

  CORS_ORIGINS: z.string().default(''),

  WORKER_ENABLED: z.coerce.boolean().default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().positive().default(500),

  SCORE_RECOMPUTE_CRON_MINUTES: z.coerce.number().int().positive().default(60),
  COHORT_REFRESH_MINUTES: z.coerce.number().int().positive().default(15),

  DEFAULT_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).default('Admin@12345'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

module.exports = Object.freeze({
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  ingestApiKeys: new Set(csv(raw.INGEST_API_KEYS)),
  corsOrigins: csv(raw.CORS_ORIGINS),
});
