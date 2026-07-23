'use strict';

/**
 * Allow-list of user fields that segmentation rules may reference.
 * Anything outside this map is rejected, so a rule author can never point
 * the query at internal fields (passwordHash, tokenVersion) or inject
 * arbitrary operators.
 */
const FIELD_REGISTRY = Object.freeze({
  // identity
  email: { type: 'string', label: 'Email' },
  role: { type: 'string', label: 'Role' },
  status: { type: 'string', label: 'Status' },
  source: { type: 'string', label: 'Acquisition source' },
  externalId: { type: 'string', label: 'External ID' },
  tags: { type: 'array', label: 'Tags' },
  createdAt: { type: 'date', label: 'Signed up at' },
  lastLoginAt: { type: 'date', label: 'Last login at' },
  lastContactedAt: { type: 'date', label: 'Last contacted at' },
  emailVerifiedAt: { type: 'date', label: 'Email verified at' },

  // profile
  'profile.firstName': { type: 'string', label: 'First name' },
  'profile.lastName': { type: 'string', label: 'Last name' },
  'profile.phone': { type: 'string', label: 'Phone' },
  'profile.gender': { type: 'string', label: 'Gender' },
  'profile.dateOfBirth': { type: 'date', label: 'Date of birth' },
  'profile.country': { type: 'string', label: 'Country' },
  'profile.city': { type: 'string', label: 'City' },
  'profile.company': { type: 'string', label: 'Company' },
  'profile.completion': { type: 'number', label: 'Profile completion %' },
  'profile.completedAt': { type: 'date', label: 'Profile completed at' },

  // behavioural counters
  'stats.totalEvents': { type: 'number', label: 'Total events' },
  'stats.pageViews': { type: 'number', label: 'Page views' },
  'stats.productViews': { type: 'number', label: 'Product views' },
  'stats.cartAdds': { type: 'number', label: 'Cart adds' },
  'stats.checkouts': { type: 'number', label: 'Checkouts started' },
  'stats.purchaseCount': { type: 'number', label: 'Purchase count' },
  'stats.refundCount': { type: 'number', label: 'Refund count' },
  'stats.totalRevenue': { type: 'number', label: 'Lifetime revenue' },
  'stats.averageOrderValue': { type: 'number', label: 'Average order value' },
  'stats.firstPurchaseAt': { type: 'date', label: 'First purchase at' },
  'stats.lastPurchaseAt': { type: 'date', label: 'Last purchase at' },
  'stats.lastActivityAt': { type: 'date', label: 'Last activity at' },
  'stats.daysSinceLastActivity': { type: 'number', label: 'Days since last activity' },
  'stats.sessionCount': { type: 'number', label: 'Sessions' },
  'stats.topCategory': { type: 'string', label: 'Top category' },
  'stats.lifecycleStage': { type: 'string', label: 'Lifecycle stage' },
  'stats.stageEnteredAt': { type: 'date', label: 'Entered stage at' },

  // score
  'score.value': { type: 'number', label: 'Score' },
  'score.tier': { type: 'string', label: 'Score tier' },
  'score.computedAt': { type: 'date', label: 'Score computed at' },

  // consent
  'consent.email': { type: 'boolean', label: 'Email opt-in' },
  'consent.sms': { type: 'boolean', label: 'SMS opt-in' },
  'consent.push': { type: 'boolean', label: 'Push opt-in' },
  'consent.unsubscribedAt': { type: 'date', label: 'Unsubscribed at' },
});

// Custom traits are open-ended but must match a safe key pattern.
const TRAIT_PREFIX = 'traits.';
const TRAIT_KEY_RE = /^traits\.[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

function isAllowedField(field) {
  if (typeof field !== 'string') return false;
  if (Object.prototype.hasOwnProperty.call(FIELD_REGISTRY, field)) return true;
  return field.startsWith(TRAIT_PREFIX) && TRAIT_KEY_RE.test(field);
}

function fieldType(field) {
  return FIELD_REGISTRY[field]?.type || 'mixed';
}

const listFields = () =>
  Object.entries(FIELD_REGISTRY).map(([field, meta]) => ({ field, ...meta }));

module.exports = { FIELD_REGISTRY, isAllowedField, fieldType, listFields, TRAIT_PREFIX };
