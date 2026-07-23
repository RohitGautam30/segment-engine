'use strict';
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

mongoose.set('strictQuery', true);


let connecting = null;

async function connect(uri = env.MONGO_URI) {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return connecting;

  connecting = mongoose
    .connect(uri, {
      maxPoolSize: env.MONGO_MAX_POOL,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      autoIndex: !env.isProd, // in prod run scripts/sync-indexes.js during deploy
    })
    .then((m) => {
      logger.info({ db: m.connection.name }, 'MongoDB connected');
      return m.connection;
    })
    .catch((err) => {
      connecting = null;
      throw err;
    });

  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  return connecting;
}

async function disconnect() {
  connecting = null;
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close(false);
    logger.info('MongoDB connection closed');
  }
}

const isHealthy = () => mongoose.connection.readyState === 1;

module.exports = { connect, disconnect, isHealthy, mongoose };
