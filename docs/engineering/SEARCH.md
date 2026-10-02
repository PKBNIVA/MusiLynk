# MusiLynk search

One public endpoint, `GET /api/search?q=…&type=…`, searches opportunities, professionals,
acts and work samples in PostgreSQL. There is no external search engine; the earlier
Elasticsearch design from the Node prototype was not carried over to Rails.

Source: `backend/app/controllers/search_controller.rb`.
Tests: `backend/test/integration/search_limits_test.rb`, `search_filters_test.rb`,
`search_synonyms_visibility_test.rb`.

## How a query runs

1. **Bound the request.** Each IP gets 60 searches a minute (`throttle!("search", …)`; the
   counters live in the Rails cache, which is Solid Cache on PostgreSQL in production).
   The query is cut to 100 characters.
2. **Expand synonyms.** `SYNONYM_GROUPS` maps layperson terms to trade terms in both
   directions ("sound guy" ↔ "FOH engineer", "keys player" ↔ "keyboardist", "roadie" ↔
   "backline technician"…). At most 12 terms are searched.
3. **Match.** Each result type runs a case-insensitive `ILIKE '%term%'` across its text
   columns (title, company, description and skills for jobs; name, headline, bio, skills and
   roles for talent; name, tagline, bio and genres for acts; title, description, tags, genres
   and roles for public work samples). Each type returns at most 30 rows.
4. **Filter visibility.** Only published jobs, discoverable active talent, active acts and
   public work samples of active, complete profiles are returned. Synthetic QA accounts are
   hidden from real users (badged `demo-*` batches excepted).
5. **Combine fairly.** `type` restricts to one of `jobs`, `talent`, `acts`, `samples`.
   Without it, each type with matches gets an equal share of the 60 result slots before any
   type fills the remainder, so a broad query cannot crowd acts and samples out of "All".

The response includes `interpretedAs` (the expanded terms) and
`provider: "postgresql"`. `GET /api/search/status` reports the provider.
`POST /api/admin/search/reindex` is kept for API compatibility; it only counts searchable
records because there is no separate index.

## Known limits and next steps

- Leading-wildcard `ILIKE` cannot use B-tree indexes, so each query scans the searched
  tables. That is fine at current data volumes; `pg_trgm` GIN indexes or PostgreSQL full-text
  search (`tsvector`) are the next step when search latency grows.
- No relevance ranking beyond per-type ordering (featured/verified first, then recency).
- Synonym groups are hand-written; extend them from real zero-result queries.
