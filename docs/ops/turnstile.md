# Cloudflare Turnstile (human check on sign-up and sign-in codes)

A Cloudflare Turnstile challenge sits on the two forms a bot would hammer first: creating an
account (`POST /api/auth/register`, the /join flow) and asking for an emailed sign-in code
(`POST /api/auth/otp/request`, the sign-in page and the code option on /join). It is **off and
invisible** until the variables below are set; each side alone being unset is a clean no-op.

## Environment variables (names only)

| Variable | Where | What it is |
| --- | --- | --- |
| `TURNSTILE_SECRET_KEY` | Railway, `musilynk-api` service | The widget's **secret key**. Server only, never sent to a browser, never committed. With it set the API verifies every sign-up and code request against Cloudflare. |
| `VITE_TURNSTILE_SITE_KEY` | Vercel, `musilynk` project (public site only; the admin site has neither form) | The widget's **site key**. Baked into the public bundle at build time (it is public by design); with it set the two forms load the widget lazily and send its token as `turnstileToken`. |

Both values come from the Cloudflare dashboard: **Turnstile → Add widget** (hostname
`musilynk.vercel.app` plus any custom domain; widget mode *Managed*). The widget's page shows the
*Site Key* and *Secret Key* fields. Paste each into the matching variable, redeploy the API, then
redeploy the public site (Vite reads the site key at build time, so a new build is needed).

Roll out in this order: API first (with only the secret set, every request lacks a token and would
be refused), so set **both** before the next public build goes live, or set the site key first and
the secret second: a token sent to an API that is not checking is simply ignored.

## Kill switch and fail mode

`backend/config/rate_limits.yml`, section `turnstile`:

- `enabled: false` turns the server check off without touching Railway variables.
- `on_verifier_error` says what happens when Cloudflare's verify endpoint itself errors or times
  out: `closed` (default) answers `503 TURNSTILE_UNAVAILABLE` and the form says to try again in a
  minute; `open` lets the request through and logs `turnstile_verifier_error`.
- `timeout_seconds` and `verify_url` are the call to Cloudflare.

A missing or rejected token answers `403 TURNSTILE_FAILED` and nothing is created or sent. Failed
challenges count towards the 429 spike alert under `turnstile-register` / `turnstile-otp-request`.

## Content Security Policy

`vercel.json` allows `https://challenges.cloudflare.com` in `script-src` (the widget script) and
`frame-src` (the challenge iframe) and nothing else from Cloudflare;
`scripts/__tests__/vercel-config.test.mjs` pins this.

## Where the code is

- API: `backend/app/services/turnstile.rb` (verifier), `AuthController#turnstile_passed?`.
- Web: `src/app/lib/turnstile.ts` (lazy script loader, site key), `src/app/components/auth/TurnstileWidget.tsx`,
  used by `src/app/pages/AuthPage.tsx` and `src/app/components/join/AccountStep.tsx`.
- Tests: `backend/test/integration/turnstile_test.rb` (stubbed verifier), `src/app/lib/__tests__/turnstile.test.ts`,
  `src/app/components/__tests__/TurnstileWidget.test.tsx`.
