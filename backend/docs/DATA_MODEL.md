# Data model reference

## Collection relationships

```
users ──1:N──> events                (activity log)
users ──1:N──> cohortmemberships <──N:1── cohorts
users ──1:N──> deliveries        <──N:1── campaignruns <──N:1── campaigns
users ──1:N──> refreshtokens
cohorts <──N:M── campaigns           (cohortIds / excludeCohortIds)
jobs                                 (queue, no FK)
scoringrules                         (single active doc)
auditlogs ──N:1──> users             (actor)
```

## users

| Field | Type | Notes |
|---|---|---|
| `email` | String | unique, lowercase |
| `passwordHash` | String | bcrypt cost 12, `select: false` |
| `role` | Enum | ADMIN / MANAGER / ANALYST / USER |
| `status` | Enum | ACTIVE / INVITED / SUSPENDED / DELETED |
| `externalId` | String | your app's id, sparse index |
| `profile.*` | Mixed | name, phone, gender, dob, country, city, avatar, company |
| `profile.completion` | Number | 0-100, recomputed on every profile write |
| `stats.*` | Numbers/Dates | denormalised counters, updated per event |
| `score.value` / `.tier` / `.breakdown` | | auto-calculated |
| `consent.email/sms/push` | Boolean | enforced at send time |
| `tags` | [String] | manual segmentation labels |
| `traits` | Map | arbitrary custom attributes, queryable as `traits.<key>` |
| `lastContactedAt` | Date | drives frequency capping |
| `tokenVersion` | Number | bump to revoke all JWTs |

**Profile completion weights** (total 100): firstName 15, lastName 10,
phone 20, dateOfBirth 10, gender 5, country 15, city 10, avatarUrl 10,
company 5.

## events

Append-only. `value`/`quantity`/`productId`/`orderId`/`category` are
promoted out of `properties` so they can be indexed and aggregated.
`idempotencyKey` carries a unique partial index.

Indexes: `{userId,type,occurredAt}`, `{type,occurredAt}`, `{occurredAt}`,
unique `{idempotencyKey}` (partial).

## cohorts

`rules` holds the tree; `type` is DYNAMIC (rule-driven) or STATIC
(explicit `staticMemberIds`). `memberCount`, `lastRefreshedAt`,
`lastRefreshDurationMs` and `lastRefreshError` are refresh telemetry.

## cohortmemberships

`{cohortId, userId}` unique. `refreshBatch` is the sweep marker: a refresh
stamps every current member with a new batch id, then deletes anything not
stamped.

## campaigns / campaignruns / deliveries

- **campaign** — definition: cohorts, channel, content, schedule, throttle
- **campaignrun** — one execution: audience size, counters, resume `cursor`,
  and `snapshotCohortIds` so an edit mid-flight can't change the target
- **delivery** — one message: rendered content, destination, provider id,
  status, `skipReason`. Unique `{runId, userId}` makes retries idempotent.

## jobs

`{status, runAt, priority}` drives claiming. `dedupeKey` has a unique
partial index scoped to PENDING/ACTIVE, so re-enqueuing the same logical
work is a no-op while it's still outstanding.
