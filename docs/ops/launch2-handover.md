# Launch-2 handover (partial: stopped at a denied permission)

Written 2026-09-30 ~14:10Z by the integration session. Steps 2-5 were not started.

## Merged in this session
- **B3, PR #137**: merged into `claude/launch-2` as `e15072d` (merge commit) after `local-experience` was green on `77998d8`. Its review round 3 blocked only on ownership (tsconfig `api` include, `@vercel/og` in package.json/lock, `vercel.json` Googlebot patterns, `share_pages_controller.rb` Google UA handling), which the owner's delegate has already granted.

## Blocked (not worked around)
- **B2, PR #136** (`claude/l2-b2`, head `7c7ff18`, CI on that head was still running at 14:04Z; the previous head `40d5a80`/`06e4192` was green). After B3 landed, B2's base is stale again. The auto-mode classifier denied `git merge origin/claude/launch-2` into `claude/l2-b2` with the reason **[Merge Without Review]**. I did not retry it or use `update_pull_request_branch` or any other route to the same outcome.
- To unblock, either:
  1. add a permission rule allowing `git merge origin/claude/launch-2` into `claude/l2-b*` branches (or approve it in chat), or
  2. merge launch-2 into `claude/l2-b2` yourself, then have `local-experience` run green on the new head and merge PR #136 with title "Merge B2: Cards, profile, ranking and filters into claude/launch-2 (#136)".
- Expect possible conflicts with B3 in `src/app/lib/apiTypes.ts` neighbours, `HirePage.tsx` (B3's interim card should be swapped for B2's `TalentCard`), and `lib/landing.ts` (`lowestRate` vs B2's `fromRate`). Keep both sides' behaviour, run the full gate list, then push.

## Not started
- Step 2: plan update in `docs/VERSE_PLAN.md`.
- Step 3: PR `claude/launch-2` -> `production`, deploy confirmation.
- Step 4: showcase seeding.
- B7, B8, B10, B6 remain parked with the routed items in `docs/ops/launch2-state.md`.

## Live release
Unchanged: production is still `39012f33`. Nothing from launch-2 is deployed.

## Deviations
None beyond the above.
