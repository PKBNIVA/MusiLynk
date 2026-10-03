# Real-time updates (Action Cable)

New messages, unread badges and urgent-request progress reach open pages over a WebSocket at
`wss://<api host>/cable`. Polling stays as the fallback: while a page's socket is connected its
polls slow to every 30 s; when the socket drops they return at once to 3 s (open thread), 10 s
(inbox and badges) and 4 s / 15 s (urgent request page).

## How it works

- `POST /api/cable/ticket` (signed in, 30 per minute) returns a signed ticket valid for 60 s that
  names the caller's session. The browser opens `/cable?ticket=...`; the server checks the ticket
  and that the session is still active. The bearer token itself never goes in a URL.
- Channels (`backend/app/channels`): `UserChannel` (the user's own badge hints),
  `ConversationChannel` (the two participants only), `UrgentRequestChannel` (the requester only).
  Anyone else's subscription is rejected.
- Broadcasts carry ids and states only (`{ type: "message", id, conversationId }`); pages refetch
  from the usual endpoints, so who may see what is decided there. They are sent after the write
  commits (`Realtime`), and a failed broadcast never fails the write.
- Sockets are accepted only from `ALLOWED_ORIGINS` and `ADMIN_ORIGIN` (the same lists as CORS).
- The Vercel CSP allows `wss://musilynk-api-production.up.railway.app` in `connect-src`.

## Adapter: Solid Cable (default) or Redis

`backend/config/cable.yml` picks the adapter per process:

- **No `REDIS_URL` (today)**: Solid Cable on the existing Postgres. Broadcasts are rows in
  `solid_cable_messages`; each API process polls the table every 0.1 s and rows older than 24 h are
  trimmed. No new service is needed. The web and worker services must use the same database
  (they do), because jobs broadcast too.
- **With `REDIS_URL`**: Redis pub/sub (the same variable the cache already uses). To switch, add a
  Redis service in Railway and set `REDIS_URL` on both `musilynk-api` and `musilynk-worker`
  (Railway variable reference to the Redis service's URL). Redeploy both. Nothing else changes; the
  `solid_cable_messages` table simply stops being written.

Tuning lives in `backend/config/realtime.yml` (ticket lifetime, ticket rate limit, Action Cable
worker threads, Solid Cable polling and retention). Action Cable's worker threads and Solid
Cable's listener are counted in the database pool (`backend/config/database.yml`); sockets do not
hold Puma threads after the upgrade.

## Capacity (measured)

`scripts/perf/cable-load.mjs` opens N sockets against a local API and samples its memory and CPU.
On the 4-vCPU test bed (one Puma process, development mode, Solid Cable): 500 sockets subscribed
with 0 failures in 7.7 s; server memory 123 → 164 MB (about 83 kB per socket); about 5% of one
CPU while holding them (Action Cable pings every socket every 3 s).

## Turning it off

There is no switch to flip: if `/cable` is unreachable (or `POST /api/cable/ticket` fails) the app
keeps polling at the old intervals and retries the socket with backoff (1 s doubling to 30 s).
To remove it entirely, revert the release; the `solid_cable_messages` table can stay.

## Environment variables

None new. `REDIS_URL` (optional, existing) switches the adapter; `ALLOWED_ORIGINS` and
`ADMIN_ORIGIN` (existing) gate socket origins.
