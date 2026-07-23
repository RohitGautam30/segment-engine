'use strict';

const ROLES = Object.freeze({ ADMIN: 'ADMIN', MANAGER: 'MANAGER', ANALYST: 'ANALYST', USER: 'USER' });

const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
  DELETED: 'DELETED',
});

const EVENT_TYPES = Object.freeze({
  SIGNUP: 'SIGNUP',
  LOGIN: 'LOGIN',
  PROFILE_COMPLETED: 'PROFILE_COMPLETED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  PAGE_VIEW: 'PAGE_VIEW',
  PRODUCT_VIEW: 'PRODUCT_VIEW',
  ADD_TO_CART: 'ADD_TO_CART',
  REMOVE_FROM_CART: 'REMOVE_FROM_CART',
  CHECKOUT_STARTED: 'CHECKOUT_STARTED',
  PURCHASE: 'PURCHASE',
  REFUND: 'REFUND',
  SUPPORT_TICKET: 'SUPPORT_TICKET',
  EMAIL_OPENED: 'EMAIL_OPENED',
  EMAIL_CLICKED: 'EMAIL_CLICKED',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  CUSTOM: 'CUSTOM',
});

const SCORE_TIERS = Object.freeze([
  { name: 'PLATINUM', min: 750 },
  { name: 'GOLD', min: 500 },
  { name: 'SILVER', min: 250 },
  { name: 'BRONZE', min: 0 },
]);

/**
 * Customer lifecycle stages, in order. A user sits at the furthest stage they
 * have reached, so the funnel is monotonic: ordering once keeps you at ORDERED
 * even if you later let your profile lapse.
 */
const LIFECYCLE_STAGES = Object.freeze(['SIGNED_UP', 'PROFILE_COMPLETE', 'ADDED_TO_CART', 'ORDERED']);

const STAGE_LABELS = Object.freeze({
  SIGNED_UP: 'Signed up',
  PROFILE_COMPLETE: 'Profile complete',
  ADDED_TO_CART: 'Added to cart',
  ORDERED: 'Ordered',
});

const COHORT_TYPE = Object.freeze({ DYNAMIC: 'DYNAMIC', STATIC: 'STATIC' });

const CAMPAIGN_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

const RUN_STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  BUILDING_AUDIENCE: 'BUILDING_AUDIENCE',
  SENDING: 'SENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const DELIVERY_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  BOUNCED: 'BOUNCED',
});

const CHANNELS = Object.freeze({ EMAIL: 'EMAIL', SMS: 'SMS', PUSH: 'PUSH', WEBHOOK: 'WEBHOOK' });

const JOB_TYPES = Object.freeze({
  CAMPAIGN_RUN: 'CAMPAIGN_RUN',
  CAMPAIGN_BATCH: 'CAMPAIGN_BATCH',
  COHORT_REFRESH: 'COHORT_REFRESH',
  SCORE_RECOMPUTE: 'SCORE_RECOMPUTE',
});

const JOB_STATUS = Object.freeze({
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DEAD: 'DEAD',
});

module.exports = {
  ROLES,
  USER_STATUS,
  EVENT_TYPES,
  SCORE_TIERS,
  COHORT_TYPE,
  LIFECYCLE_STAGES,
  STAGE_LABELS,
  CAMPAIGN_STATUS,
  RUN_STATUS,
  DELIVERY_STATUS,
  CHANNELS,
  JOB_TYPES,
  JOB_STATUS,
};
