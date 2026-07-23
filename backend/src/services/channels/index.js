'use strict';
const { CHANNELS } = require('../../config/constants');
const email = require('./email.channel');
const sms = require('./sms.channel');
const push = require('./push.channel');
const webhook = require('./webhook.channel');

const registry = {
  [CHANNELS.EMAIL]: email,
  [CHANNELS.SMS]: sms,
  [CHANNELS.PUSH]: push,
  [CHANNELS.WEBHOOK]: webhook,
};

function getChannel(name) {
  const channel = registry[name];
  if (!channel) throw new Error(`Unsupported channel: ${name}`);
  return channel;
}

module.exports = { getChannel, registry };
