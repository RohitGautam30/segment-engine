'use strict';
const logger = require('../../config/logger');
const env = require('../../config/env');

/**
 * Email provider adapter.
 *
 * The default implementation logs instead of sending, so the system is safe
 * to run end-to-end without credentials. To go live, swap the body of send()
 * for your provider SDK (SES, Brevo, Postmark, SendGrid) and keep the same
 * return shape.
 */
module.exports = {
  name: 'EMAIL',

  /** @returns {{destination: string|null, reason?: string}} */
  resolveDestination(user) {
    if (!user.email) return { destination: null, reason: 'NO_EMAIL' };
    if (user.consent?.email === false) return { destination: null, reason: 'NO_CONSENT' };
    return { destination: user.email };
  },

  async send({ destination, subject, body, fromName, fromEmail, meta }) {
    if (env.isProd && !process.env.EMAIL_PROVIDER_KEY) {
      throw new Error('EMAIL_PROVIDER_KEY is not configured');
    }
    logger.info(
      { to: destination, from: fromEmail ? `${fromName || ''} <${fromEmail}>`.trim() : undefined,
        subject, bodyLength: body?.length, campaignId: meta?.campaignId },
      '[email] dispatch'
    );
    return { providerMessageId: `mock-email-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  },
};
