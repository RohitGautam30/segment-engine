# Segment Engine

Customer segmentation, scoring and campaign management.
Express + MongoDB API, React console on top.

```
segment-engine/
├── backend/     Express + Mongoose API, MVC, worker process
├── frontend/    React + Vite console
├── docker-compose.yml
└── package.json  root scripts that drive both
```

---

## Run it locally

You need **Node 18.17+** and **MongoDB** (local, Atlas, or the Docker service below).

```bash
# 1. install everything (root, backend, frontend)
npm run install:all

# 2. configure the backend
cp .env.example backend/.env
#    the defaults work as-is against a local mongod on 27017

# 3. start MongoDB (skip if you already have one)
docker compose up -d mongo

# 4. seed a population: 120 users, ~2k events, 5 cohorts, 3 campaigns
npm run seed

# 5. start the API, the worker and the console together
npm run dev
```

| What | Where |
|---|---|
| Console | http://localhost:5173 |
| API | http://localhost:4000/api/v1 |
| Health | http://localhost:4000/api/v1/system/health |

Sign in with **admin@example.com / Admin@12345** (also `manager@example.com / Manager@12345`).

The Vite dev server proxies `/api` to port 4000, so the browser only ever
talks to one origin and CORS never comes up.

### Everything in Docker instead

```bash
cp .env.example backend/.env
docker compose up --build
docker compose exec api npm run seed
```

Console on http://localhost:5173, API on http://localhost:4000. In this mode
nginx serves the built frontend and proxies `/api` to the API container.

### Running pieces separately

```bash
npm run dev:api      # API + scheduler on :4000
npm run dev:worker   # job worker (campaign runs, cohort refresh, scoring)
npm run dev:web      # console on :5173
```

The worker is optional for clicking around: sends triggered from the console
run synchronously so you get a report immediately. Scheduled campaigns and
background score recomputes need it.

---

## Troubleshooting

**"Cannot reach the API"** on the login screen — the backend isn't up. Check
`npm run dev:api` printed a port, and that `backend/.env` exists.

**Server exits with "Invalid environment configuration"** — both JWT secrets
must be at least 32 characters. Copy `.env.example` rather than writing your own.

**"No users yet"** after signing in — run `npm run seed`.

**`MongooseServerSelectionError`** — MongoDB isn't reachable at `MONGO_URI`.
Start it with `docker compose up -d mongo`.

**Port already taken** — change `PORT` in `backend/.env`, and the `port` in
`frontend/vite.config.js` if 5173 clashes.

---

## The four lifecycle stages

Customers move through a funnel: **signed up → profile complete → added to cart
→ ordered**. A user sits at the furthest stage they have reached, and the stage
only ever moves forward — ordering once keeps you at `ORDERED` even if your
profile later lapses, because the funnel records progress, not current tidiness.

The stage is stored on the user as `stats.lifecycleStage` and recomputed by the
API whenever a `SIGNUP`, `PROFILE_COMPLETED`, `ADD_TO_CART` or `PURCHASE` event
arrives. Because it is a real indexed field rather than something derived at
read time, you can segment on it directly:

```jsonc
{ "op": "AND", "conditions": [
  { "type": "attribute", "field": "stats.lifecycleStage", "operator": "eq", "value": "ADDED_TO_CART" },
  { "type": "score", "operator": "gte", "value": 200 }
]}
```

That is the cohort that matters most in practice: same funnel position, very
different intent. The seed creates one cohort per stage plus this combined one.

`GET /api/v1/events/stage-funnel` returns the funnel with drop-off between
steps. In the console it is the top-left panel, and clicking a bar filters to
the people sitting at that stage.

## What the console does

**Cumulative data.** Every readout recalculates against the current selection,
not the whole database: revenue, orders, buyers, average score, profile
completeness, and how many people are contactable right now. Below that, a
cumulative signup curve and the tier distribution.

**The population strip.** Each square is one person, coloured by tier. As you
move the filters, everyone who falls out dims in place, so the audience reads
as a quantity rather than a number that changes. Hovering a square highlights
the matching table row and the reverse.

**Filters.** Search, account status, lifecycle stage, tier, a dual score slider, category
interest, city, minimum profile completion, inactivity, buyers-only and
opted-in-only. Filtering happens in the browser over the loaded population,
which keeps it instant; past a few tens of thousands of users you would push
these down to the API's own query parameters.

**Sending.** The button under the table carries whatever you have filtered to
into the composer. Pick a preset or write your own, insert `{{user.firstName}}`
style tokens, and the preview renders against a real recipient. The right rail
applies the same guard-rails the backend does (consent, minimum score,
frequency cap, recipient cap) and shows live how many drop out and why.

Sending is real, not faked: `POST /api/v1/campaigns/quick-send` wraps the
selected users in a static cohort, creates a campaign, runs it and returns the
report. You get Cohort, Campaign, CampaignRun and per-recipient Delivery
records exactly as a planned campaign would produce, so nothing bypasses the
audit trail. **No actual email leaves the machine** — the email channel logs
to the API console instead. Point it at a real provider by filling in `send()`
in `backend/src/services/channels/email.channel.js`.

Tick **dry run** to record the whole run and deliver nothing at all.

---

## How the backend works

Full detail in [`backend/README.md`](backend/README.md) and
[`backend/docs/DATA_MODEL.md`](backend/docs/DATA_MODEL.md).
[`backend/docs/api.http`](backend/docs/api.http) is a 23-step walkthrough you
can run in VS Code's REST Client or paste into Postman.

The short version:

- **Activity tracking** — `POST /events/track` takes a JWT or a server-side
  `x-api-key`, resolves the user, dedupes on an idempotency key, writes the
  event, updates denormalised counters on the user, and applies the score
  change. `PROFILE_COMPLETED` fires by itself the first time a profile hits 100%.
- **Scoring** — points per event type, time decay, per-type caps, revenue
  weighting, profile bonus and an inactivity penalty, all from one editable
  config document. Incremental on write, reconciled by a full recompute.
- **Segmentation** — cohorts are AND/OR/NOT rule trees compiled into MongoDB
  aggregation pipelines. Attribute, score, tier, tag, event-aggregate and
  "did not do X" conditions. Field paths run through an allow-list so a rule
  can never reach `passwordHash` or inject an operator.
- **Campaigns** — refresh the target cohorts, snapshot them, batch through the
  audience with a resumable cursor, write a Delivery per recipient with a skip
  reason when someone is filtered out.

---

## Tests

```bash
npm test     # 43 tests
```

Covers the rule compiler and its injection guards, the scoring maths and decay
curve, lifecycle stage transitions, template escaping, profile completion
weights, and the HTTP layer (routing, validation, auth gates, error envelope).
The HTTP tests deliberately run without a database.

Integration tests against real data need a live MongoDB: point `MONGO_URI` at a
scratch database and add supertest specs under `backend/tests/`.
