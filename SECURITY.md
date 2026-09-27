# Security

To report a vulnerability, email the owner privately; do not open a public issue.
Incident steps (revoking sessions, rotating secrets) are in
[docs/engineering/RUNBOOK.md](docs/engineering/RUNBOOK.md#5-security-incident).

## In place

Authentication and sessions
- bcrypt password hashing (`has_secure_password`); email one-time codes (10-minute,
  single-use, 5 attempts, digests keyed from `SECRET_KEY_BASE`) as the primary sign-in;
  password sign-in as a fallback (`PASSWORD_LOGIN_ENABLED`).
- Random bearer tokens stored only as SHA-256 digests; sliding expiry of 7 days idle under a
  30-day cap (admins: 12 hours idle, 7-day cap); sessions bound to the creating browser family
  (a replayed admin token is revoked, others are flagged in the audit log); at most 10 live
  sessions per user; logout revokes; suspended or pending accounts get `403 ACCOUNT_INACTIVE`.
  Details, and the plan to move the token into an HttpOnly cookie, are in
  [docs/engineering/SESSIONS.md](docs/engineering/SESSIONS.md).
- Admin two-step sign-in: an admin password sign-in also needs a code emailed to the admin
  (`ADMIN_SECOND_FACTOR`, see [DEPLOYMENT.md](DEPLOYMENT.md)).
- Admin "revoke sessions" for any user and a Sign-in doctor that explains lockouts without
  exposing secrets. Both are audited.
- Email verification and password reset with short-lived single-use tokens.

Abuse controls
- Login throttled on failures per email and per email+IP; sign-up, sign-in code requests,
  messages, conversations, reports, blocks, search (60/min/IP) and account export/deletion
  are rate-limited. Counters live in Solid Cache on PostgreSQL, shared across processes.
- Users can block and report each other; messages to suspended accounts are refused.
- Request bodies capped at 1 MB (uploads have their own limit).

Authorization and data
- The server enforces roles, ownership (employer applications, acts, workspaces, folders,
  conversations) and state transitions; hidden profiles stay hidden.
- Uploads: presigned, size- and type-bound, re-verified server-side by reading the stored
  object's size and leading bytes; unused objects are swept daily.
- Payments: plan and amount are decided server-side; Razorpay webhooks are HMAC-verified and
  de-duplicated; live/test key-mode guard.
- Users can download their data (`GET /api/account/export`) and delete their account
  (`DELETE /api/account`).

Platform
- CORS allowlist (`ALLOWED_ORIGINS`); CSP and security headers in `vercel.json`; TLS at
  Vercel and Railway.
- Logs and error reports filter passwords, tokens, codes, emails, signatures and message
  bodies; Sentry scrubbing drops request bodies, cookies, query strings and IPs.
- Audit log of sensitive admin, auth and billing actions.
- CI runs Brakeman, bundler-audit and `npm audit`; Dependabot is enabled; `production` is a
  protected branch.
- Nightly encrypted, restore-verified database backups.

## Not yet in place

- An authenticator-app or passkey second factor for admins, and narrower admin/support roles.
- HttpOnly cookie sessions (the token is in `localStorage`; see docs/engineering/SESSIONS.md).
- Malware scanning of uploaded files.
- WAF/bot management in front of the API.
- Point-in-time database recovery (backups are nightly).
- Self-service device/session list for users.
- A secrets manager beyond the providers' environment settings.
