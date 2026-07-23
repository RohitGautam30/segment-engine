'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const dayjs = require('dayjs');
const env = require('../config/env');
const { RefreshToken } = require('../models');
const ApiError = require('../utils/ApiError');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL, issuer: env.APP_NAME }
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: env.APP_NAME });
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token', { code: 'INVALID_TOKEN' });
  }
}

function parseTtlToDate(ttl) {
  const match = /^(\d+)([smhdw])$/.exec(ttl);
  if (!match) return dayjs().add(30, 'day').toDate();
  const units = { s: 'second', m: 'minute', h: 'hour', d: 'day', w: 'week' };
  return dayjs().add(Number(match[1]), units[match[2]]).toDate();
}

async function issueRefreshToken(user, context = {}) {
  const raw = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(raw),
    userAgent: context.userAgent,
    ip: context.ip,
    expiresAt: parseTtlToDate(env.JWT_REFRESH_TTL),
  });
  return raw;
}

/** Rotating refresh: the presented token is revoked and replaced. */
async function rotateRefreshToken(rawToken, context = {}) {
  const tokenHash = sha256(rawToken);
  const stored = await RefreshToken.findOne({ tokenHash });
  if (!stored) throw ApiError.unauthorized('Invalid refresh token');
  if (stored.revokedAt) {
    // Replay of an already-used token: treat as compromise, kill the family.
    await RefreshToken.updateMany({ userId: stored.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token reuse detected; please sign in again');
  }
  if (stored.expiresAt < new Date()) throw ApiError.unauthorized('Refresh token expired');

  const raw = crypto.randomBytes(48).toString('hex');
  const newHash = sha256(raw);
  await RefreshToken.create({
    userId: stored.userId,
    tokenHash: newHash,
    userAgent: context.userAgent,
    ip: context.ip,
    expiresAt: parseTtlToDate(env.JWT_REFRESH_TTL),
  });
  stored.revokedAt = new Date();
  stored.replacedByHash = newHash;
  await stored.save();

  return { raw, userId: stored.userId };
}

async function revokeRefreshToken(rawToken) {
  await RefreshToken.updateOne({ tokenHash: sha256(rawToken) }, { $set: { revokedAt: new Date() } });
}

const revokeAllForUser = (userId) =>
  RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
