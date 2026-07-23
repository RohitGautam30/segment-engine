'use strict';
/* eslint-disable no-console */
// Run during deploy when autoIndex is disabled in production.
const db = require('../src/config/db');
const models = require('../src/models');

(async () => {
  await db.connect();
  for (const [name, model] of Object.entries(models)) {
    await model.syncIndexes();
    console.log(`Indexes synced: ${name}`);
  }
  await db.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
