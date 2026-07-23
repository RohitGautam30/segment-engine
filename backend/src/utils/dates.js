'use strict';
const dayjs = require('dayjs');

const UNITS = ['minutes', 'hours', 'days', 'weeks', 'months'];

/**
 * Resolve a relative or absolute window into { from, to }.
 * Examples:
 *   { days: 30 }                        -> last 30 days
 *   { hours: 6 }                        -> last 6 hours
 *   { from: '2024-01-01', to: '2024-02-01' }
 *   undefined                           -> all time
 */
function resolveWindow(window, now = new Date()) {
  if (!window) return null;
  if (window.from || window.to) {
    return {
      from: window.from ? new Date(window.from) : null,
      to: window.to ? new Date(window.to) : null,
    };
  }
  for (const unit of UNITS) {
    if (window[unit] != null) {
      return { from: dayjs(now).subtract(Number(window[unit]), unit).toDate(), to: null };
    }
  }
  return null;
}

const daysBetween = (a, b) => Math.max(0, dayjs(b).diff(dayjs(a), 'day', true));

module.exports = { resolveWindow, daysBetween, UNITS };
