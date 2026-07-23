'use strict';
const ApiError = require('../utils/ApiError');

/**
 * validate({ body, query, params }) with zod schemas.
 * Parsed (and coerced) values replace the originals, so controllers
 * only ever see validated data.
 */
module.exports = function validate(schemas = {}) {
  return (req, _res, next) => {
    const issues = [];
    for (const key of ['body', 'query', 'params']) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({ location: key, path: issue.path.join('.'), message: issue.message });
        }
      } else if (key === 'query') {
        // req.query is a getter in Express 5 / read-only in some setups
        Object.defineProperty(req, 'validatedQuery', { value: result.data, writable: true, configurable: true });
        req.query = result.data;
      } else {
        req[key] = result.data;
      }
    }
    if (issues.length) {
      return next(ApiError.unprocessable('Validation failed', { code: 'VALIDATION_ERROR', details: issues }));
    }
    return next();
  };
};
