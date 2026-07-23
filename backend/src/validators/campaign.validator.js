'use strict';
const { z } = require('zod');
const { CHANNELS, CAMPAIGN_STATUS } = require('../config/constants');
const { paginationQuery, objectId } = require('./common.validator');

const content = z
  .object({
    subject: z.string().max(200).optional(),
    preheader: z.string().max(200).optional(),
    body: z.string().min(1).max(50000),
    ctaUrl: z.string().url().max(500).optional(),
    fromName: z.string().max(80).optional(),
    fromEmail: z.string().email().optional(),
    webhookUrl: z.string().url().max(500).optional(),
  })
  .strict();

const schedule = z
  .object({
    mode: z.enum(['IMMEDIATE', 'SCHEDULED', 'RECURRING']).optional(),
    sendAt: z.coerce.date().optional(),
    intervalMinutes: z.coerce.number().int().min(15).max(525600).optional(),
    endsAt: z.coerce.date().optional(),
    timezone: z.string().max(60).optional(),
  })
  .strict()
  .refine((s) => s.mode !== 'SCHEDULED' || !!s.sendAt, { message: 'SCHEDULED mode requires sendAt' })
  .refine((s) => s.mode !== 'RECURRING' || !!s.intervalMinutes, { message: 'RECURRING mode requires intervalMinutes' });

const throttle = z
  .object({
    maxRecipients: z.coerce.number().int().positive().max(10000000).optional(),
    minScore: z.coerce.number().min(0).optional(),
    respectConsent: z.boolean().optional(),
    frequencyCapDays: z.coerce.number().int().min(0).max(365).optional(),
    quietHours: z
      .object({
        enabled: z.boolean().optional(),
        startHour: z.coerce.number().int().min(0).max(23).optional(),
        endHour: z.coerce.number().int().min(0).max(23).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const create = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(1000).optional(),
    channel: z.enum(Object.values(CHANNELS)),
    cohortIds: z.array(objectId).min(1).max(20),
    excludeCohortIds: z.array(objectId).max(20).optional(),
    content,
    schedule: schedule.optional(),
    throttle: throttle.optional(),
  })
  .refine((c) => c.channel !== 'EMAIL' || !!c.content.subject, { message: 'Email campaigns require a subject' })
  .refine((c) => c.channel !== 'WEBHOOK' || !!c.content.webhookUrl, { message: 'Webhook campaigns require content.webhookUrl' });

const update = z.object({
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(1000).optional(),
  cohortIds: z.array(objectId).min(1).max(20).optional(),
  excludeCohortIds: z.array(objectId).max(20).optional(),
  content: content.optional(),
  schedule: schedule.optional(),
  throttle: throttle.optional(),
});

const launch = z.object({
  isDryRun: z.boolean().optional(),
  refreshCohorts: z.boolean().optional(),
});

const listQuery = paginationQuery.extend({
  status: z.enum(Object.values(CAMPAIGN_STATUS)).optional(),
  channel: z.enum(Object.values(CHANNELS)).optional(),
  search: z.string().max(60).optional(),
});

const quickSend = z.object({
  name: z.string().min(2).max(160),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(50000),
  channel: z.enum(Object.values(CHANNELS)).optional(),
  userIds: z.array(objectId).min(1).max(5000),
  isDryRun: z.boolean().optional(),
  sync: z.boolean().optional(),
  throttle: throttle.optional(),
});

module.exports = { create, update, launch, quickSend, listQuery };
