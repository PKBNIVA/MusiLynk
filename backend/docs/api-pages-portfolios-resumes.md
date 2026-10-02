# Pages, portfolios, resumes: API

For the frontend team. This covers posting jobs as a Page, portfolios, the career record, resumes,
the "review changes" inbox, and what an application sends. All paths start with `/api`. Every
error has the usual shape: `{ "error": "...", "code": "SOME_CODE", "fields": { "field": ["..."] } }`
(`code` and `fields` are optional).

## 1. The model: one source of truth, many views

A person never enters the same thing twice.

| Master copy | Views over it |
| --- | --- |
| **Library**: the person's work samples (`/api/portfolio`, the existing `portfolio_items`). Each has `tags`, `genres`, `roles`, `instruments`, `kind` and `year`. | **Portfolios**: many per person or Page. |
| **Profile**, or the act/organization for a Page: headline, bio, city, genres, rates. | The same fields on every portfolio, **inherited** unless overridden. |
| **Career record**: `/api/career-entries` (experience, credits, education, skills, gear, languages, links, awards). | **Resumes**: many per person. |
| **Profile** headline and bio. | Resume `headline` and `summary`, inherited unless overridden. |

- **Membership is computed on read.** A portfolio shows the library items that match its `rules`,
  plus `pinnedItemIds`, minus `excludedItemIds`. Resumes work the same way over career entries.
  Nothing is copied, so there is no entries table to go stale. A library holds at most a few hundred
  items, so computing on read is cheap.
- **Inheritance.** `headline`, `bio`, `city`, `genres` and `rates` on a portfolio (and `headline`
  and `summary` on a resume) are overrides. `null` means "inherit". Responses return the
  **effective** value, the `overridden` field names, and the `master` values, so the UI can show
  "from your profile" and offer "reset". Edit the profile once and every portfolio that doesn't
  override the field changes with it.
- **Sync and suggestions.** When a work sample or career entry is created or edited, its owner's
  portfolios and resumes are re-evaluated:
  - A rule match joins on its own. Nothing to do.
  - A near miss becomes a pending suggestion in the owner's inbox (see section 7).
  - Words in the item's title or description that it isn't tagged with (a genre, role,
    instrument or tag word) become a "tags" suggestion.
- **Acting as.** Portfolios, suggestions, and job create/update act as the identity in the
  `X-MusiLynk-Act-As` header: `organization:<id>`, `act:<id>` or `user:<id>`. The same value can be
  sent as the `actingAs` param. Without either, the person acts as themselves. A Page is an
  organization where they are owner or admin, or an act they own that isn't hidden. Anything else
  returns `403 ACT_AS_FORBIDDEN`. `GET /api/me/identities` lists the choices. Resumes and career
  entries are always personal.
- A Page's portfolios draw on the library of the person who **owns** the Page.

Signed-in endpoints below accept the `jobseeker` and `employer` roles. Admins get `403`, and
signed-out callers get `401`.

## 2. Rules (portfolios and resumes)

```json
{
  "everything": true,
  "any":     { "genres": ["Jazz", "Blues"], "roles": ["Keyboardist"] },
  "all":     { "tags": ["live", "original"] },
  "only":    { "genres": ["Jazz"] },
  "exclude": { "tags": ["cover"] },
  "yearFrom": 2018,
  "yearTo": 2025,
  "sort": "featured"
}
```

An item is a member when all of these hold:
- its year is within `yearFrom`..`yearTo`;
- none of the `exclude` values is present;
- `only` holds: for each field listed, an item that states values there must have one of them,
  and an item that states none stays in;
- either `everything` is true, or at least one `any`/`all` condition exists, every `any` field
  has a hit, and every `all` value is present.

Other rules:
- Values compare case-insensitively.
- `{}` matches nothing, so only pinned items show.
- Up to 30 values per list, each up to 80 characters.
- Portfolio fields: `roles`, `genres`, `instruments`, `kinds` (the item `type`), `tags`. Portfolio
  `sort` is `featured` (default: featured first, then the library order), `newest` or `manual`
  (`itemOrder` first, then the rest).
- Resume fields: `kinds` (entry kind), `tags`. Resume `sort` is `newest` (default) or `manual`
  (`entryOrder`).
- A new resume defaults to `{ "everything": true, "sort": "newest" }`.

## 3. Jobs posted as a Page

`employer_id` is always the person, so ownership and permissions don't change. The job JSON has
`postedAs`: `{ "type": "organization"|"act", "id", "name" }`, or `null` for a personal post (or
when a hidden Page is shown to someone other than the owner or an admin).

| Endpoint | Notes |
| --- | --- |
| `POST /jobs` | While acting as a Page, the job is posted as it, and `company` defaults to the Page name when blank. The response adds `postedAs`. |
| `PATCH/PUT /employer/jobs/:id` | Optional `postedAs` param: an identity key to re-attach to, or `"user:<your id>"` (or `null`) to post personally. Without it: acting as a Page re-attaches to that Page, and acting as yourself leaves it unchanged. Re-attaching counts as an edit, so a live job goes back to review. `403` for a Page you can't act as. |
| `GET /employer/jobs?postedAs=organization:<id>` | Filters your own jobs. `user:<your id>` returns personal posts. A malformed key returns `400 INVALID_FILTER`. |
| `GET /jobs`, `GET /jobs/:id`, `GET /saved-jobs`, dashboard, admin | Include `postedAs`. |
| `GET /pages/:type/:id/jobs` | Public. `type` is `organization` or `act`. Returns published jobs posted as that Page, newest first (max 100). `404` unless the Page is active. |

```json
GET /api/pages/organization/orga_1/jobs
{ "page": { "type": "organization", "id": "orga_1", "name": "Riya Studios" },
  "jobs": [ { "id": "job_1", "title": "Session keys", "company": "Riya Studios",
              "postedAs": { "type": "organization", "id": "orga_1", "name": "Riya Studios" }, "...": "..." } ] }
```

## 4. Portfolios

Portfolio JSON (`show`, `create`, `update` and the other single-portfolio responses):

```json
{
  "id": "port_…", "ownerType": "user", "ownerId": "user_…", "ownerName": "Riya Keys",
  "title": "Session keys", "purpose": "session",
  "headline": "Keys player", "bio": "…", "city": "Mumbai", "genres": ["Jazz"],
  "rates": { "min": 5000, "max": 5000, "currency": "INR", "basis": "session" },
  "overridden": ["headline"],
  "master": { "headline": "Pianist", "bio": "…", "city": "Mumbai", "genres": ["Jazz"], "rates": { "…": "…" } },
  "rules": { "any": { "genres": ["Jazz"] } },
  "pinnedItemIds": ["port_item…"], "excludedItemIds": [], "itemOrder": [],
  "visibility": "public", "slug": "session-keys-x7k2qa", "isDefault": true, "status": "active",
  "itemCount": 2,
  "items": [ { "itemId": "port_…", "source": "rule", "item": { "id": "port_…", "title": "Blue in green", "type": "audio", "…": "…" } },
             { "itemId": "port_…", "source": "pinned", "item": { "…": "…" } } ],
  "createdAt": "…", "updatedAt": "…"
}
```

Master copy by owner:
- **Person**: profile headline, bio, location (as `city`) and genres. Rates come from the first
  profile rate that is set: session, show, day, tour day, then hourly.
- **Act**: tagline, bio, city, genres, and fee range and basis as `rates`.
- **Organization**: city only.

| Endpoint | Params | Response |
| --- | --- | --- |
| `GET /portfolios` | Acting-as aware. | `{ portfolios: [portfolio without items, plus itemCount and itemIds], limit: 20 }` |
| `POST /portfolios` | `title` (required, max 120); `purpose` (a short tag, stored parameterized, e.g. `film-scoring`); `visibility` (`public`, `link` or `private`; default `public`); `headline`, `bio`, `city`, `genres`, `rates` (overrides, null means inherit); `rules`; `pinnedItemIds`, `excludedItemIds`, `itemOrder` (ids from this owner's library, else `422 INVALID_ITEM`); `isDefault`. | `201 { id, portfolio }`. The owner's first portfolio becomes the default. Returns `422 LIMIT_REACHED` past 20 per owner, and `429` past 30 creates per hour. |
| `POST /portfolios/draft` | `goal` (free text, max 500) and/or `purpose`, optional `title`. | `{ draft }`, not saved (see below). `60` per hour. |
| `GET /portfolios/:id` | | `{ portfolio }`. `404` for anyone else's, including the same person's portfolio when acting as a different identity. |
| `PATCH/PUT /portfolios/:id` | Same fields as create. Sending `null` (or `""`) for an override resets it. | `{ portfolio }` |
| `POST /portfolios/:id/reset` | `fields`: a subset of `headline`, `bio`, `city`, `genres`, `rates`. Omit to reset all. | `{ portfolio }`. Returns `422 INVALID_FIELDS` for other names. |
| `PUT /portfolios/:id/items/:itemId` | `state`: `pinned` (always show), `excluded` (never show) or `auto` (rules decide). | `{ portfolio }`. `404` if the item is not in the owner's library. |
| `POST /portfolios/:id/default` | | `{ portfolio }`. One default per owner. |
| `DELETE /portfolios/:id` | | `{ ok: true }`. If it was the default, the most recently updated remaining portfolio becomes the default. |
| `GET /public/portfolios/:slug` | Public (the EPK page). | `{ portfolio }` with effective fields and `items` (only items whose own visibility is `public`). No rules, ids, status or default flag. `404` when private, hidden by a moderator, or the owner isn't publicly visible (suspended account, or an inactive or hidden act or organization). |

Slugs are the title, parameterized, plus 6 random characters, so `link` portfolios can't be
guessed. A slug doesn't change when the title does.

### Draft by elimination

Draft a portfolio by removing what doesn't fit instead of picking every item.

```json
POST /api/portfolios/draft  { "goal": "Jazz sessions", "title": "Jazz sessions" }
{ "draft": {
  "title": "Jazz sessions", "purpose": null,
  "rules": { "everything": true, "sort": "featured", "only": { "genres": ["Jazz"] } },
  "pinnedItemIds": [], "excludedItemIds": [],
  "terms": { "genres": ["Jazz"] },
  "items": [ { "itemId": "…", "title": "Blue in green", "included": true,  "reason": "Kept: matches Jazz" },
             { "itemId": "…", "title": "Loud night",    "included": false, "reason": "Removed: genres Rock, not Jazz" },
             { "itemId": "…", "title": "Untitled demo", "included": true,  "reason": "Kept: it does not state a genre, so nothing rules it out" } ],
  "summary": { "total": 3, "kept": 2, "removed": 1 },
  "note": null } }
```

How it works:
1. The classifier reads roles, genres and instruments out of the goal, using the taxonomy plus
   the words already used in the library.
2. These become an `only` rule.
3. The client shows the list, lets the person toggle items (they become `pinnedItemIds` or
   `excludedItemIds`), and then `POST /portfolios` with the result.

Because the result is a rule, future items are sorted the same way. When no term is recognised,
everything is kept and `note` says so.

## 5. Career record

Entry JSON: `{ id, kind, fields, startOn, endOn, tags, position, createdAt, updatedAt }`.

| Kind | Fields (* = required) |
| --- | --- |
| `experience` | `role`*, `organization`, `location`, `current` (bool), `description` |
| `credit` | `title`*, `role`, `artist`, `year`, `url` |
| `education` | `institution`*, `qualification`, `field` |
| `skill` | `name`*, `level` (`beginner`, `intermediate`, `advanced` or `expert`) |
| `gear` | `name`*, `notes` |
| `language` | `name`*, `proficiency` (`basic`, `conversational`, `fluent` or `native`) |
| `link` | `label`, `url`* |
| `award` | `title`*, `issuer`, `year`, `url` |

Field rules:
- Text limits are 60 to 2,000 characters.
- `url` must be HTTPS.
- `year` is an integer from 1900 to 2100.
- `startOn` and `endOn` accept `2024`, `2024-06` or `2024-06-15`. They are stored as dates and
  returned as `YYYY-MM-DD`.
- `tags` is up to 20 words.

| Endpoint | Params | Response |
| --- | --- | --- |
| `GET /career-entries` | `?kind=` | `{ entries, kinds: { kind: [field names] }, limit: 300 }` |
| `POST /career-entries` | `kind`, `fields`, `startOn`, `endOn`, `tags`, `position` (default: last in its kind) | `201 { id, entry }`. `120` per hour. `422 LIMIT_REACHED` past 300. |
| `PATCH/PUT /career-entries/:id` | Same, except `kind`, which can't change (`422 KIND_FIXED`). | `{ entry }` |
| `DELETE /career-entries/:id` | | `{ ok: true }`. It leaves every resume. |

## 6. Resumes

```json
{
  "id": "resu_…", "title": "Session CV", "targetRole": "Session keys",
  "headline": "Keys player", "summary": "Profile bio…", "overridden": [],
  "master": { "headline": "Keys player", "summary": "Profile bio…" },
  "rules": { "everything": true, "sort": "newest" },
  "pinnedEntryIds": [], "excludedEntryIds": [], "entryOrder": [], "sectionOrder": ["credit", "experience"],
  "pdf": { "id": "uplo_…", "url": "https://…/cv.pdf", "filename": "cv.pdf", "byteSize": 81234 },
  "isDefault": true, "entryCount": 3,
  "sections": [ { "kind": "credit", "entries": [ { "id": "care_…", "kind": "credit", "fields": { "title": "Album" }, "source": "rule", "…": "…" } ] } ],
  "createdAt": "…", "updatedAt": "…"
}
```

Sections come in `sectionOrder` first, then the default order: experience, credit, award,
education, skill, gear, language, link. Empty sections are left out.

| Endpoint | Params | Response |
| --- | --- | --- |
| `GET /resumes` | | `{ resumes: [resume without sections, plus entryCount], limit: 20 }` |
| `POST /resumes` | `title` (required); `targetRole`; `headline`, `summary` (overrides, null means inherit); `rules`; `pinnedEntryIds`, `excludedEntryIds`, `entryOrder` (your own entry ids, else `422 INVALID_ENTRY`); `sectionOrder`; `uploadId` (your own completed PDF upload); `isDefault`. | `201 { id, resume }`. `422 LIMIT_REACHED` past 20, and `429` past 30 creates per hour. |
| `GET /resumes/:id` | | `{ resume }` |
| `PATCH/PUT /resumes/:id` | Same as create. `uploadId: null` detaches the PDF. | `{ resume }` |
| `POST /resumes/:id/reset` | `fields`: a subset of `headline` and `summary` (all when omitted). | `{ resume }` |
| `PUT /resumes/:id/entries/:entryId` | `state`: `pinned`, `excluded` or `auto`. | `{ resume }` |
| `POST /resumes/:id/default` | | `{ resume }` |
| `DELETE /resumes/:id` | | `{ ok: true }`. The default is handed on. |

For a PDF: upload with the existing `/api/uploads/presign` flow (`application/pdf`), then pass
the upload `id` as `uploadId`. An upload stays in use (it isn't swept) while a resume or a sent
application refers to it.

## 7. Review changes inbox

Suggestion JSON:

```json
{ "id": "show_…", "kind": "include", "status": "pending",
  "reason": "Its title or description mentions jazz",
  "payload": {},
  "target":  { "type": "portfolio", "id": "port_…", "title": "Jazz" },
  "subject": { "type": "portfolio_item", "id": "port_…", "title": "Late set" },
  "createdAt": "…", "resolvedAt": null }
```

- `kind: "include"`: add the subject (a work sample or career entry) to the target portfolio or
  resume. Accepting pins it there.
- `kind: "tags"`: target and subject are the same work sample. `payload` is
  `{ tags?, roles?, genres?, instruments? }`. Accepting adds those values to the item, which may
  then join portfolios by rule. Pending "include" suggestions that the item now meets become
  `obsolete`.
- A near miss is either of these:
  - The item's text mentions a value the rules ask for (for example "jazz" in the description
    when the rule is `any genres: [Jazz]`).
  - It has some but not all of the `all` values ("Has live but not original").
- Suggestions go to the inbox of the identity that owns the target: a Page's portfolio
  suggestions show while acting as that Page. Tag suggestions go to the item's owner.
- There is one suggestion per (target, subject, kind). A rejected one is never raised again.

| Endpoint | Params | Response |
| --- | --- | --- |
| `GET /suggestions` | `status`: `pending` (default), `accepted`, `rejected`, `obsolete` or `all`; `targetId` | `{ suggestions, pending: <count> }` (max 200) |
| `POST /suggestions/:id/accept` | | `{ suggestion, applied }`. `applied: false` (and status `obsolete`) when the target or subject is gone. |
| `POST /suggestions/:id/reject` | | `{ suggestion }` |
| `POST /suggestions/accept-all` | `targetId` (optional) | `{ accepted: [ids], obsolete: [ids] }` |

Classification is pluggable: `PortfolioItemClassifier.implementation = …`. The default is a
keyword match against the taxonomy (`config/search_taxonomy.yml` genres, the catalog's roles and
instruments, a few tag words) and the owner's rule words. It never calls an AI service.

## 8. Applying with a portfolio and resume

`POST /jobs/:id/apply` accepts optional `portfolioId` and `resumeId`:
- The portfolio can be the applicant's own, or one of a Page they can act as. It can't be hidden.
- The resume must be the applicant's own.
- Anything else returns `422 INVALID_PORTFOLIO` or `422 INVALID_RESUME`. A non-scalar value
  returns `400`.

The application stores the ids (set to null if those are deleted later) and a **snapshot** taken
at apply time. The employer's `GET /employer/applications` and the applicant's
`GET /applications` return it as `materials`:

```json
"materials": {
  "capturedAt": "2026-09-28T12:00:00Z",
  "portfolio": { "id": "…", "title": "Jazz", "headline": "Jazz keys", "bio": "…", "city": "…", "genres": [], "rates": null,
                 "slug": "…", "ownerType": "user", "ownerName": "Riya Keys", "itemCount": 1,
                 "items": [ { "itemId": "…", "source": "rule", "item": { "…": "…" } } ] },
  "resume": { "id": "…", "title": "Session CV", "headline": "…", "summary": "…", "entryCount": 1,
              "sections": [ "…" ], "pdf": { "url": "…", "filename": "cv.pdf", "…": "…" }, "uploadId": "…" }
}
```

Later edits to the portfolio, the library, the career record or the resume never change it.
`materials` is `null` when nothing was chosen. The raw `portfolioId` and `resumeId` are also
returned.

## 9. Moderation

- `POST /reports` accepts `entityType: "portfolio"` and `"resume"`. A portfolio is reportable when
  it is public or link-only, or was sent to one of the reporter's jobs. A resume is reportable
  only when it was sent to one of the reporter's jobs. Otherwise the answer is
  `404 ENTITY_NOT_FOUND`.
- Admin: `GET /admin/reports?entityType=portfolio|resume`. The report context names the
  responsible person: the owner, or the owner of the Page that owns the portfolio.
- `POST /admin/reports/:id/moderate { decision: "hide_portfolio" }` sets the portfolio's
  `status: "hidden"`, which removes its public page, and resolves every open report on it. The
  owner still sees it, marked `hidden`, and can't un-hide it.
- Every mutation writes an audit row: `portfolios.*`, `resume.*`, `career_entry.*`,
  `suggestion.*`, `job.create` and `job.update` (with `postedAs`), `application.create` (with
  `portfolioId`/`resumeId`).

## 10. Data migration

| Migration | What it does |
| --- | --- |
| `20260928130000` | `jobs.posted_as_type` and `posted_as_id` (nullable, concurrent index). |
| `20260928130100` | `portfolios`: overrides nullable; `rules`, pins, exclusions and order as jsonb. |
| `20260928130200` | `career_entries` and `resumes`. |
| `20260928130300` | `showcase_suggestions`. |
| `20260928130400` | `applications.portfolio_id` and `resume_id` (FK `ON DELETE SET NULL`), plus `materials_snapshot`. |
| `20260928130500` | Backfill: one default portfolio for each person with a profile or work samples and no portfolio yet. It uses `rules: { everything: true }` with no overrides, so it mirrors today's profile. It is public if the person is listed as talent, otherwise private. Tagged `backfilled: true`. |
| `20260928130600` | Backfill: career entries copied from profile lists: skills, software and instruments as `skill`, credits (a trailing "(2021)" becomes the year), gear and languages. Tagged `backfilled: true`. |

Both backfills:
- only link or copy, and never modify profiles or work samples;
- skip people already done, so re-running is safe;
- are batched;
- roll back by deleting only rows tagged `backfilled: true`.

Deleting a work sample or career entry removes its id from every pin, exclusion and order list,
and deletes its suggestions. Account deletion removes the person's own portfolios, career record,
resumes and suggestions. A Page's portfolios stay with the Page.
