# The Stage: community feed API

Base path: `/api/stage`. All endpoints require a signed-in person (`Authorization: Bearer
<token>`) unless marked **Public**. Mutating endpoints support acting as a Page you run
(an organization or an act you own/admin) via the `X-Verse-Act-As` header, e.g.
`X-Verse-Act-As: organization:org_123` or `X-Verse-Act-As: act:act_123`. Without the header
you act as yourself. See `backend/app/services/actor_resolver.rb`.

An `author` object always has the shape:

```json
{ "type": "user" | "organization" | "act", "id": "user_...", "name": "Jane Doe", "avatar": null, "verified": false }
```

`created_by_user_id` (the real person who wrote the post/comment, even when posted as a
Page) is not exposed in the API; it exists for audit and moderation only.

## GET /api/stage/feed

Cursor-paginated, ranked feed: posts from people and Pages you follow (plus your own),
blended with posts matching your city/genres, then trending posts (applause + comments in
the last 72h, time-decayed). Excludes blocked users (both ways), hidden/deleted posts, and
followers-only posts you cannot see.

Query params: `cursor` (optional, opaque string from a previous response).

```json
// GET /api/stage/feed
{
  "posts": [
    {
      "id": "post_abc123",
      "author": { "type": "user", "id": "user_1", "name": "Jane Doe", "avatar": null, "verified": true },
      "kind": "update",
      "body": "Wrapped a great session today! #jazz #mumbai",
      "media": [{ "uploadId": "upld_1", "type": "audio", "caption": "Final mix" }],
      "linkUrl": null,
      "city": "Mumbai",
      "genres": ["Jazz"],
      "hashtags": ["jazz", "mumbai"],
      "visibility": "public",
      "status": "active",
      "sharedEntity": null,
      "applauseCount": 4,
      "commentCount": 1,
      "reshareCount": 0,
      "applauded": false,
      "createdAt": "2026-09-28T10:00:00Z",
      "updatedAt": "2026-09-28T10:00:00Z"
    }
  ],
  "nextCursor": "eyJzIjoxMDAwMDAwLjAsInQiOjE3ODczOTg0MDAuMCwiaSI6InBvc3RfYWJjMTIzIn0="
}
```

## POST /api/stage/posts

Creates a post, as yourself or as the Page named in `X-Verse-Act-As`. Rate limit: 20/hour
per person.

Body:

| field | notes |
|---|---|
| `kind` | one of `update`, `performance`, `release`, `gig`, `looking_for`, `job_share`, `portfolio_share` (default `update`) |
| `body` | up to 3000 characters; required unless a shared item or `resharedPostId` is set |
| `media` | up to 10 items, each `{ uploadId, type: "image"\|"audio"\|"video", caption }` |
| `linkUrl` | optional safe `http(s)` URL |
| `city`, `genres` | optional, used for feed ranking |
| `visibility` | `public` (default) or `followers` |
| `sharedPortfolioItemId` | for `kind: "portfolio_share"`; must be one of your own portfolio items |
| `sharedJobId` | for `kind: "job_share"`; the job must be open (published or pending) |
| `resharedPostId` | reshares an existing post, with `body` as your optional added comment |

```json
// POST /api/stage/posts { "body": "Excited to share our new single!", "kind": "release" }
// 201
{ "id": "post_abc123", "post": { "...": "see feed item shape above" } }
```

Errors: `422 VALIDATION_FAILED` (body too long, bad media, unowned portfolio item, closed
job, etc.), `429 RATE_LIMITED`, `403 ACT_AS_FORBIDDEN` (acting as a Page you don't run),
`403 BLOCKED` (resharing someone who has blocked you / you have blocked).

## GET /api/stage/posts/:id — Public

Returns one active, visible post (404 if hidden, deleted, not found, or a followers-only
post you cannot see).

```json
{ "post": { "...": "feed item shape" } }
```

## PATCH /api/stage/posts/:id

Updates your own post's `body`, `linkUrl`, `city`, `genres` or `visibility`. 403
`NOT_OWNER` if it isn't yours (or the Page you're acting as).

## DELETE /api/stage/posts/:id

Soft-deletes your own post (`status` becomes `deleted`; it stops appearing anywhere).
`{ "ok": true }`.

## GET /api/stage/authors/:type/:authorId/posts — Public

Posts by one identity (`type` is `user`, `organization` or `act`), newest first,
cursor-paginated the same way as the feed.

```json
{ "posts": [ "..." ], "nextCursor": null }
```

## POST /api/stage/posts/:id/applause

Adds "Applause" from you (or the Page you're acting as). Idempotent per actor per post.
Rate limit: 300/hour. `403 BLOCKED` if you and the post's author have blocked each other.

```json
// 201
{ "ok": true, "applauseCount": 5 }
```

## DELETE /api/stage/posts/:id/applause

Removes your applause, if any. `{ "ok": true, "applauseCount": 4 }`.

## GET /api/stage/posts/:id/comments — Public

```json
{
  "comments": [
    {
      "id": "post_1", "postId": "post_abc123",
      "author": { "type": "user", "id": "user_2", "name": "Sam Rao" },
      "body": "Loved this!", "status": "active", "parentId": null,
      "createdAt": "2026-09-28T10:05:00Z", "updatedAt": "2026-09-28T10:05:00Z"
    }
  ]
}
```

## POST /api/stage/posts/:id/comments

Body: `{ "body": "...", "parentId": "post_1" }` (`parentId` optional; only one level of
replies is allowed — replying to a reply is rejected). Rate limit: 60/hour. `403 BLOCKED`
if you and the post's author have blocked each other.

```json
// 201
{ "id": "post_2", "comment": { "...": "comment shape above" } }
```

## DELETE /api/stage/comments/:id

Deletes your own comment, or any comment on a post you authored (soft delete). `403
NOT_OWNER` otherwise. `{ "ok": true }`.

## POST /api/stage/follows

Follows a person, organization or act. Body: `{ "followableType": "user"|"organization"|"act", "followableId": "..." }`.
`422 INVALID_FOLLOWABLE` for an unknown type or yourself; `403 BLOCKED` for a person who
has blocked you or vice versa.

```json
// 201
{ "ok": true, "following": true }
```

## DELETE /api/stage/follows/:type/:id

Unfollows. Always `{ "ok": true, "following": false }`, whether or not you were following.

## GET /api/stage/authors/:type/:id/followers — Public

```json
{ "followersCount": 128, "following": true }
```

`following` reflects the signed-in viewer (`false` when signed out).

## GET /api/stage/authors/user/:id/following — Public

Only defined for `type: "user"` (a Page cannot follow anyone).

```json
{ "followingCount": 42 }
```

## GET /api/stage/tags/:tag — Public

Hashtag search (case-insensitive, `#` prefix optional in the path).

```json
// GET /api/stage/tags/jazz
{ "tag": "jazz", "posts": [ "..." ], "nextCursor": null }
```

## Moderation

`post` and `comment` are reportable via the existing `POST /api/reports`
(`entityType: "post"|"comment"`). Admins resolve them via the existing
`POST /api/admin/reports/:id/moderate` with `decision: "hide_post"` or `"hide_comment"`,
which sets the post's or comment's `status` to `hidden` (soft removal) and auto-resolves
any other open report on the same entity, exactly like `hide_act`/`hide_review`.

## Notifications

Delivered through the existing in-app `Notification` model (`GET /api/notifications`):

- `stage_applause` — someone applauded your post; coalesced to one unread notification per
  post, refreshed as more applause arrives (like new-message notifications).
- `stage_comment` — someone commented on your post; coalesced the same way.
- `stage_follower` — someone started following you.

## Rate limits

| action | limit |
|---|---|
| creating a post | 20/hour per person |
| creating a comment | 60/hour per person |
| applause | 300/hour per person |

Exceeding a limit returns `429` with `{ "error": "...", "code": "RATE_LIMITED" }` and a
`Retry-After` header.
