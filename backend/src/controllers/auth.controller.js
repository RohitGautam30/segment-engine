'use strict';
const catchAsync = require('../utils/catchAsync');
const { ok, created } = require('../utils/response');
const authService = require('../services/auth.service');
const userService = require('../services/user.service');
const audit = require('../services/audit.service');

const ctx = (req) => ({ ip: req.ip, userAgent: req.get('user-agent'), source: 'web' });

exports.register = catchAsync(async (req, res) => {
  const session = await authService.register(req.body, ctx(req));
  return created(res, session);
});

exports.login = catchAsync(async (req, res) => {
  const session = await authService.login(req.body, ctx(req));
  return ok(res, session);
});

exports.refresh = catchAsync(async (req, res) => {
  const session = await authService.refresh(req.body.refreshToken, ctx(req));
  return ok(res, session);
});

exports.logout = catchAsync(async (req, res) => {
  const result = await authService.logout(req.body?.refreshToken);
  return ok(res, result);
});

exports.me = catchAsync(async (req, res) => {
  const profile = await userService.getProfile360(req.user._id);
  return ok(res, profile);
});

exports.updateMyProfile = catchAsync(async (req, res) => {
  const result = await userService.updateProfile(req.user._id, req.body, ctx(req));
  audit.record(req, { action: 'user.profile.update', resource: 'User', resourceId: req.user._id });
  return ok(res, result);
});

exports.changePassword = catchAsync(async (req, res) => {
  const result = await authService.changePassword(req.user._id, req.body);
  audit.record(req, { action: 'user.password.change', resource: 'User', resourceId: req.user._id });
  return ok(res, result);
});
