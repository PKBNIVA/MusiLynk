# Search: vocabulary, tuning and the search index

Every typed search (global search, type-ahead, talent, candidates, acts, jobs) runs in PostgreSQL
on a per-row **search document**: `search_vector` (weighted full-text, GIN index) and `search_text`
(plain text, trigram GIN index) on `profiles`, `acts`, `jobs` and `portfolio_items`. How it works:
`docs/engineering/SEARCH.md`. No environment variables; nothing to set up on Railway or Vercel.

## Changing the vocabulary (synonyms, spellings, cities)

File: `backend/config/search_synonyms.yml`. The header of the file explains each section.

1. Add the spelling to the right group, or add a new group. The **first** entry of a group is the
   label the type-ahead shows, so keep its capitals ("Dhol player", "DJ").
2. Never put two different things in one group just because one name starts with the other: dhol
   and dholak, sitar and sitarist are matched as whole words and must stay apart.
3. A term that should find more than itself but not the other way round ("wedding" also finds
   sangeet and mehendi) goes under `broader:`.
4. Run `bin/rails test test/search test/services/search_query_test.rb`. If the relevance suite
   (`test/search/relevance_test.rb`) fails, read the table it prints: change the expectation only if
   the new top three are better, and say why in the commit.
5. Merge to `production`. The file is read once per process, so the change is live after the deploy;
   documents do not need rebuilding (synonyms are expanded at query time).

## Changing the tuning

File: `backend/config/search.yml` (count cap, when typo tolerance starts, similarity thresholds,
which unknown words match as prefixes, the per-statement time limit, and the type-ahead's rate
limit, cache time and how many of each kind it shows). Same steps as above from step 4.

## The search index

- **New and edited rows** are indexed by the models in the same transaction (`SearchIndexed`;
  `Search::Indexer`). A renamed person or a changed act lineup re-indexes the profile or the act.
- **Rows written without model callbacks** (`insert_all`, `update_columns`) are not. The nightly
  `search_index_sweep` (GoodJob cron, 02:21 UTC) fills rows that have no document; code that
  bulk-updates searched columns must call `Search::Indexer.refresh(name, ids)` itself.
- **Full rebuild**: `POST /api/admin/search/reindex` (admin) queues `SearchIndexBackfillJob`, which
  rebuilds every document in batches of 1,000 rows. It is safe to run at any time and twice. The
  migration that added the columns queued one run after deploy. From a console:
  `SearchIndexBackfillJob.perform_now` (about 50 s for 111k rows on the 4-vCPU test bed).
- Until the first run finishes after the deploy, typed searches miss rows that have no document yet.
- **Do not rebuild the sitemap while a backfill is running** (no `sitemap:warm` mid-run). Hire
  pages (`/hire/<role>/<city>`) enter the sitemap by counting profiles on the search documents, so a
  sitemap built mid-backfill leaves pages out. When the job finishes it queues `SitemapRefreshJob`,
  which rebuilds the sitemap from complete documents; the last good copy is served meanwhile.

## Rollback

`bin/rails db:rollback STEP=2` drops the two columns and their four indexes per table (no data is
lost: documents are derived from the other columns). Roll the code back first or together with it,
because the search code needs the columns.
