'use strict';
const logger = require('../../config/logger');

module.exports = {
  name: 'SMS',
  resolveDestination(user) {
    if (!user.profile?.phone) return { destination: null, reason: 'NO_PHONE' };
    if (user.consent?.sms === false) return { destination: null, reason: 'NO_CONSENT' };
    return { destination: user.profile.phone };
  },
  async send({ destination, body, meta }) {
    logger.info({ to: destination, length: body?.length, campaignId: meta?.campaignId }, '[sms] dispatch');
    return { providerMessageId: `mock-sms-${Date.now()}` };
  },
};
