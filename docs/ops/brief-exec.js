export const meta = {
  name: 'verse-brief-exec',
  description: 'Implement one brief from docs/VERSE_PLAN.md §7 in its own worktree, review it adversarially against the brief, fix, and open the PR into claude/launch-2',
  phases: [
    { title: 'Implement', detail: 'one implementer in a worktree' },
    { title: 'Review', detail: 'independent reviewer against the brief and §5 rules; fix rounds' },
  ],
}

const id = args.id            // e.g. 'B1'
const section = args.section  // e.g. '7.2'
const title = args.title
const extra = args.extra || ''
const PLAN = 'docs/VERSE_PLAN.md'
const SESSION = 'https://claude.ai/code/session_01DKVZ7DtE1jj6YgPmVPkvpk'
const REPO = '/home/user/verse-music-platform'
const WT = `/home/user/wt-${id.toLowerCase()}`
const BRANCH = `claude/l2-${id.toLowerCase()}`

const COMMON = `You are implementing brief **${id} — ${title}** (§${section}) of the Verse master plan. Verse: React 18 + Vite + Tailwind 4 frontend in src/app, Rails 8 API in backend/. The plan lives on branch claude/master-plan (and on production once merged): run \`cd ${REPO} && git fetch origin && git show origin/claude/master-plan:${PLAN} > /tmp/VERSE_PLAN.md\` and read /tmp/VERSE_PLAN.md in full — §5 (direction, binding rules), §6 (showcase), §7 mechanics (gates, ownership, commit trailers, PR conventions) and your own §${section}. The brief is the contract: implement every numbered item; do not redesign; where the brief is silent choose the plainer option; if an item is impossible, say so in the PR body with the reason (never silently drop it).
Setup: \`git -C ${REPO} fetch origin production claude/launch-2 && git -C ${REPO} worktree add ${WT} -B ${BRANCH} origin/claude/launch-2\` (if the worktree exists, reuse it and \`git pull --ff-only origin ${BRANCH}\` when it has a remote). Work ONLY in ${WT}; \`ln -s ${REPO}/node_modules ${WT}/node_modules\` if node_modules is missing. Never run git reset --hard, never touch other worktrees, never start/stop Postgres (a cluster is on port 5433 with trust auth: use RAILS_ENV=test DATABASE_URL=postgres://postgres@localhost:5433/verse_${id.toLowerCase()}_test and \`bin/rails db:prepare\` for backend tests). Only edit files your brief *Owns* (§${section}); read anything. Playwright: only under \`flock /tmp/verse-playwright.lock npx playwright test <specs> --project=chromium-desktop\` and only the specs that reference text/selectors you changed; the full mocked suite is not required from you (CI runs it).
Gates before every push (all must pass): npm run typecheck && npm run lint && npm run format:check && npm run build && npm run check:bundle && npm run check:split && npm run test:all && npm run test:unit -- --coverage; backend when touched: bin/rails test (affected files, then the full suite once before the PR), bin/rails zeitwerk:check, bundle exec brakeman --no-pager --exit-on-warn --exit-on-error, api_matrix entries for new routes, and db/schema.rb regenerated the CI way after any migration (drop the test DB, delete db/schema.rb, db:create db:migrate). Commit per numbered item with trailers exactly:
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: ${SESSION}
${extra}`

phase('Implement')
const impl = await agent(`${COMMON}
When every item is done and gates pass: push \`git push -u origin ${BRANCH}\`, then open a PR with the GitHub MCP tool (load it via ToolSearch "select:mcp__github__create_pull_request") from ${BRANCH} into base **claude/launch-2** (never production), title "${id}: ${title}", body = per-item summary (what changed, file paths), any item not done and why, the gate results, and for UI items the fold screenshot paths (1440×900 and 390×844, under ${WT}/.shots/ — commit them nowhere; list paths only); end the body with:
🤖 Generated with [Claude Code](https://claude.com/claude-code)
${SESSION}
Return: the PR URL, the list of items done / not done with reasons, and the exact commands you ran for gates with their results.`, { label: `impl:${id}`, phase: 'Implement', model: 'sonnet', effort: 'high', agentType: 'general-purpose',
  schema: { type: 'object', properties: { prUrl: { type: 'string' }, done: { type: 'array', items: { type: 'string' } }, notDone: { type: 'array', items: { type: 'string' } }, gates: { type: 'string' }, notes: { type: 'string' } }, required: ['prUrl', 'done', 'notDone', 'gates'] } })
if (!impl) return { id, failed: 'implementer returned nothing' }
log(`${id}: PR ${impl.prUrl}; done ${impl.done.length}, not done ${impl.notDone.length}`)

phase('Review')
const VERDICT = { type: 'object', properties: { approve: { type: 'boolean' }, blocking: { type: 'array', items: { type: 'object', properties: { item: { type: 'string' }, problem: { type: 'string' }, file: { type: 'string' } }, required: ['item', 'problem'] } }, nits: { type: 'array', items: { type: 'string' } }, gatesOk: { type: 'boolean' }, summary: { type: 'string' } }, required: ['approve', 'blocking', 'nits', 'gatesOk', 'summary'] }
let rounds = 0, verdict = null
while (rounds < 3) {
  verdict = await agent(`You are an independent, adversarial reviewer of brief **${id} — ${title}** (§${section}) of the Verse master plan. Read the plan: \`cd ${REPO} && git fetch origin && git show origin/claude/master-plan:${PLAN} > /tmp/VERSE_PLAN.md\` (§5 rules and §${section}). The implementation is on branch ${BRANCH} (PR ${impl.prUrl}); the diff is \`git -C ${REPO} fetch origin ${BRANCH} claude/launch-2 && git -C ${REPO} diff origin/claude/launch-2...origin/${BRANCH}\`. Create your own read-only worktree \`git -C ${REPO} worktree add /home/user/wt-rev-${id.toLowerCase()} origin/${BRANCH} --detach\` (reuse if present; \`git checkout --detach origin/${BRANCH}\` to update; symlink node_modules from ${REPO}). Your job is to REFUTE the claim that the brief is fully and correctly implemented: check every numbered item against the diff (not the PR description), run the gates yourself (typecheck, lint, format:check, build, check:bundle, check:split, test:unit --coverage; backend tests for touched files with RAILS_ENV=test DATABASE_URL=postgres://postgres@localhost:5433/verse_rev_${id.toLowerCase()}_test and \`bin/rails db:prepare\`; never start/stop Postgres), look at the fold screenshots the PR lists (Read the PNGs) and judge them against §5 (one primary button, an image/avatar/cover art in the first fold, word budgets, colour = signal), check ownership (files outside the brief's *Owns* list are a blocking problem), check that specs were updated not deleted, and check copy against §5.1.6. Blocking = an item missing/wrong, a gate failing, a §5 rule broken, a file outside ownership, a removed assertion, an obvious regression. Everything else is a nit. Do not edit the branch. Implementer's report: ${JSON.stringify(impl).slice(0, 6000)}`, { label: `review:${id}:${rounds + 1}`, phase: 'Review', effort: 'high', agentType: 'general-purpose', schema: VERDICT })
  if (!verdict) break
  log(`${id} review ${rounds + 1}: approve=${verdict.approve}, blocking=${verdict.blocking.length}, nits=${verdict.nits.length}`)
  if (verdict.approve && verdict.gatesOk) break
  rounds++
  const fix = await agent(`${COMMON}
Your PR ${impl.prUrl} was reviewed. Fix EVERY blocking item below on ${BRANCH} in ${WT} (pull first), re-run the gates, commit with the trailers, push, and update the PR body with a "Review round ${rounds}" section listing what changed. Also apply the nits that are cheap. Blocking: ${JSON.stringify(verdict.blocking)}. Nits: ${JSON.stringify(verdict.nits)}. Reviewer summary: ${verdict.summary}`, { label: `fix:${id}:${rounds}`, phase: 'Review', model: 'sonnet', effort: 'high', agentType: 'general-purpose',
    schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } }, gates: { type: 'string' } }, required: ['fixed', 'notFixed', 'gates'] } })
  if (!fix) break
  log(`${id} fix round ${rounds}: fixed ${fix.fixed.length}, not fixed ${fix.notFixed.length}`)
}
return { id, prUrl: impl.prUrl, done: impl.done, notDone: impl.notDone, reviewRounds: rounds, verdict }
