'use strict';
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/constants');

/** Role gate. API-key auth is treated as a machine principal and denied here. */
function requireRole(...roles) {
  const allowed = new Set(roles.flat());
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    if (!allowed.has(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }
    return next();
  };
}

const requireAdmin = requireRole(ROLES.ADMIN);
const requireStaff = requireRole(ROLES.ADMIN, ROLES.MANAGER, ROLES.ANALYST);
const requireCampaignOperator = requireRole(ROLES.ADMIN, ROLES.MANAGER);

/** Lets a user act on their own record, or any staff member act on anyone's. */
function requireSelfOrStaff(paramName = 'id') {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized('Authentication required'));
    const isSelf = String(req.user._id) === String(req.params[paramName]);
    const isStaff = [ROLES.ADMIN, ROLES.MANAGER, ROLES.ANALYST].includes(req.user.role);
    if (isSelf || isStaff) return next();
    return next(ApiError.forbidden('You do not have permission to access this resource'));
  };
}

module.exports = { requireRole, requireAdmin, requireStaff, requireCampaignOperator, requireSelfOrStaff };
