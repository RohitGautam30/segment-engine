# Customer Segmentation & Campaign Management System

Node.js + Express + MongoDB (Mongoose), MVC architecture.

Admins create users, every user activity is tracked as an event, scores are
calculated automatically from those events, dynamic cohorts are built from
activity + score rules, and campaigns target those cohorts.

---

## 1. Quick start

```bash
cp ../.env.example .env       # set JWT secrets (min 32 chars) and MONGO_URI
npm install
npm run seed                  # 120 users, ~2k events, 5 cohorts, 3 campaigns
npm run dev                   # API on http://localhost:4000
npm run dev:worker            # separate terminal: campaign/cohort/score worker
```

To run the API and the console together, use the root `npm run dev` instead.

Seeded login: `admin@example.com` / `Admin@12345`

---

## 2. Architecture

```
Request → Routes → Middleware (auth, RBAC, validation) → Controller → Service → Model → MongoDB
                                                                        ↓
                                                              Job queue → Worker
```

| Layer | Responsibility |
|---|---|
| `models/` | Mongoose schemas, indexes, hooks |
| `controllers/` | HTTP in/out only — no business logic |
| `services/` | All business logic; reusable by controllers, workers and scripts |
| `routes/` | URL → middleware chain → controller |
| `middlewares/` | Auth, RBAC, validation, rate limiting, error handling |
| `validators/` | Zod schemas; nothing unvalidated reaches a service |
| `jobs/` + `workers/` | Async execution of campaigns, cohort refresh, score recompute |

```
src/
├── config/       env, db, logger, constants
├── models/       User, Event, Cohort, CohortMembership, Campaign,
│                 CampaignRun, Delivery, Job, ScoringRule, RefreshToken, AuditLog
├── controllers/  auth, user, event, cohort, campaign, scoring, system
├── services/     ruleEngine, scoring, event, cohort, campaign, queue,
│                 template, token, auth, user, audit, channels/
├── routes/       one router per resource
├── middlewares/  auth, rbac, validate, rateLimit, errorHandler, notFound
├── validators/   zod schemas per resource
├── jobs/         scheduler + job handlers
├── workers/      standalone worker process
└── utils/        ApiError, catchAsync, pagination, dates, response
```

---

## 3. Database design

### `users`
Identity, `profile` (with a computed `completion` %), `consent`, `tags`,
free-form `traits`, plus two denormalised sub-documents that make
segmentation fast:

- **`stats`** — running counters: `purchaseCount`, `totalRevenue`,
  `averageOrderValue`, `cartAdds`, `lastActivityAt`, `lastPurchaseAt`…
  Updated on every event with `$inc`/`$set`, so most cohort rules resolve
  against indexed scalar fields instead of scanning the event log.
- **`score`** — `value`, `tier`, `breakdown` (engagement / monetary /
  recency / profile), `computedAt`, `stale`.

Indexes: `{status, score.value}`, `{status, stats.lastActivityAt}`,
`{status, stats.totalRevenue}`, `{profile.country, score.tier}`.

### `events`
Append-only activity log. Commerce fields (`value`, `productId`, `orderId`,
`category`, `quantity`) are promoted out of `properties` so they can be
indexed and aggregated. `idempotencyKey` has a unique partial index, which
makes ingestion safely retryable. Indexes: `{userId, type, occurredAt}`,
`{type, occurredAt}`.

### `cohorts` + `cohortmemberships`
The cohort holds the rule tree; membership is materialised into a separate
collection (unique on `{cohortId, userId}`). Keeping members out of the
cohort document avoids unbounded arrays and lets a campaign page through
millions of recipients with a cursor.

### `campaigns` / `campaignruns` / `deliveries`
A campaign is the definition; a run is one execution; a delivery is one
message to one person. `deliveries` is unique on `{runId, userId}` — that
single index is what makes a retried batch idempotent.

### `jobs`
Mongo-backed work queue. Workers claim jobs with an atomic
`findOneAndUpdate`, so several worker processes are safe without Redis.
Retries use exponential backoff; exhausted jobs land in `DEAD`.

---

## 4. Activity tracking

`POST /api/v1/events/track` accepts either a JWT or a server-side
`x-api-key`. Every ingested event:

1. resolves the user by `userId`, `externalId` or `email`
2. short-circuits if `idempotencyKey` was already seen
3. writes the event
4. updates the denormalised `stats` counters
5. applies the incremental score change

```jsonc
POST /api/v1/events/track
x-api-key: pk_live_demo_key_1
{
  "externalId": "ext-1042",
  "type": "PURCHASE",
  "value": 4599,
  "currency": "INR",
  "orderId": "ORD-88213",
  "category": "helmets",
  "idempotencyKey": "order-88213-purchase"
}
```

Tracked types: `SIGNUP`, `LOGIN`, `PROFILE_COMPLETED`, `PROFILE_UPDATED`,
`PAGE_VIEW`, `PRODUCT_VIEW`, `ADD_TO_CART`, `REMOVE_FROM_CART`,
`CHECKOUT_STARTED`, `PURCHASE`, `REFUND`, `SUPPORT_TICKET`, `EMAIL_OPENED`,
`EMAIL_CLICKED`, `UNSUBSCRIBE`, `CUSTOM`.

`SIGNUP` fires on registration. `PROFILE_COMPLETED` fires automatically the
first time `profile.completion` reaches 100% — you never emit it by hand.

---

## 5. Automatic scoring

Configured in a single `ScoringRule` document, editable at
`PATCH /api/v1/scoring/rules`.

```
score = Σ(eventPoints[type] × decayed_count, capped per type)
      + revenue × pointsPerCurrencyUnit        (capped)
      + profileCompletion% × profileBonus.maxPoints
      − inactivityPenalty
clamped to [minScore, maxScore] → tier
```

Two paths, deliberately:

- **Incremental** — runs inline on every event so the score is fresh
  immediately. Marks the score `stale`.
- **Full recompute** — the source of truth. Re-reads the event log and
  applies time decay (`0.5 ^ (ageDays / halfLifeDays)`), per-type caps and
  the inactivity penalty. Runs on a schedule and on demand.

Tiers: `BRONZE` 0+, `SILVER` 250+, `GOLD` 500+, `PLATINUM` 750+.

`POST /api/v1/scoring/simulate` scores a hypothetical event list without
touching data — useful when tuning weights.

---

## 6. Rule-based segmentation

A cohort is a rule tree. `AND` / `OR` / `NOT` groups nest up to 6 deep.

| Condition | Purpose |
|---|---|
| `attribute` | any allow-listed user field |
| `score` / `tier` | shorthand for `score.value` / `score.tier` |
| `tag` | `has`, `hasNot`, `hasAny`, `hasAll` |
| `event` | aggregate over the event log in a time window |
| `event_not_performed` | negative targeting (did *not* do X) |

Operators: `eq ne gt gte lt lte in nin between contains notContains
startsWith endsWith exists notExists`.
Event aggregates: `count sum avg max min last_occurred_at first_occurred_at`.

**Example — high-intent cart abandoners who aren't already VIPs:**

```jsonc
{
  "op": "AND",
  "conditions": [
    { "type": "score", "operator": "gte", "value": 150 },
    { "type": "attribute", "field": "profile.country", "operator": "in", "value": ["IN"] },
    { "type": "event", "event": "ADD_TO_CART", "aggregate": "count",
      "operator": "gte", "value": 1, "window": { "days": 7 } },
    { "type": "event_not_performed", "event": "PURCHASE", "window": { "days": 7 } },
    { "op": "OR", "conditions": [
      { "type": "event", "event": "PURCHASE", "aggregate": "sum", "property": "value",
        "operator": "gte", "value": 5000, "window": { "days": 365 } },
      { "type": "tag", "operator": "has", "value": "newsletter" }
    ]}
  ]
}
```

### How it compiles

`ruleEngine.compile()` turns that tree into an aggregation pipeline:

1. **Prefilter** — simple top-level `AND` conditions are hoisted into a
   leading `$match` so the query planner can use the user indexes.
2. **`$lookup` per event condition** — each one runs a scoped sub-pipeline
   against `events` (user + type + window + optional product/category
   filters) and groups down to a single number.
3. **`$match: { $expr }`** — the boolean tree, combining attribute
   comparisons and the looked-up event aggregates.

Safety: field paths are checked against an explicit allow-list
(`services/fieldRegistry.js`), operators are mapped to fixed expressions,
regex values are escaped, and depth/condition counts are capped. A rule can
never reach `passwordHash` or inject an operator.

### Endpoints

```
GET  /api/v1/cohorts/schema        # fields + operators, to build a rule editor UI
POST /api/v1/cohorts/preview       # dry-run: match count + sample, saves nothing
POST /api/v1/cohorts               # create (materialises immediately)
POST /api/v1/cohorts/:id/refresh   # re-evaluate now
GET  /api/v1/cohorts/:id/members   # paginated members
```

Always `preview` before you save — it returns `matchCount`, a sample of
matching users, and a plain-English `explanation` of the rule.

Refresh writes membership rows stamped with a batch id, then deletes rows
not stamped in that run. Members who no longer qualify drop out
automatically; auto-refresh runs on each cohort's own interval.

---

## 7. Targeted campaigns

```
POST /api/v1/campaigns             # define: cohorts + channel + content
GET  /api/v1/campaigns/:id/estimate  # reach after exclusions/consent/caps
POST /api/v1/campaigns/:id/launch  # { "isDryRun": true } to rehearse safely
POST /api/v1/campaigns/:id/pause
GET  /api/v1/campaigns/:id/runs
GET  /api/v1/campaigns/runs/:runId # per-run report + skip reasons
```

Launch flow:

1. **Refresh** every targeted cohort — a stale segment sends the wrong
   message to the wrong people, so freshness beats latency here.
2. **Create a `CampaignRun`** and enqueue it; the API returns immediately.
3. **Worker builds the audience** — union of target cohorts, minus
   `excludeCohortIds`, then filtered by eligibility.
4. **Batch and send** (default 500/batch), writing a `Delivery` per
   recipient and checkpointing a cursor so an interrupted run resumes.

Eligibility filters applied before anyone is contacted:

- `status = ACTIVE`, not deleted
- channel consent (`consent.email` / `consent.sms` / `consent.push`)
- `throttle.minScore`
- `throttle.frequencyCapDays` — skip anyone contacted within N days
- `throttle.maxRecipients` — hard ceiling
- `throttle.quietHours` — no sends during a local blackout window

Every recipient gets a `Delivery` row with the rendered content, provider
message id, and a `skipReason` if they were filtered out — so "why didn't
this person get the email?" is always answerable.

Templating is a deliberately dumb `{{user.firstName | default:there}}`
substitution over a whitelisted context. No logic, no code execution.

Channels live in `services/channels/` behind one interface
(`resolveDestination`, `send`). Email/SMS/Push log instead of sending out of
the box — drop your provider SDK into `send()` and nothing else changes.
Webhook is fully functional.

---

## 8. Auth & roles

JWT access tokens (15m) + rotating refresh tokens (30d, hashed at rest, with
reuse detection that revokes the whole family). `tokenVersion` on the user
lets you invalidate every token at once.

| Role | Can do |
|---|---|
| `ADMIN` | everything, incl. creating users and editing scoring rules |
| `MANAGER` | create/edit/launch cohorts and campaigns |
| `ANALYST` | read-only across users, cohorts, campaigns, analytics |
| `USER` | own profile and own timeline only |

Server-to-server event ingestion uses `x-api-key` instead
(`INGEST_API_KEYS`, comma-separated).

---

## 9. Production notes

- **Indexes**: `autoIndex` is off in production. Run
  `node scripts/sync-indexes.js` as a deploy step.
- **Scaling**: run API and workers as separate processes. `WORKER_ENABLED`
  should be `true` on exactly one API replica (it drives the scheduler) and
  `false` on workers, which only execute. Job `dedupeKey` collapses
  duplicates if you get that wrong.
- **Security**: helmet, CORS allow-list, per-route rate limits (10/15min on
  auth), bcrypt cost 12, `sanitizeFilter` against operator injection, field
  allow-listing in the rule engine, secrets redacted from logs.
- **Observability**: pino structured logs with a request id on every line
  and every error response; `/system/health` (liveness),
  `/system/ready` (DB check), `/system/queue` (queue depth),
  `/system/audit-logs` (who changed what).
- **Graceful shutdown**: SIGTERM stops the scheduler, drains the HTTP
  server, waits for in-flight jobs, then closes Mongo.
- **Retention**: an optional TTL index on `events.occurredAt` is commented
  out in the model — enable it if you need a retention policy.

### Where to extend

- Replace the mock channel `send()` implementations with SES/Brevo/Twilio.
- Swap `services/queue.service.js` for BullMQ if you outgrow Mongo polling.
- Add open/click webhooks writing to `Delivery.openedAt` / `clickedAt`.
- Add A/B variants by giving `Campaign.content` an array and hashing
  `userId` into a bucket.

---

## 10. Testing

```bash
npm test     # 24 unit tests: rule engine, scoring, templating, completion
```

Covers the parts where a bug is expensive: rule compilation and its
injection guards, score maths and decay, template escaping, and profile
completion. Integration tests need a live Mongo — point `MONGO_URI` at a
test database and add supertest specs under `tests/`.
