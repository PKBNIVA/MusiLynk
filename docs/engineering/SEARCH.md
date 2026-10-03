# MusiLynk search

Every typed search runs in PostgreSQL: `GET /api/search?q=…&type=…` (jobs, professionals, acts and
work samples), the list endpoints given `q` (talent, candidates, acts, jobs), and the type-ahead
`GET /api/search/suggest?q=…`. There is no external search engine; at under 100k documents one is
not justified (architecture review, section 2).

Source: `backend/app/services/search/` (`Query`, `Runner`, `Spelling`, `Synonyms`, `Document`,
`Targets`, `Indexer`, `Suggest`, `Settings`), `backend/app/controllers/search_controller.rb`.
Config: `backend/config/search_synonyms.yml` (vocabulary), `backend/config/search.yml` (tuning);
how to change them: `docs/ops/search.md`.
Tests: `backend/test/search/` (relevance suite of 40 queries, runner, latency budget),
`test/services/search_query_test.rb`, `test/integration/search_*_test.rb`,
`tests/e2e/search-typeahead.spec.ts`.

## The search document

Each searchable row carries `search_vector` (tsvector, English stemming) and `search_text` (lower-case
plain text), maintained by the model in the same transaction (`SearchIndexed`) and backfilled by
`SearchIndexBackfillJob`. Fields by weight (`Search::Targets`):

| Weight | Talent (profiles)                                        | Acts                                         | Jobs                                          | Work samples                                  |
| ------ | -------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- | --------------------------------------------- |
| A      | name, headline                                           | name, act type                               | title                                         | title                                         |
| B      | roles, skills, instruments, genres                       | genres, events, lineup roles and instruments | skills, function, kind, genre                 | tags, roles, genres, instruments, credited as |
| C      | bio, credits, gear, software, events, open to, languages | tagline, bio, languages                      | description, requirements, company, languages | description                                   |
| D      | location                                                 | city                                         | location                                      | (the owner's profile location)                |

`search_vector` has a GIN index; `search_text` (A, B and D only) a trigram GIN index.

## How a query runs

1. **Bound the request.** 60 searches a minute per IP (120 type-ahead lookups); the query is cut to
   100 characters; every statement has a 3 s limit and a cancelled one returns an empty result.
2. **Parse** (`Search::Query`): lower-case, NFKC, punctuation stripped, stop words dropped (English
   and Hinglish: "ke", "liye"…), plural folded, and the longest vocabulary phrase read first, so
   "shaadi band" is one token (wedding band, band baja…). A city ("Bombay") constrains the location.
3. **Match.** Each token is one `to_tsquery` on `search_vector`: alternatives OR-ed, phrases as
   consecutive words, vocabulary and words under five letters whole ("dhol" never finds "dholak"),
   longer unknown words also as prefixes, a city on weight D only. Alternatives in another script
   (गायक) match `search_text` by substring. Tokens are AND-ed.
4. **Rank.** Per token: title A 1100, B 1060, elsewhere 1030, city 1050; +10 when the word itself
   (not only a synonym) is there; +20 × trigram similarity of the query to the title. Ties fall back
   to the list's usual order (verified first, …, unique id), so results are deterministic. The
   costly part of that order is computed only for the rows that can reach the page (`FETCH FIRST n
ROWS WITH TIES` on the score), and the match count comes from the same pass.
5. **Typo tolerance**, only when fewer than 3 rows match: a word that matches too few rows also
   searches its nearest vocabulary term (pg_trgm similarity, fewest edits: "guitarst" → guitarist,
   `didYouMean`) or, failing that, documents by trigram word similarity (names: "desaai"). Rows that
   match what was typed stay first. `matchMode` is `corrected` when nothing matched as typed.
6. **Partial**: a multi-word query that still matches nothing returns rows matching some words.
7. **Combine** ("All"): up to 30 per type, fair-shared into 60 results.

Browsing with no query counts exactly up to 1,000 rows and estimates past that (planner estimate).

## Type-ahead

`GET /api/search/suggest?q=` returns up to 10 `{kind, label, query?, detail?, url?}`: roles,
instruments, genres, events, act types and cities whose label or any spelling starts with the text
(from the vocabulary and the catalog), then people and acts with a word starting with it. Cached
for 60 s (shared cache and browser). The search page box and the header quick search use it
(`SearchSuggestInput`: 150 ms debounce, arrow keys, Enter, Escape).
