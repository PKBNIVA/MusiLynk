# Web push notifications

Browser push alerts for urgent requests (a matching request for musicians, a response for hirers),
new messages and booking confirmed or cancelled. Marketing is never sent by push. The feature is
**off and hidden** until all three variables below are set.

## Environment variables (names only)

| Variable | Where | What it is |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Railway, web service **and** worker service | The public half of the key pair. Also served to browsers by `GET /api/push/config`. |
| `VAPID_PRIVATE_KEY` | Railway, web service **and** worker service | The private half. Server only; never sent to a browser, never committed. |
| `VAPID_SUBJECT` | Railway, web service **and** worker service | `mailto:` plus the support address, for example `mailto:support@<your domain>`. Push services use it to contact us about abuse. |

The worker needs them because it sends the pushes (`PushDeliveryJob`); the web service needs the
public key for the config endpoint and the check that decides whether to queue anything.

If any one of the three is missing, `GET /api/push/config` returns `{ "enabled": false }`, the web
app shows no push prompt or settings section, and nothing is queued.

## Generating the keys

The owner runs this once, on their own machine (the private key should never pass through chat,
tickets or commits):

```
npx web-push generate-vapid-keys
```

It prints a public and a private key. Paste each into the matching Railway variable on both
services, then redeploy. Keep the same pair for the life of the product: changing it makes every
existing browser subscription stop working until people turn alerts on again.

## Related existing variables

Subscription endpoints and keys are encrypted at rest with the same Active Record encryption keys
as sign-in tokens (`ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY`, `ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY`,
`ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT`). No extra setup.

## How it behaves

- Browsers subscribe through `POST /api/push/subscriptions` (signed in, rate limited); only
  addresses on the browser makers' push services (Google, Mozilla, Apple, Microsoft) are accepted.
- Preferences are per person, in Account settings, Push notifications: urgent requests (on by
  default once subscribed), new messages and bookings (off by default).
- Sending runs in a background job. A device the push service reports gone (404 or 410) is deleted
  at once; other failures back off (2, 4, 8 ... minutes) and the device is dropped after 8 in a row.
- The service worker is `public/sw.js`, served from the site root with `Service-Worker-Allowed: /`
  and no caching (see `vercel.json`).
- iPhone and iPad only support web push for a site added to the home screen; the app tells people so.
