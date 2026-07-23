'use strict';

/**
 * Minimal, dependency-free mustache-style renderer.
 * Only supports {{ path.to.value }} and {{ path | default:Friend }} —
 * deliberately no logic or code execution, so campaign content authored in
 * the dashboard can never become a template-injection vector.
 */
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*default\s*:\s*([^}]*?)\s*)?\}\}/g;

function lookup(context, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    if (acc instanceof Map) return acc.get(key);
    return acc[key];
  }, context);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(template, context, { escape = true } = {}) {
  if (!template) return '';
  return String(template).replace(TOKEN_RE, (_m, path, fallback) => {
    const value = lookup(context, path);
    const resolved = value == null || value === '' ? (fallback ?? '') : value;
    const out = resolved instanceof Date ? resolved.toISOString().slice(0, 10) : String(resolved);
    return escape ? escapeHtml(out) : out;
  });
}

/** Lists the variables a template references — used to validate campaigns. */
function extractVariables(template) {
  const vars = new Set();
  let match;
  const re = new RegExp(TOKEN_RE.source, 'g');
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(String(template || ''))) !== null) vars.add(match[1]);
  return [...vars];
}

/** Context exposed to campaign templates. Nothing sensitive is included. */
function buildContext(user, extra = {}) {
  return {
    user: {
      email: user.email,
      firstName: user.profile?.firstName || '',
      lastName: user.profile?.lastName || '',
      fullName: [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' '),
      city: user.profile?.city || '',
      country: user.profile?.country || '',
      completion: user.profile?.completion ?? 0,
      score: user.score?.value ?? 0,
      tier: user.score?.tier || 'BRONZE',
      purchaseCount: user.stats?.purchaseCount ?? 0,
      totalRevenue: user.stats?.totalRevenue ?? 0,
      lastPurchaseAt: user.stats?.lastPurchaseAt || null,
    },
    ...extra,
  };
}

module.exports = { render, extractVariables, buildContext };
