# AI Assist

Server-side AI writing help across MusiLynk: job descriptions, screening questions, profile and
portfolio copy, cover letters, post captions, message replies, resume summaries, "improve this
text", and taxonomy autocomplete. Every result is a suggestion the person accepts, edits or
discards — nothing is ever sent on their behalf.

## Launch mode (current)

The owner's call for launch (2026-09-28): AI is too costly right now, both to run and to price
for the person paying, so it stays free-only, small, and capped hard.

- **Enabled tasks**: only `profile_headline`, `profile_bio` (talent onboarding) and
  `job_description`, `job_screening_questions` (hirers) — see `config/ai_pricing.yml`'s `launch:`
  block. `GET /api/ai/status` lists only these; `POST /api/ai/suggest` for any other task in the
  registry (the recruiter tasks, `cover_letter`, `message_reply`, `post_caption`, `improve_text`,
  `resume_summary`, `portfolio_blurb`, `tailor_resume`, `draft_portfolio`,
  `classify_portfolio_item`) answers `403 AI_TASK_DISABLED`. A genuinely unknown task string is
  still `422 UNKNOWN_TASK` — that distinction is what tells "not built" apart from "built, not
  turned on right now".
- **Usage caps, not credits**: talent gets 5 uses **total, ever** across the two talent tasks;
  hirers get 10 uses **per calendar month** across the two hirer tasks. `AiUsageCap`
  (`app/services/ai_usage_cap.rb`) enforces this by counting the account's own `reason: "usage"`
  rows in the existing `ai_credit_ledgers` table (the same rows `AiCredits.charge!` already
  writes) — there is no separate counter, and the person is never shown a "credits" number.
  `GET /api/ai/usage` returns `{ remaining, limit, period }` (`period` is `"lifetime"` or
  `"month"`); going over answers `402 AI_USAGE_LIMIT_REACHED` with the same three fields. The
  legacy monthly credit allowance (`AiCreditAccount`/`AiCredits`, 20/month free) still runs
  underneath and is what a re-enabled task would fall back to, but at 5/10 the launch cap is
  always the tighter limit, so it's what a person actually hits.
- **Budgets**: `hard_monthly_budget_inr` and `free_tier_monthly_budget_inr` are both ₹1,500 (see
  `AiSpendGuard`) — there's no separate paid-AI budget to protect right now, so both raise the
  same `402 AI_FREE_PAUSED` with the copy "AI help is resting this month. Everything else works
  as usual."
- **Billing stays off**: `AI_BILLING_ENABLED` is unset (defaults to off), so `Ai::BillingController`
  answers `503 AI_BILLING_DISABLED` for top-ups and MusiLynk AI Plus, and `GET /api/ai/pricing`
  leaves `aiPlus`/`topups`/`topupExpiresAfterMonths` out of its response entirely
  (`AiPricing.public_catalogue`). The code, routes and tests for billing are untouched — only the
  flag is off.
- **Batch classification is off**: `classify_portfolio_item` isn't in the launch task list, so
  `config/initializers/good_job.rb` leaves the `ai_batch_submit` cron entry out entirely — GoodJob
  never enqueues `AiBatchSubmitJob` on a schedule. The job also no-ops its own submit step if ever
  run directly while disabled (`AiBatchSubmitJob.disabled?`), though it still polls and ingests
  any batch that was already submitted before the task was turned off.
- **Templates instead of AI**: talent gets `src/app/components/ai/BioBuilder.tsx` (headline + bio
  from role/city/years/genres/credits, three tone variants, no network) and hirers get
  `src/app/components/templates/JobPostTemplates.tsx` (six ready-made opportunity templates,
  mounted in `PostJob.tsx`'s first step as "Start from a template"). Neither calls the server.
- **No "credits" in the UI**: the frontend never says "credits". `AiCreditsBadge` (kept under that
  name so pages that already mount it keep compiling) renders "AI help: N of M left" from
  `GET /api/ai/usage`; `AiPaywallDialog` is a plain "used up" / "resting" notice with no purchase
  buttons.

### Re-enabling something later

Every one of the above is a config change, not a code change:

- **A disabled task**: add it to `launch.talent_tasks` or `launch.hirer_tasks` in
  `config/ai_pricing.yml` (or give it its own cap tier if it shouldn't share the talent/hirer
  limit — `AiUsageCap` would need a third group for that).
- **Bigger caps**: change `talent_lifetime_limit` / `hirer_monthly_limit` in the same `launch:`
  block.
- **A bigger monthly budget, or splitting free/paid again**: change
  `free_tier_monthly_budget_inr` / `hard_monthly_budget_inr` — `AiSpendGuard` already checks them
  independently, it's only the launch config that set them equal.
- **AI billing (top-ups, MusiLynk AI Plus)**: set `AI_BILLING_ENABLED=true`. `GET /api/ai/pricing`
  picks the fields back up automatically.
- **Batch classification**: add `classify_portfolio_item` to a launch task list (or its own
  config key, since it isn't really a talent/hirer task) and the cron entry comes back on the
  next deploy.

## How it's wired

- `AiAssist` (`app/services/ai_assist.rb`) calls the Anthropic Messages API
  (`https://api.anthropic.com/v1/messages`) over `Net::HTTP`, with a 5s open / 20s read timeout.
  It never receives a raw prompt from the client — only a `task` key and a structured `context`
  hash, which it resolves against the fixed template in `AiAssist::Tasks`
  (`app/services/ai_assist/tasks.rb`).
- `AiController` (`app/controllers/ai_controller.rb`) exposes it over HTTP, enforces every
  guardrail below, and resolves anything the task needs to fetch itself (a conversation's
  messages, a job's fields) with an access check before AiAssist ever sees it.
- `AutocompleteTaxonomy` (`app/services/autocomplete_taxonomy.rb`) answers `skills` / `genres` /
  `instruments` / `roles` / `cities` autocomplete from `config/search_taxonomy.yml` via
  `Search::Taxonomy`, with no AI involved. AI only fills in when enabled and taxonomy matches are
  thin.

## Tasks (the allow-list)

| Task | Context fields (camelCase from the client) | Notes |
|---|---|---|
| `job_description` | `title*`, `type`, `function`, `city`, `pay`, `keyPoints[]` | 120–250 words. `jobId` optional — access-checked if given. |
| `job_screening_questions` | same as above | 3–5 questions, one per line. |
| `profile_headline` | `roles[]`, `skills[]`, `genres[]`, `city`, `credits[]` | ≤ 12 words. |
| `profile_bio` | same as above | 60–150 words, first person. |
| `portfolio_blurb` | `title*`, `roles[]`, `skills[]`, `genres[]`, `highlights[]` | 40–100 words. |
| `cover_letter` | `jobTitle*`, `company`, `jobDescription`, `headline`, `skills[]`, `resumeSummary` | 100–200 words. `jobId` optional — access-checked if given. |
| `post_caption` | `kind*`, `notes` | 15–60 words. |
| `message_reply` | `conversationId*` | The server fetches the last 5 messages itself; the client never sends message text. Refused (403 `AI_ACCESS_DENIED`) unless the caller belongs to the conversation. |
| `resume_summary` | `roles[]`, `skills[]`, `credits[]`, `yearsExperience`, `highlights[]` | 40–90 words. |
| `improve_text` | `tone*` (`clearer`\|`shorter`\|`friendlier`), `text*` (≤ 2000 chars) | Rewrites, keeps length and language. |

`*` required. Every field is HTML-stripped and length-capped server-side
(`AiAssist::Tasks.validate!`) regardless of what the client sends; a missing required field or an
invalid `tone` is `422 INVALID_CONTEXT`. Every task's system prompt tells the model: Indian music
industry context, match the user's language when evident, never invent facts (use `[placeholder]`
for anything missing), and never include contact details or links unless given.

`GET /api/ai/status` returns `{ enabled, tasks }` with exactly this public list — an internal
`autocomplete` task exists in the registry for the autocomplete endpoint's own use, but it is
never reachable through `/api/ai/suggest` and never listed in `tasks`.

## Endpoints

- **`GET /api/ai/status`** — public. `{ enabled: boolean, tasks: string[] }`. `tasks` is only the
  launch allow-list (`AiPricing.enabled_tasks`) right now. The frontend hides every AI button
  when `enabled` is false, or when its task isn't in `tasks`.
- **`POST /api/ai/suggest`** — auth required (any role). Body `{ task, context }`. Success:
  `{ suggestion, task, model }`. Errors: `503 AI_DISABLED`, `422 UNKNOWN_TASK` /
  `422 INVALID_CONTEXT`, `403 AI_TASK_DISABLED` (a real task, not on the launch allow-list),
  `403 AI_ACCESS_DENIED` (job/conversation the caller can't reach), `429 RATE_LIMITED`,
  `429 AI_BUDGET_EXHAUSTED`, `402 AI_USAGE_LIMIT_REACHED` (the account's own launch cap — body
  carries `{ remaining, limit, period }`), `402 AI_FREE_PAUSED` (the platform-wide monthly
  budget), `502 AI_TIMEOUT` / `AI_UPSTREAM_ERROR` / `AI_MALFORMED_RESPONSE`.
- **`GET /api/ai/usage`** — auth required. `{ remaining, limit, period }` for the caller's own
  launch task group (talent: `period: "lifetime"`; hirer: `period: "month"`). This is the only
  number shown to the person — never a credits balance.
- **`GET /api/ai/autocomplete?field=&q=`** — public; works with no AI configured. `field` is one
  of `skills`, `genres`, `instruments`, `roles`, `cities`. Returns
  `{ field, query, suggestions: [{ value, source }] }`, `source` is `"taxonomy"` or `"ai"`. AI
  suggestions are only added when signed in, AI is enabled, and taxonomy gave fewer than 3
  matches.

## Guardrails

- **Enabled only when** the selected provider's key is present (`OPENAI_API_KEY` for `openai`,
  `ANTHROPIC_API_KEY` for `anthropic`) and `ENV["AI_ASSIST_ENABLED"] != "false"`.
- **Provider and model**: `provider:` in `config/ai_pricing.yml` (default `openai`), overridden by
  `ENV["AI_PROVIDER"]`. Each provider (`AiAssist::Providers::OpenAi` / `::Anthropic`, behind
  `AiAssist::Providers::Base#complete`) has its model and per-1M-token prices under `providers:`;
  `ENV["OPENAI_MODEL"]` / `ENV["AI_MODEL"]` override them. One model everywhere; long tasks only
  get a bigger output cap.
- **Per-user rate limits**: 30/hour and 150/day on `/api/ai/suggest` (`429 RATE_LIMITED`,
  `Retry-After` set).
- **Global daily budget**: `ENV["AI_DAILY_REQUEST_CAP"]` (default 2000) shared across every user,
  counted in `Rails.cache` per UTC day. Over the cap: `429 AI_BUDGET_EXHAUSTED` with a friendly
  message, checked before the per-user limits or any API call.
- **Access checks**: `message_reply` requires the caller to belong to the conversation;
  `job_description` / `job_screening_questions` / `cover_letter` with a `jobId` require the caller
  to own the job, be an admin, or the job to be published. Refused with `403 AI_ACCESS_DENIED`.
- **Input**: every field is HTML-stripped (`Rails::Html::FullSanitizer`) and length-capped before
  it reaches the prompt.
- **Output**: treated as untrusted plain text — HTML-stripped and capped to the task's output
  length before it's returned.
- **Logging**: only `{ event: "ai_assist", task, status, latencyMs, inputTokens, outputTokens }`.
  Never a prompt, never user text, never the API key.

## Frontend

`src/app/lib/ai.ts` is the client: `useAiStatus()` / `useAiTaskEnabled(task)` (cached per session,
so every button on a page shares one `/api/ai/status` fetch), `suggestAi(task, context, signal?)`,
and `autocompleteAi(field, query, signal?)`.

`src/app/components/ai/AiSuggestButton.tsx` wires a task into a form field:

```tsx
import { AiSuggestButton } from '../ai/AiSuggestButton';

<AiSuggestButton
  task="job_description"
  value={description}
  getContext={() => ({ title, type, function: functionArea, city, pay, keyPoints })}
  onAccept={(text) => setDescription(text)}
/>
```

It renders nothing when AI Assist is disabled or doesn't offer that task, shows "Suggest" for an
empty field or "Improve" for a filled one, and opens a popover with Insert / Replace / Try again /
Discard. `getContext()` is called fresh each time the popover opens, so it always reflects the
form's current values — never send more than the task's documented fields.

`src/app/components/ai/AutocompleteInput.tsx` is a combobox for `skills` / `genres` /
`instruments` / `roles` / `cities`, debounced, keyboard-navigable (ARIA combobox pattern), with
removable chips for multi-value fields:

```tsx
import { AutocompleteInput } from '../ai/AutocompleteInput';

<AutocompleteInput field="skills" label="Skills" values={skills} onChange={setSkills} />
<AutocompleteInput field="cities" label="City" values={[city]} onChange={([c]) => setCity(c || '')} multiple={false} />
```
