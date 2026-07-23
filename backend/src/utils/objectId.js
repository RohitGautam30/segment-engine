'use strict';
const { Types } = require('mongoose');
const ApiError = require('./ApiError');

const isValidId = (id) => Types.ObjectId.isValid(String(id));

function toObjectId(id, label = 'id') {
  if (!isValidId(id)) throw ApiError.badRequest(`Invalid ${label}`);
  return new Types.ObjectId(String(id));
}

module.exports = { isValidId, toObjectId };
