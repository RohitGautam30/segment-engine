'use strict';
const { z } = require('zod');

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a digit');

const profileInput = z
  .object({
    firstName: z.string().max(80).optional(),
    lastName: z.string().max(80).optional(),
    phone: z.string().max(24).optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED']).optional(),
    dateOfBirth: z.coerce.date().optional(),
    country: z.string().length(2).optional(),
    city: z.string().max(80).optional(),
    avatarUrl: z.string().url().max(500).optional(),
    company: z.string().max(120).optional(),
  })
  .strict();

const register = z.object({
  email: z.string().email(),
  password,
  externalId: z.string().max(120).optional(),
  source: z.string().max(60).optional(),
  profile: profileInput.optional(),
});

const login = z.object({ email: z.string().email(), password: z.string().min(1) });
const refresh = z.object({ refreshToken: z.string().min(20) });
const changePassword = z.object({ currentPassword: z.string().optional(), newPassword: password });

module.exports = { register, login, refresh, changePassword, profileInput, password };
