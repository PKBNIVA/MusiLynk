# WhatsApp urgent alerts: owner setup

This turns on WhatsApp alerts for "need someone by tomorrow" urgent requests, on top of the
in-app and email alerts that always go out. It is entirely optional: nothing breaks, and
email keeps going, if you never do this.

Nobody at Verse needs to see your Meta credentials — set them directly as Railway variables
(see the last section). Never paste an access token into chat, a support ticket or a PR.

## 1. Meta Business setup

1. Go to [business.facebook.com](https://business.facebook.com) and make sure you have a
   Meta Business Account for Verse (create one if you don't).
2. In [developers.facebook.com/apps](https://developers.facebook.com/apps), create an app
   (type: **Business**) and add the **WhatsApp** product to it.
3. Under WhatsApp → API Setup, either use the test number Meta gives you to start, or add
   your own WhatsApp Business phone number (this requires phone number verification with
   Meta). Note the **Phone number ID** shown there — you'll need it below.
4. Under WhatsApp → Configuration, generate a **permanent access token** for a System User
   with the `whatsapp_business_messaging` permission (a temporary token from the quickstart
   page expires in 24 hours and is not enough for production). Copy it somewhere safe for a
   moment — you'll paste it into Railway, never into chat.

## 2. Create the message template

WhatsApp only allows template messages for messages you initiate (this is one — a musician
hasn't messaged you first), and Meta must approve the template before it can be used.

1. Go to WhatsApp Manager → Account tools → Message templates → Create template.
2. Category: **Utility**. Name it something you'll set as `WHATSAPP_TEMPLATE_URGENT` below,
   e.g. `urgent_request_alert`. Language: English.
3. Body text, with exactly three variables in this order (Verse sends them in this order —
   role, city, start time):

   ```
   Urgent: a hirer on Verse needs a {{1}} in {{2}} on {{3}}. Open the Verse app to say you're
   available — first response wins.
   ```

4. Submit for review. Approval is usually within a few hours to a day. Until it's approved,
   leave `WHATSAPP_ENABLED` unset (see below) — sending against a pending/rejected template
   fails and Verse will just log it and keep going with email alerts.

## 3. Railway variables to set

In Railway: your project → the `verse-music-platform` backend service → **Variables** → add:

| Variable | Value |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | The permanent access token from step 1.4 |
| `WHATSAPP_PHONE_NUMBER_ID` | The Phone number ID from step 1.3 |
| `WHATSAPP_TEMPLATE_URGENT` | The template name from step 2.2, e.g. `urgent_request_alert` |
| `WHATSAPP_ENABLED` | `true` — only add this once the template above is **approved** |

All four must be set for WhatsApp alerts to go out at all; if any one is missing, Verse
silently skips WhatsApp and only sends the in-app + email alert (the default, safe state).

## How it behaves

- A musician only ever gets a WhatsApp alert if they added their phone number **and**
  ticked "Get urgent alerts on WhatsApp" in their profile settings. Adding a number without
  ticking the box (or vice versa) sends nothing.
- Alerts are sent one-to-one per musician (`messages` endpoint), never a broadcast list.
- A failed send (rate limit, network hiccup, expired token) is retried automatically a few
  times, then dropped — email has already gone out regardless, so nobody misses the alert
  entirely.
- Verse never logs your access token, and only ever logs the last 4 digits of a phone
  number, never the full number.

## Rotating or revoking the token

If the token is ever compromised, revoke it in Meta's System Users settings and generate a
new one, then update `WHATSAPP_ACCESS_TOKEN` in Railway. No code change is needed.
