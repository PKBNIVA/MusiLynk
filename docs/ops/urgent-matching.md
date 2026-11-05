# Urgent matching: who is alerted, and how the ranking is tuned

"Need someone by tomorrow" ranks musicians for each urgent request and alerts the best few.
No environment variables; nothing to set up on Railway or Vercel.

## Changing the numbers

File: `backend/config/urgent.yml`, section `matcher` (read through `UrgentConfig`):

| Key | Meaning |
| --- | --- |
| `candidate_limit` | How many ranked candidates a request keeps (default 30). |
| `notify_count` | How many of them are alerted automatically (default 15). |
| `recent_activity_within_days` | A sign-in within this window counts as "recently active". |
| `default_duration_hours` | How long a request with no end time is taken to last, when it is compared with availability windows. |
| `weights` | Points per signal: `role`, `instrument`, `city`, `verified`, `recent_activity`, `available`. A candidate's score is the sum. |

Steps: edit the file, run `bin/rails test test/services/urgent_matcher_test.rb test/services/urgent_matcher_parity_test.rb`,
merge to `production`. The file is read once per process, so the change is live after the deploy.

## How the ranking works

`UrgentMatcher#ranked_candidates` runs one SQL statement (`UrgentMatcher::Query`) that selects the
discoverable musicians (active, profile complete, not the requester, in the request's city when it
has one), drops anyone whose unavailable/booked/hold window overlaps the request, matches roles,
instruments and headlines by whole words through the search vocabulary (`config/search_synonyms.yml`,
the same rule as `UrgentMatcher.role_tokens`), scores them with the weights above and returns the top
`candidate_limit`. Ties are broken by most recent sign-in, then id. Ruby then loads those users and
words the reasons ("Plays Drummer", "In Mumbai", "Verified", ...; the first three are shown). A request
costs three queries whether the city has 30 musicians or 30,000.

If you change how a role is compared in Ruby (`role_tokens`, `FILLER_WORDS`), change the SQL in
`app/services/urgent_matcher/query.rb` with it; `test/services/urgent_matcher_parity_test.rb` compares
the SQL ranking with the previous Ruby ranking (`test/support/urgent_matcher_legacy.rb`, test-only) on a
seeded sample and fails if they drift. Delete the Legacy class and the parity test once the SQL ranking
has run in production for a while.
