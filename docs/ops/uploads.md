# Uploads: object storage and the public read domain

User uploads (photos, audio, PDFs) live in an S3-compatible bucket (Cloudflare R2 in production).
The browser writes straight to the bucket with a presigned request; the API verifies the object
and hands out its **public URL**, which is what profiles, acts and work samples embed. This page
covers where that public URL points and how to put a Cloudflare edge domain in front of it. Bucket
creation, API tokens and CORS are in `DEPLOYMENT.md`, "Object storage — Cloudflare R2".

## Environment variables (names only)

All on Railway, API service (`musilynk-api`). The worker needs none of these.

| Variable | Required | What it is |
| --- | --- | --- |
| `AWS_BUCKET` | yes, for direct uploads | Bucket name. Unset = uploads stream through the API to disk (development, or `PERSISTENT_UPLOADS=true`). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | yes | The R2 API token (Object Read & Write, scoped to the bucket). |
| `AWS_REGION` | R2: `auto` | AWS keeps `ap-south-1` by default. |
| `AWS_ENDPOINT_URL_S3` | R2: yes | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`. Where the browser uploads and the API reads/deletes. |
| `AWS_PUBLIC_BASE_URL` | R2: yes, unless `UPLOADS_PUBLIC_BASE_URL` is set | The bucket's own public origin: the `https://pub-….r2.dev` URL or the custom domain connected to the bucket. |
| `UPLOADS_PUBLIC_BASE_URL` | optional | **The origin public reads go through.** When set, every public upload URL the API issues starts with it (`<base>/uploads/<user>/<uuid>/<file>`) instead of `AWS_PUBLIC_BASE_URL`. Unset, nothing changes. Must be `https://` in production (otherwise `GET /api/admin/health` reports `insecure_public_base_url`). A trailing slash is ignored. |
| `AWS_UPLOAD_METHOD` | optional | `post` or `put`; defaults to `put` on R2. |

Uploads always go to `AWS_ENDPOINT_URL_S3`; only reads change with `UPLOADS_PUBLIC_BASE_URL`.
Existing rows keep the URL they were issued with, so switching the variable changes new uploads only;
old URLs keep working as long as the old origin still serves the bucket (an r2.dev subdomain or an
older custom domain can stay connected alongside the new one).

The Vercel CSP (`vercel.json`) already allows `img-src`/`media-src … https:`, so any `https://`
read domain works without a CSP change. Nothing storage-related goes into Vercel `VITE_` variables.

## Putting an R2 public domain in front of the bucket (owner steps)

Do this in the Cloudflare dashboard; the API needs only the resulting origin. Nothing here is
done by code or by an agent.

1. **Open the bucket.** Cloudflare dashboard → **R2 Object Storage** → click the uploads bucket
   (`verse-uploads` or whatever `AWS_BUCKET` is set to) → **Settings** tab.
2. **Pick one of the two public-access options under "Public access".**
   - **Custom domain (production).** **Custom Domains** → **Connect Domain** → enter a hostname on a
     zone that is already on Cloudflare, e.g. `media.<your-domain>` → **Continue** → confirm the
     DNS record Cloudflare proposes (it adds a proxied CNAME for you) → wait until the domain's
     status shows **Active**. Traffic to this hostname is served through Cloudflare's edge with
     your zone's cache settings, TLS and WAF.
   - **r2.dev subdomain (trial only).** **Public Development URL** → **Enable** → type `allow` to
     confirm. Cloudflare shows a `https://pub-<id>.r2.dev` origin. It is rate-limited and not
     cached at the edge; use it only until the custom domain is active.
3. **Caching (custom domain only).** Cloudflare dashboard → the zone → **Caching** → **Cache
   Rules** → **Create rule**: *hostname equals* `media.<your-domain>` → **Eligible for cache**,
   Edge TTL *Override origin* **1 month** (uploads are immutable: every object key contains a
   UUID and a deleted object 404s). Optionally **Browser TTL** 1 day.
4. **CORS.** Still in the bucket's **Settings** → **CORS policy**: keep the policy from
   `DEPLOYMENT.md` (the browser uploads with `PUT`/`POST` from the public site). Reads via
   `<img>`/`<audio>`/`<video>` need no CORS entry.
5. **Tell the API.** Railway → project → `musilynk-api` → **Variables** → add
   `UPLOADS_PUBLIC_BASE_URL` = `https://media.<your-domain>` (or the `https://pub-<id>.r2.dev`
   origin during the trial). Leave `AWS_PUBLIC_BASE_URL` as it is. Redeploy.
6. **Verify.** `GET /api/admin/health` → `checks.storage.ok: true` and no `problems`. Then, as a
   musician, upload a photo on `/jobseeker/library`: the saved sample's URL starts with the new
   origin, the image loads, and `curl -sI <that URL>` shows `cf-cache-status` (`MISS` first, then
   `HIT`) and a `cache-control` header. Delete the sample and confirm the URL now 404s.
7. **Roll back.** Remove `UPLOADS_PUBLIC_BASE_URL` and redeploy; new uploads go back to
   `AWS_PUBLIC_BASE_URL`. Already-issued URLs on the custom domain keep working while the domain
   stays connected, so disconnect the domain only after no profile links to it.

## How the code uses these

`backend/app/services/upload_storage.rb`: `read_base_url` is `UPLOADS_PUBLIC_BASE_URL`, then
`AWS_PUBLIC_BASE_URL`; `public_url_for(key)` prefixes it to the object key. With a custom S3
endpoint and neither variable set, direct uploads are refused with `503 STORAGE_MISCONFIGURED`
(`missing_public_base_url`). Tests: `backend/test/integration/upload_storage_test.rb`.
