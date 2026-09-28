# AI Assist

Server-side AI writing help across Verse: job descriptions, screening questions, profile and
portfolio copy, cover letters, post captions, message replies, resume summaries, "improve this
text", and taxonomy autocomplete. Every result is a suggestion the person accepts, edits or
discards — nothing is ever sent on their behalf.

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

- **`GET /api/ai/status`** — public. `{ enabled: boolean, tasks: string[] }`. The frontend hides
  every AI button when `enabled` is false.
- **`POST /api/ai/suggest`** — auth required (any role). Body `{ task, context }`. Success:
  `{ suggestion, task, model }`. Errors: `503 AI_DISABLED`, `422 UNKNOWN_TASK` /
  `422 INVALID_CONTEXT`, `403 AI_ACCESS_DENIED` (job/conversation the caller can't reach),
  `429 RATE_LIMITED`, `429 AI_BUDGET_EXHAUSTED`, `502 AI_TIMEOUT` / `AI_UPSTREAM_ERROR` /
  `AI_MALFORMED_RESPONSE`.
- **`GET /api/ai/autocomplete?field=&q=`** — public; works with no AI configured. `field` is one
  of `skills`, `genres`, `instruments`, `roles`, `cities`. Returns
  `{ field, query, suggestions: [{ value, source }] }`, `source` is `"taxonomy"` or `"ai"`. AI
  suggestions are only added when signed in, AI is enabled, and taxonomy gave fewer than 3
  matches.

## Guardrails

- **Enabled only when** `ENV["ANTHROPIC_API_KEY"]` is present and `ENV["AI_ASSIST_ENABLED"] !=
  "false"`.
- **Models**: `ENV["AI_MODEL"]` (default `claude-haiku-4-5-20251001`) for short tasks;
  `ENV["AI_MODEL_LONG"]` (default `claude-sonnet-5`) for `job_description`, `cover_letter` and
  `resume_summary`.
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
