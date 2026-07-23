'use strict';
const logger = require('../../config/logger');

module.exports = {
  name: 'PUSH',
  resolveDestination(user) {
    const token = user.traits instanceof Map ? user.traits.get('pushToken') : user.traits?.pushToken;
    if (!token) return { destination: null, reason: 'NO_PUSH_TOKEN' };
    if (user.consent?.push === false) return { destination: null, reason: 'NO_CONSENT' };
    return { destination: token };
  },
  async send({ destination, subject, body, meta }) {
    logger.info({ to: destination, title: subject, bodyLength: body?.length, campaignId: meta?.campaignId }, '[push] dispatch');
    return { providerMessageId: `mock-push-${Date.now()}` };
  },
};
