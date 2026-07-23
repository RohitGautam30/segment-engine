# Segment Engine

Customer segmentation, scoring and campaign management.
Node.js · Express · MongoDB · React

Track what customers do, turn that behaviour into a score, group them by rules,
and message the group. Built for the Oxyzo assignment.

**Live demo → [segment-engine.vercel.app](https://segment-engine.vercel.app)**
`admin@example.com` / `Oxyzo@123`

> The API is on Render's free tier and sleeps when idle, so the first request
> takes 30–60 seconds. Campaign sends are recorded end to end but no real email
> is delivered — the mail channel logs instead.

---

## The idea in one line

Everything on screen is derived, not stored. Scores come from events, tiers come
from scores, cohorts come from rules over both. Write one event and the whole
chain updates.

```
   ┌──────────────────────────────────────────────────────┐
   ↓                                                      │
 Track  ──→  Score  ──→  Segment  ──→  Send  ──────────────┘
 events      points,     cohorts       campaign to
             decay,      from          one cohort
             tiers       rules
```

Sending produces new events, which re-enter tracking.

---

## What the brief asked for

**Customers move through stages** — signed up → profile complete → added to cart
→ ordered. Each customer sits at the furthest stage reached, and the stage only
moves forward: ordering once keeps you at `ORDERED` even if the profile later
lapses. A funnel records progress, not current tidiness.

**Cohorts are built from those stages.** One per stage, plus combinations that
mix stage with score — which is where segmentation earns its keep:

```jsonc
{ "op": "AND", "conditions": [
  { "field": "stats.lifecycleStage", "operator": "eq", "value": "ADDED_TO_CART" },
  { "type": "score", "operator": "gte", "value": 200 }
]}
```

Same funnel position, very different intent.

**Scoring is automatic.** Points per event type, time decay, per-type caps,
revenue weighting, profile bonus, inactivity penalty — all from one editable
config document.

**Campaigns fetch their audience at send time**, so a cohort refreshed a second
before launch is the one that gets messaged.

**The console** shows cumulative data for the current selection, nine filters,
and a composer that selects by category or score, writes a message and sends it.

---

## Architecture

```
Request → Routes → Middleware → Controller → Service → Model → MongoDB
                (auth, RBAC,                              ↓
                 validation)                       Job queue → Worker
```

MVC, with business logic in services so the same code serves HTTP handlers,
background jobs and CLI scripts.

```
backend/src/
├── config/       env validation, db, logger, constants
├── models/       11 Mongoose schemas with tuned indexes
├── controllers/  HTTP in/out only, no logic
├── services/     rule engine, scoring, cohorts, campaigns, queue, channels
├── routes/       one router per resource
├── middlewares/  auth, RBAC, validation, rate limiting, error handling
├── validators/   Zod schemas — nothing unvalidated reaches a service
├── jobs/         scheduler + handlers
└── workers/      standalone worker process

frontend/src/
├── api/          client with silent token refresh
├── components/   filter rail, population strip, funnel, table, composer
└── lib.js        adapter, filters, summaries
```

---

## Decisions worth explaining

**Denormalised counters on the user.** Every event updates `stats.purchaseCount`,
`stats.totalRevenue`, `stats.lastActivityAt` and so on. Cohort rules then filter
on indexed scalars instead of scanning an event log that grows without bound.
The raw events stay as the source of truth for recomputation.

**Two scoring paths, deliberately.** Incremental scoring runs inline on write so
the number is fresh immediately, and marks the score stale. A periodic full
recompute re-reads the event log and applies time decay
(`0.5 ^ ageDays / halfLife`), per-type caps and the inactivity penalty. Fast
feedback without letting drift accumulate.

**Rules compile to aggregation pipelines.** An AND/OR/NOT tree becomes a single
MongoDB pipeline: simple top-level conditions hoist into a leading `$match` so
the planner uses indexes, each event condition becomes a scoped `$lookup`, then
one `$match: { $expr }` combines the boolean tree. Field paths run through an
explicit allow-list, so a rule can never reach `passwordHash` or inject an
operator — there is a test for exactly that.

**Ad-hoc sends still produce real records.** Selecting users in the console and
messaging them creates a Cohort, Campaign, CampaignRun and one Delivery per
recipient — identical to a planned campaign. Nothing bypasses the audit trail.

**Delivery is idempotent by index.** `deliveries` is unique on
`{runId, userId}`, so retrying an interrupted batch is a no-op rather than a
duplicate send. Event ingestion has the same property via `idempotencyKey`.

**Guard-rails before anyone is contacted.** Channel consent, minimum score,
frequency capping, recipient cap, quiet hours. Every filtered recipient still
gets a Delivery row with a `skipReason`, so "why didn't this person get the
email?" is always answerable.

**Mongo-backed job queue instead of Redis.** Workers claim jobs with an atomic
`findOneAndUpdate`, which is safe across processes and one fewer service to run.
Genuinely viable at moderate volume; swap for BullMQ if it outgrows polling.

---

## Data model

| Collection | Holds |
|---|---|
| `users` | identity, profile, consent, denormalised `stats`, computed `score` |
| `events` | append-only activity log, commerce fields promoted for indexing |
| `cohorts` | rule tree or static member list, refresh telemetry |
| `cohortmemberships` | materialised membership, unique on `{cohortId, userId}` |
| `campaigns` | definition: target cohorts, channel, content, schedule, throttle |
| `campaignruns` | one execution, with a resume cursor and audience snapshot |
| `deliveries` | one message to one person, with skip reason |
| `jobs` | work queue with backoff and dead-lettering |
| `scoringrules` | the single active scoring configuration |
| `auditlogs` | who changed what |
| `refreshtokens` | hashed, rotating, with reuse detection |

Detail in [`backend/docs/DATA_MODEL.md`](backend/docs/DATA_MODEL.md).
[`backend/docs/api.http`](backend/docs/api.http) is a 23-step API walkthrough.

---

## Run it locally

Needs Node 18.17+ and MongoDB.

```bash
npm run install:all
cp .env.example backend/.env     # defaults work as-is
docker compose up -d mongo       # skip if MongoDB is already running
npm run seed                     # 120 users, ~2k events, 6 cohorts, 3 campaigns
npm run dev                      # API :4000, worker, console :5173
```

Console on http://localhost:5173, login as above.

Everything in Docker instead:

```bash
docker compose up --build
docker compose exec api npm run seed
```

---

## Tests

```bash
npm test     # 49 tests
```

Covering the parts where a bug is expensive:

- **Rule engine** — compilation, nesting limits, regex escaping, and the field
  allow-list that blocks `passwordHash`
- **Scoring** — tier thresholds, decay halving at one half-life, monetary caps
- **Lifecycle stages** — forward-only transitions, ordering outranking an
  incomplete profile
- **Query operators** — a regression guard for a real bug where Mongoose's
  `sanitizeFilter` rewrote `{ $in: [...] }` into `{ $eq: { $in: [...] } }` and
  broke every campaign send. Verified to fail when the bug is reintroduced.
- **HTTP layer** — routing, validation, auth gates, error envelope. Runs without
  a database.

---

## Known limits

Stated plainly, because knowing them matters more than hiding them.

**Client-side filtering.** The console loads the population into memory and
filters in the browser, which keeps the funnel and strip instant. Past roughly
50k users this needs to move server-side — the API already accepts the same
filters as query parameters, so it's a change in one file, not a rewrite.

**Single API replica.** The scheduler finds due campaigns with a read-then-write
rather than an atomic claim, so two replicas could launch the same campaign
twice. Fixable with a `findOneAndUpdate` on campaign status.

**In-memory rate limiting.** Limits are per-instance rather than global. Fine at
one replica, leaky beyond that.

**No integration tests.** The 49 tests are unit and HTTP-level. Exercising the
full path against a live database is the obvious next step.

**Deployed demo runs sends inline.** The worker is a separate process by design
so sending scales independently of the API, but Render's free tier doesn't allow
background workers — so the hosted version runs campaigns synchronously. It runs
as a real worker locally and in Docker.

---

## What I'd build next

1. A cohort panel in the console — the backend has full cohort CRUD with
   materialised membership, but the UI only exposes ad-hoc filtering
2. Open and click tracking, writing back to `Delivery.openedAt` / `clickedAt`
3. A/B variants: give `Campaign.content` an array and hash `userId` into a bucket
4. Real channel adapters — the interface is there, `send()` just needs an SDK

---

## Stack

Express · Mongoose · Zod · JWT with rotating refresh tokens · Pino · Helmet ·
React · Vite · Docker · MongoDB Atlas · Render · Vercel

---

*Demo credentials are throwaway and the database holds generated data only.*
