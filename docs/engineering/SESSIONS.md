# Sessions and token theft

What protects a Verse session today, and the plan to move it into an HttpOnly cookie.

## Today

The frontend (Vercel, `verse-music-platform.vercel.app`) calls the API on a different site
(`*.up.railway.app`), so the session is a bearer token that the frontend keeps in
`localStorage`. Script injected into the page (XSS) could read it. Until the cookie migration
below ships, the blast radius of a stolen token is limited by:

- **Sliding expiry.** Each use extends a session by its idle timeout (7 days; admins 12 hours),
  never past a hard cap from sign-in (30 days; admins 7 days). A token lifted from a device
  that is no longer used dies within the idle window. Sessions issued before this change keep
  their original fixed 30-day expiry, except admin sessions, which end 7 days after sign-in
  because they were issued without the second step.
- **Client binding.** A session records a digest of the creating browser's User-Agent with
  version numbers removed (browser updates keep it). A token presented from a different
  browser family is revoked immediately for admins (`auth.session_revoked`) and flagged once
  for everyone else (`auth.session_client_mismatch`, visible in the admin sign-in doctor), so
  a member is never signed out by a false positive. A determined attacker can copy the
  User-Agent, so this detects careless replay; it does not prevent theft.
- **Admin two-step sign-in**, so a phished admin password alone does not give a session.
- The CSP (`script-src 'self'` plus Razorpay only), React's escaping and the existing
  "revoke sessions" admin control and password reset (which ends every session).

## Planned: HttpOnly cookie sessions

An HttpOnly cookie would put the token out of reach of page scripts. Set by the Railway
origin today it would be a third-party cookie (the frontend is a different site), which
Safari blocks and Chrome is restricting, so the API must first become same-origin:

1. **Vercel rewrite.** In `vercel.json`, add
   `{ "source": "/api/(.*)", "destination": "https://verse-music-platform-production.up.railway.app/api/$1" }`
   *before* the SPA catch-all, and set `VITE_API_URL=/api` on Vercel. The browser then talks
   only to the Vercel origin and CORS no longer applies.
2. **Client IP.** Behind the rewrite every request reaches Railway from Vercel's egress IPs, so
   `request.remote_ip` (used by every per-IP rate limit and in audit logs) would collapse onto a
   few addresses. Before switching, trust the client address only from Vercel: have the API
   read `x-vercel-forwarded-for` (or `x-real-ip`) when a shared secret header added by a
   Vercel Edge Middleware matches, and fall back to `remote_ip` otherwise. Without this the
   login and code throttles would lock out everyone at once.
3. **Cookie sessions behind a flag.** With `SESSION_COOKIE=true`, sign-in also sets
   `__Host-verse_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`) and returns no token in
   the body; `current_user` reads the cookie when there is no `Authorization` header, so
   bearer tokens keep working during migration. Logout clears the cookie.
4. **CSRF.** SameSite=Lax blocks POSTs from other sites, but sibling subdomains of the same
   registrable domain count as the same site (not a concern on `vercel.app`, which is on the
   public suffix list, but it would be on a custom domain). Cookie-authenticated mutations must
   therefore also carry a CSRF token: a
   non-HttpOnly `verse_csrf` cookie echoed in an `X-CSRF-Token` header, compared in constant
   time; bearer-authenticated requests skip the check (they are not ambient credentials).
5. **Frontend.** `api.ts` sends `credentials: 'same-origin'` and the CSRF header, stops
   storing the token, and "am I signed in" comes from `GET /me` instead of the stored token;
   cross-tab sign-out moves from `storage` events to a `BroadcastChannel`.
6. **Retire bearer tokens** for browsers once all live sessions have rotated (30 days after
   the switch), keeping them only for non-browser clients if any exist.

Each step is independently reversible (unset `SESSION_COOKIE`, point `VITE_API_URL` back at
Railway). Steps 2 to 5 need tests before the flag is turned on.

## Admin two-step sign-in

An admin password sign-in answers 202 with `secondFactorRequired` and a 10-minute signed
`challengeToken` bound to the admin and to one emailed sign-in code; `POST
/api/auth/second-factor` completes it (5 guesses per code, 10 failures per admin and 25 per
IP per 15 minutes, 5 challenges per admin per hour). Email-code sign-in needs no second step.
In production without an email provider it fails closed (503 `SECOND_FACTOR_UNAVAILABLE`);
`ADMIN_SECOND_FACTOR=off` is the audited emergency escape hatch (see DEPLOYMENT.md).
