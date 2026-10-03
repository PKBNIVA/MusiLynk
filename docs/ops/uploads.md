# Uploads: object storage and the public read domain

User uploads (photos, audio, PDFs) live in an S3-compatible bucket (Cloudflare R2 in production).
The browser writes straight to the bucket with a presigned request; the API verifies the object
and hands out its **public URL**, which is what profiles, acts and work samples embed. This page
covers where that public URL points and how to put a Cloudflare edge domain in front of it. Bucket
creation, API tokens and CORS are in `DEPLOYMENT.md`, "Object storage — Cloudflare R2".

## Environment variables (names only)

All on Railway, API service (`musilynk-api`) **and** the worker service (`musilynk-worker`), which runs `ImageVariantsJob` against the bucket (see "Image variants").

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

## Image variants

Every finished image upload (JPEG, PNG, WebP; profile photos, act covers, image work samples, Stage
photos) gets resized copies made in the background, so a phone showing a 56 px avatar no longer
downloads the 512 px (or 5 MB) original:

- **When.** `POST /api/uploads/:id/complete` enqueues `ImageVariantsJob` (queue `default`, the
  worker service). The job downloads the original from the bucket, rotates it by its EXIF orientation,
  strips the metadata and writes `<key>/v/<width>.webp` (and `<key>/v/<width>.avif` when the libvips
  build can encode AV1, which the Dockerfile's `libvips42` can) for each width in
  `backend/config/images.yml` that does not upscale the original, with
  `Cache-Control: public, max-age=31536000, immutable` and the right `Content-Type`. The widths and
  qualities produced are recorded in `uploads.variants` (jsonb). A failure retries three times, then
  the row keeps empty variants and the original is served alone; Sentry gets the error.
- **Originals.** The presign now signs the same `Cache-Control` (a header on the R2 `PUT`, a policy
  field on the S3 `POST`), so new originals are stored immutable-cacheable too. Objects uploaded
  before this keep whatever headers they had; the Cloudflare cache rule in step 3 above covers them.
- **Payloads.** Wherever an upload is exposed, the old string field stays and an `ImageSet` is added
  beside it: `photo` next to `photoUrl` (profiles) and `photo_url` (acts), `image`/`thumbnail` on work
  samples, `image` on Stage post media and on the upload record. Shape:
  `{ src, srcset: { avif: ["<url> 320w", ...], webp: [...] }, width, height }`; `null` until the job
  has run. The front end (`src/app/components/media/UploadImage.tsx`) renders a `<picture>` with
  `sizes` per placement and width/height set, lazy below the fold.
- **Deletion.** `Upload#purge!` and the daily `UploadSweepJob` delete the variants with the original;
  the bucket sweep treats `<key>/v/...` objects as belonging to `<key>`.
- **Backfill (existing uploads).** `cd backend && bin/rails images:backfill` enqueues the job for
  every finished bucket image without variants, 500 ids per batch (`BATCH=n`), and prints progress;
  it is idempotent (a second run queues nothing new). `FORCE=1` redoes uploads that already have
  variants (after changing the widths or qualities); `LIMIT=n` stops after n uploads for a trial run.
  Run it from a Railway shell on the API service after the deploy that adds the column; the worker
  does the work at its own pace. It has not been run against production by an agent: the owner runs
  it (expect roughly 1 to 3 s per upload on the worker).
- **Changing the widths or qualities.** Edit `backend/config/images.yml`, deploy, then
  `bin/rails images:backfill FORCE=1`. Variants under widths you removed stay in the bucket until the
  upload is purged (they are harmless; nothing links to them).
- **Local development.** Disk-stored uploads (no `AWS_BUCKET`) get no variants: the pipeline is
  bucket-only. `libvips` is needed where the worker runs (`apt-get install libvips42` on Debian,
  `libvips42t64` on Ubuntu 24.04); the `ruby-vips` gem binds it at runtime through FFI.

No new environment variable: the feature is on wherever direct uploads are on, and off with them.

## How the code uses these

`backend/app/services/upload_storage.rb`: `read_base_url` is `UPLOADS_PUBLIC_BASE_URL`, then
`AWS_PUBLIC_BASE_URL`; `public_url_for(key)` prefixes it to the object key. With a custom S3
endpoint and neither variable set, direct uploads are refused with `503 STORAGE_MISCONFIGURED`
(`missing_public_base_url`). Tests: `backend/test/integration/upload_storage_test.rb`.
