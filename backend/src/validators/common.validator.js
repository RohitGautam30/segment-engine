'use strict';
const { z } = require('zod');
const { isValidId } = require('../utils/objectId');

const objectId = z.string().refine(isValidId, { message: 'Invalid id' });

const paginationQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  sort: z.string().max(120).optional(),
});

const idParam = z.object({ id: objectId });

const window = z
  .object({
    minutes: z.coerce.number().int().positive().optional(),
    hours: z.coerce.number().int().positive().optional(),
    days: z.coerce.number().int().positive().optional(),
    weeks: z.coerce.number().int().positive().optional(),
    months: z.coerce.number().int().positive().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict()
  .optional();

module.exports = { objectId, paginationQuery, idParam, window };
