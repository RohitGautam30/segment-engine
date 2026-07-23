'use strict';
/* eslint-disable no-console */
const db = require('../src/config/db');
const env = require('../src/config/env');
const { User, Event, Cohort, Campaign, ScoringRule, CohortMembership, Delivery, CampaignRun, Job } = require('../src/models');
const { ROLES, USER_STATUS, EVENT_TYPES, CHANNELS } = require('../src/config/constants');
const eventService = require('../src/services/event.service');
const cohortService = require('../src/services/cohort.service');
const scoringService = require('../src/services/scoring.service');

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const daysAgo = (d) => new Date(Date.now() - d * 86400000);

const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sana', 'Vihaan', 'Ananya', 'Arjun', 'Ishita'];
const LAST = ['Sharma', 'Iyer', 'Khan', 'Nair', 'Patel', 'Reddy', 'Bose', 'Menon'];
const CITIES = ['Delhi', 'Mumbai', 'Bengaluru', 'Pune', 'Chennai'];
const CATEGORIES = ['helmets', 'tyres', 'brakes', 'apparel', 'oils'];

async function reset() {
  await Promise.all([
    User.deleteMany({}), Event.deleteMany({}), Cohort.deleteMany({}), Campaign.deleteMany({}),
    CohortMembership.deleteMany({}), Delivery.deleteMany({}), CampaignRun.deleteMany({}),
    Job.deleteMany({}), ScoringRule.deleteMany({}),
  ]);
  console.log('Cleared existing data');
}

async function seedStaff() {
  const admin = new User({
    email: env.DEFAULT_ADMIN_EMAIL,
    passwordHash: env.DEFAULT_ADMIN_PASSWORD,
    role: ROLES.ADMIN,
    status: USER_STATUS.ACTIVE,
    profile: { firstName: 'Platform', lastName: 'Admin', country: 'IN', city: 'Delhi', phone: '+919000000000', completion: 100 },
  });
  await admin.save();

  const manager = new User({
    email: 'manager@example.com',
    passwordHash: 'Manager@12345',
    role: ROLES.MANAGER,
    status: USER_STATUS.ACTIVE,
    profile: { firstName: 'Campaign', lastName: 'Manager', country: 'IN', completion: 60 },
  });
  await manager.save();

  console.log(`Staff created: ${admin.email} / ${env.DEFAULT_ADMIN_PASSWORD}, ${manager.email} / Manager@12345`);
  return { admin, manager };
}

async function seedCustomers(count = 120) {
  const users = [];
  for (let i = 0; i < count; i += 1) {
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const complete = Math.random() > 0.4;
    const user = new User({
      email: `customer${i}@example.com`,
      passwordHash: 'Customer@123',
      role: ROLES.USER,
      status: USER_STATUS.ACTIVE,
      source: pick(['organic', 'google-ads', 'referral', 'instagram']),
      externalId: `ext-${1000 + i}`,
      profile: {
        firstName,
        lastName,
        phone: complete ? `+9198${String(10000000 + i).slice(0, 8)}` : undefined,
        gender: pick(['MALE', 'FEMALE', 'OTHER']),
        dateOfBirth: daysAgo(rand(15000) + 6500),
        country: 'IN',
        city: pick(CITIES),
        avatarUrl: complete ? `https://cdn.example.com/a/${i}.png` : undefined,
        company: complete ? 'Acme' : undefined,
      },
      consent: { email: Math.random() > 0.1, sms: Math.random() > 0.5 },
      tags: Math.random() > 0.7 ? ['newsletter'] : [],
      createdAt: daysAgo(rand(180)),
    });
    const userService = require('../src/services/user.service');
    user.profile.completion = userService.calculateCompletion(user.profile.toObject());
    if (user.profile.completion >= 100) user.profile.completedAt = daysAgo(rand(90));
    users.push(user);
  }
  await User.insertMany(users);
  console.log(`Created ${users.length} customers`);
  return users;
}

async function seedActivity(users) {
  let total = 0;
  for (const user of users) {
    const intensity = rand(4); // 0 = dormant, 3 = power user
    const eventPlan = [{ type: EVENT_TYPES.SIGNUP, at: user.createdAt }];

    if (user.profile.completion >= 100) eventPlan.push({ type: EVENT_TYPES.PROFILE_COMPLETED, at: daysAgo(rand(120)) });

    for (let i = 0; i < intensity * 6; i += 1) {
      eventPlan.push({ type: EVENT_TYPES.PAGE_VIEW, at: daysAgo(rand(90)) });
    }
    for (let i = 0; i < intensity * 3; i += 1) {
      eventPlan.push({ type: EVENT_TYPES.PRODUCT_VIEW, at: daysAgo(rand(60)), category: pick(CATEGORIES), productId: `SKU-${rand(500)}` });
    }
    for (let i = 0; i < intensity * 2; i += 1) {
      eventPlan.push({ type: EVENT_TYPES.ADD_TO_CART, at: daysAgo(rand(45)), value: 500 + rand(4000), category: pick(CATEGORIES), productId: `SKU-${rand(500)}` });
    }
    if (intensity >= 2) {
      const orders = rand(4);
      for (let i = 0; i < orders; i += 1) {
        eventPlan.push({ type: EVENT_TYPES.CHECKOUT_STARTED, at: daysAgo(rand(40)) });
        eventPlan.push({ type: EVENT_TYPES.PURCHASE, at: daysAgo(rand(40)), value: 1500 + rand(12000), orderId: `ORD-${rand(99999)}`, category: pick(CATEGORIES) });
      }
    }

    eventPlan.sort((a, b) => a.at - b.at);
    for (const e of eventPlan) {
      // eslint-disable-next-line no-await-in-loop
      await eventService.track({
        userId: user._id,
        type: e.type,
        value: e.value,
        category: e.category,
        productId: e.productId,
        orderId: e.orderId,
        occurredAt: e.at,
        source: 'seed',
      });
      total += 1;
    }
  }
  console.log(`Tracked ${total} events`);
}

async function seedCohorts(actorId) {
  const definitions = [
    // One cohort per lifecycle stage, so each step of the funnel is directly
    // targetable. These are the stages named in the spec.
    {
      name: 'Stage 1 — Signed up only',
      description: 'Registered but has not completed a profile, added to cart or ordered',
      rules: { op: 'AND', conditions: [{ type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'SIGNED_UP' }] },
    },
    {
      name: 'Stage 2 — Profile complete, no cart',
      description: 'Finished their profile but has never added anything to a cart',
      rules: { op: 'AND', conditions: [{ type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'PROFILE_COMPLETE' }] },
    },
    {
      name: 'Stage 3 — Added to cart, never ordered',
      description: 'Reached a cart but has not converted',
      rules: { op: 'AND', conditions: [{ type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'ADDED_TO_CART' }] },
    },
    {
      name: 'Stage 4 — Customers',
      description: 'Has placed at least one order',
      rules: { op: 'AND', conditions: [{ type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'ORDERED' }] },
    },
    // Cohorts that combine stage with score, which is where segmentation earns
    // its keep: same funnel position, very different intent.
    {
      name: 'High-intent cart abandoners',
      description: 'Sitting at the cart stage with a score of 200+',
      rules: {
        op: 'AND',
        conditions: [
          { type: 'attribute', field: 'stats.lifecycleStage', operator: 'eq', value: 'ADDED_TO_CART' },
          { type: 'score', operator: 'gte', value: 200 },
        ],
      },
    },
    {
      name: 'High Value Buyers',
      description: 'Score 400+ with at least 2 purchases in the last 90 days',
      rules: {
        op: 'AND',
        conditions: [
          { type: 'score', operator: 'gte', value: 400 },
          { type: 'event', event: 'PURCHASE', aggregate: 'count', operator: 'gte', value: 2, window: { days: 90 } },
        ],
      },
    },
    {
      name: 'Abandoned Cart (7 days)',
      description: 'Added to cart in the last 7 days but did not purchase',
      rules: {
        op: 'AND',
        conditions: [
          { type: 'event', event: 'ADD_TO_CART', aggregate: 'count', operator: 'gte', value: 1, window: { days: 7 } },
          { type: 'event_not_performed', event: 'PURCHASE', window: { days: 7 } },
        ],
      },
    },
    {
      name: 'Incomplete Profiles',
      description: 'Signed up but profile is under 60% complete',
      rules: {
        op: 'AND',
        conditions: [{ type: 'attribute', field: 'profile.completion', operator: 'lt', value: 60 }],
      },
    },
    {
      name: 'Dormant High Scorers',
      description: 'Score 300+ but no activity in 30 days — win-back target',
      rules: {
        op: 'AND',
        conditions: [
          { type: 'score', operator: 'gte', value: 300 },
          { type: 'event_not_performed', event: 'ANY', window: { days: 30 } },
        ],
      },
    },
    {
      name: 'Delhi Window Shoppers',
      description: 'Delhi users who browse products but have never bought',
      rules: {
        op: 'AND',
        conditions: [
          { type: 'attribute', field: 'profile.city', operator: 'eq', value: 'Delhi' },
          { type: 'attribute', field: 'stats.purchaseCount', operator: 'eq', value: 0 },
          { type: 'event', event: 'PRODUCT_VIEW', aggregate: 'count', operator: 'gte', value: 3, window: { days: 60 } },
        ],
      },
    },
  ];

  const cohorts = [];
  for (const def of definitions) {
    // eslint-disable-next-line no-await-in-loop
    const cohort = await cohortService.create({ ...def, refreshIntervalMinutes: 30 }, actorId);
    cohorts.push(cohort);
    console.log(`  Cohort "${cohort.name}" -> ${cohort.memberCount} members`);
  }
  return cohorts;
}

async function seedCampaigns(cohorts, actorId) {
  const byName = Object.fromEntries(cohorts.map((c) => [c.name, c]));

  const campaigns = [
    {
      name: 'VIP Early Access',
      channel: CHANNELS.EMAIL,
      cohortIds: [byName['High Value Buyers']._id],
      content: {
        subject: 'Early access for you, {{user.firstName | default:there}}',
        body: '<p>Hi {{user.firstName | default:there}},</p><p>You are in our top tier ({{user.tier}}) with a score of {{user.score}}. Here is 48-hour early access to the new drop.</p>',
        fromName: 'Store Team',
        fromEmail: 'hello@example.com',
      },
      throttle: { respectConsent: true, frequencyCapDays: 3, minScore: 400 },
      schedule: { mode: 'IMMEDIATE' },
    },
    {
      name: 'Cart Recovery Nudge',
      channel: CHANNELS.EMAIL,
      cohortIds: [byName['Abandoned Cart (7 days)']._id],
      excludeCohortIds: [byName['High Value Buyers']._id],
      content: {
        subject: 'You left something behind',
        body: '<p>Hi {{user.firstName | default:there}}, your cart is still waiting. Complete your order today.</p>',
        fromName: 'Store Team',
        fromEmail: 'hello@example.com',
      },
      throttle: { respectConsent: true, frequencyCapDays: 2, quietHours: { enabled: true, startHour: 21, endHour: 8 } },
      schedule: { mode: 'RECURRING', intervalMinutes: 1440 },
    },
    {
      name: 'Complete Your Profile',
      channel: CHANNELS.EMAIL,
      cohortIds: [byName['Incomplete Profiles']._id],
      content: {
        subject: 'Finish your profile, unlock better recommendations',
        body: '<p>Hi {{user.firstName | default:there}}, your profile is {{user.completion}}% complete. Finish it to get personalised picks.</p>',
        fromName: 'Store Team',
        fromEmail: 'hello@example.com',
      },
      throttle: { respectConsent: true, frequencyCapDays: 14 },
      schedule: { mode: 'IMMEDIATE' },
    },
  ];

  const created = [];
  for (const c of campaigns) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await Campaign.create({ ...c, createdBy: actorId, updatedBy: actorId }));
  }
  console.log(`Created ${created.length} campaigns`);
  return created;
}

async function main() {
  await db.connect();
  await reset();
  await ScoringRule.create({ name: 'default' });

  const { admin } = await seedStaff();
  const customers = await seedCustomers(120);
  await seedActivity(customers);

  console.log('Recomputing scores...');
  await scoringService.recomputeBatch({ limit: 500 });

  console.log('Building cohorts...');
  const cohorts = await seedCohorts(admin._id);
  await seedCampaigns(cohorts, admin._id);

  console.log('\nSeed complete. Log in with:');
  console.log(`  ${env.DEFAULT_ADMIN_EMAIL} / ${env.DEFAULT_ADMIN_PASSWORD}`);
  await db.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
