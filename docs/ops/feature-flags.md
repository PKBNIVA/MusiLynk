# Feature flags

Flags are decided on the server (`backend/config/features.yml`, read by `Features` through
`Settings`) and only read by the client. One file, one env override, two endpoints.

## The file

```yaml
flags:
  stage:
    enabled: true      # master switch; false = off for everyone
    percentage: 100    # 0..100 of signed-in users, stable per user id
    allowlist: []      # user ids or emails that always get it while enabled
```

- **enabled** off means off, whatever the rest says.
- **percentage** buckets a signed-in person by `SHA256("<flag>:<user id>") % 100`, so the same
  person always gets the same answer across visits, devices and deploys. Anonymous visitors only
  see a flag as on when the percentage is 100 (there is no id to bucket).
- **allowlist** admits by user id or email (case-insensitive) while the flag is enabled, whatever
  the percentage. Use it for the owner and testers before a rollout.

Adding a flag: add it to the file (lower_snake_case name), add the name to `FeatureName` in
`src/app/lib/features.ts` and, if the first paint must honour it before the server answers, a
`VITE_FEATURE_<NAME>` build-time default there. Validation at boot rejects a bad shape
(`test/services/settings_test.rb`).

## Where the client reads them

- `GET /api/me` (and every sign-in answer) carries `features: { stage: true, resumes: false }`
  resolved for that person; `authContext.tsx` hands them to `setUserFeatures`.
- `GET /api/public/config` carries the anonymous resolution; `publicConfig.ts` hands them to
  `setServerFeatures`.
- Components call `useFeature('stage')` (re-renders when an answer lands) or `featureEnabled()`.
  Order: the person's own flags, then the anonymous server answer, then the build-time
  `VITE_FEATURE_*` default (first paint only). `src/app/routes.tsx` still registers routes from
  the build-time constants (module scope); the server value hides the links and buttons.

## Kill switch (no deploy)

Set the env variable on the API service (Railway, `musilynk-api` and `musilynk-worker`):

```
FEATURE_STAGE=false     # off for everyone, allowlist included; true/1/on = on for everyone
```

`FEATURE_<NAME>` is read per request, so a restart of the service is all it takes; the edge copy
of `/api/public/config` refreshes within five minutes (s-maxage 300), signed-in people see it on
their next `/me`. Any value other than true/1/on/false/0/off is ignored. Every `FEATURE_*`
variable is optional; unset means "as the file says". Remove the variable once the file is edited.

## Rolling out

1. `enabled: true`, `percentage: 0`, your own id in `allowlist`: test it yourself in production.
2. Raise `percentage` in steps (10, 50, 100); the bucket is stable, so nobody flips back.
3. At 100, anonymous visitors see it too. Remove the allowlist.

Tests: `backend/test/services/features_test.rb` (stability, distribution, allowlist, env),
`backend/test/integration/public_config_test.rb` (both endpoints), `src/app/lib/__tests__/features.test.tsx`.
