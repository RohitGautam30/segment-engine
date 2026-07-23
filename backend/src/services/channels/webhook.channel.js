'use strict';
const logger = require('../../config/logger');

module.exports = {
  name: 'WEBHOOK',
  resolveDestination(user, campaign) {
    const url = campaign?.content?.webhookUrl;
    if (!url) return { destination: null, reason: 'NO_WEBHOOK_URL' };
    return { destination: url };
  },
  async send({ destination, body, meta }) {
    const res = await fetch(destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaignId: meta?.campaignId, userId: meta?.userId, payload: body }),
    }).catch((err) => {
      throw new Error(`Webhook request failed: ${err.message}`);
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
    logger.info({ url: destination, status: res.status }, '[webhook] dispatch');
    return { providerMessageId: `webhook-${res.status}-${Date.now()}` };
  },
};
