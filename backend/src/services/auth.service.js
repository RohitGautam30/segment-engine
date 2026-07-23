'use strict';
const { User } = require('../models');
const ApiError = require('../utils/ApiError');
const tokenService = require('./token.service');
const eventService = require('./event.service');
const userService = require('./user.service');
const { USER_STATUS, EVENT_TYPES } = require('../config/constants');

async function issueSession(user, context) {
  const accessToken = tokenService.signAccessToken(user);
  const refreshToken = await tokenService.issueRefreshToken(user, context);
  return { accessToken, refreshToken, user: user.toJSON ? user.toJSON() : user };
}

async function register(payload, context = {}) {
  const user = await userService.signup(payload, context);
  return issueSession(user, context);
}

async function login({ email, password }, context = {}) {
  const user = await User.findOne({ email: String(email).toLowerCase(), deletedAt: null }).select('+passwordHash +tokenVersion');
  // Constant-ish response regardless of which half failed.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }
  if (user.status !== USER_STATUS.ACTIVE) throw ApiError.forbidden(`Account is ${user.status}`);

  user.lastLoginAt = new Date();
  await user.save();
  await eventService.track({ userId: user._id, type: EVENT_TYPES.LOGIN }, context).catch(() => {});

  return issueSession(user, context);
}

async function refresh(rawToken, context = {}) {
  const { raw, userId } = await tokenService.rotateRefreshToken(rawToken, context);
  const user = await User.findById(userId).select('+tokenVersion');
  if (!user || user.status !== USER_STATUS.ACTIVE) throw ApiError.unauthorized('Account unavailable');
  return { accessToken: tokenService.signAccessToken(user), refreshToken: raw, user: user.toJSON() };
}

async function logout(rawToken) {
  if (rawToken) await tokenService.revokeRefreshToken(rawToken);
  return { loggedOut: true };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+passwordHash +tokenVersion');
  if (!user) throw ApiError.notFound('User not found');
  if (user.passwordHash && !(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }
  user.setPassword(newPassword);
  if (user.status === USER_STATUS.INVITED) user.status = USER_STATUS.ACTIVE;
  await user.save();
  await tokenService.revokeAllForUser(user._id);
  return { updated: true };
}

module.exports = { register, login, refresh, logout, changePassword };
