'use strict';

const MAX_LIMIT = 200;

function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

// Whitelisted sort parsing: "-createdAt,email" -> { createdAt: -1, email: 1 }
function parseSort(sortStr, allowed, fallback = { createdAt: -1 }) {
  if (!sortStr) return fallback;
  const out = {};
  for (const raw of String(sortStr).split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const dir = token.startsWith('-') ? -1 : 1;
    const field = token.replace(/^[-+]/, '');
    if (allowed.includes(field)) out[field] = dir;
  }
  return Object.keys(out).length ? out : fallback;
}

module.exports = { parsePagination, parseSort, MAX_LIMIT };
