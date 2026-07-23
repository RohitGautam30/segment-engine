'use strict';
const { z } = require('zod');
const { ROLES, USER_STATUS, LIFECYCLE_STAGES } = require('../config/constants');
const { paginationQuery } = require('./common.validator');
const { profileInput, password } = require('./auth.validator');

const consentInput = z.object({
  email: z.boolean().optional(),
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
}).strict();

const adminCreate = z.object({
  email: z.string().email(),
  password: password.optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  externalId: z.string().max(120).optional(),
  source: z.string().max(60).optional(),
  profile: profileInput.optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  consent: consentInput.optional(),
});

const adminUpdate = z.object({
  role: z.enum(Object.values(ROLES)).optional(),
  status: z.enum(Object.values(USER_STATUS)).optional(),
  externalId: z.string().max(120).optional(),
  source: z.string().max(60).optional(),
  profile: profileInput.optional(),
  tags: z.array(z.string().max(40)).max(50).optional(),
  consent: consentInput.optional(),
  traits: z.record(z.any()).optional(),
});

const updateProfile = profileInput;

const listQuery = paginationQuery.extend({
  status: z.enum(Object.values(USER_STATUS)).optional(),
  role: z.enum(Object.values(ROLES)).optional(),
  tier: z.enum(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']).optional(),
  tag: z.string().max(40).optional(),
  category: z.string().max(40).optional(),
  stage: z.enum(LIFECYCLE_STAGES).optional(),
  country: z.string().length(2).optional(),
  minScore: z.coerce.number().optional(),
  maxScore: z.coerce.number().optional(),
  search: z.string().max(80).optional(),
});

module.exports = { adminCreate, adminUpdate, updateProfile, listQuery };
