# Winery Intelligence operations

The intelligence layer keeps deterministic rules authoritative. Model analysis,
knowledge retrieval, delivery, and scheduled execution are optional layers
around the same validated findings.

## Knowledge base

Winery administrators manage references in **Winery Intelligence → Settings →
Grounded knowledge base**. Accepted input is reviewed text, not a remote URL to
fetch. This avoids server-side request forgery and keeps ingestion deliberate.

The server:

1. normalizes and deterministically chunks the text;
2. stores documents and chunks under the organization ID;
3. creates 768-dimensional `gemini-embedding-2` embeddings when the winery's
   shared daily model budget permits;
4. falls back to deterministic Unicode-aware lexical retrieval when embeddings
   or provider access are unavailable;
5. supplies at most four passages to an eligible specialist; and
6. exposes every passage to grounding validation through a
   `knowledge:<document>:<chunk>` source reference.

Knowledge passages are explicitly treated as untrusted data in the agent safety
contract. They are reference evidence, not instructions and not proof of a
current measurement or completed action. Archiving removes a document from
future retrieval without destroying its provenance.

## Interactive copilot

`POST /api/gemini` answers free-form questions and is held to the same contract
as the monitoring agents. It shares `server/aiWorkspace.ts` with the `/api/ai`
routes, so both resolve the winery and apply the field-level role boundary
through one implementation.

Per request the server:

1. loads the organization state and narrows it with `snapshotVisibleToRole`, so
   collections the caller's role cannot open are never serialized;
2. resolves the question to at most two focused context packages — matched
   against entity ids and names present in the *filtered* snapshot — plus the
   winery-wide package;
3. builds the prompt from `AI_GROUNDING_RULES`, the same rules the specialists
   receive, with the conversational additions in `lib/ai/copilot.ts`; and
4. sends the last eight conversation turns, labelled as continuity rather than
   evidence.

Nothing the client sends about the cellar is trusted. A client may pass a
`focus` hint (`{ entityType, entityId }`) for what the user has open, but it is
discarded unless the entity exists in the role-filtered snapshot.

Because role filtering empties whole collections, the snapshot carries a
`withheld` list into the context builder. Without it the builder reports removed
records as "no laboratory analysis has ever been recorded" — a false claim of
absence that the model repeats. Withheld areas are instead described as outside
the user's access, and the copilot prompt names them explicitly.

Copilot calls reserve against the shared daily model budget and report under the
`copilot` purpose in the master-admin AI operations panel.

## Ask My Winery

A question cost two model calls — one to choose a query, one to write the
answer — and both are now memoized in `server/aiResponseCache.ts`, per process
and per organization:

- the **plan** is a pure function of the question text, cached for 30 minutes;
- the **answer** is keyed by the rows it was written from, cached for 10
  minutes, so it misses as soon as the records move.

A repeat question against unchanged records therefore costs nothing. The
response reports `modelCalls: { plan, answer }` as `model` / `cache` /
`fallback` so the saving is observable rather than assumed.

The planner may also return a `clarification`: one question to ask back when it
cannot resolve which records are meant. The server returns that instead of
executing a guess, and buys no second call to narrate it.

When the planner cannot run at all — model disabled, budget exhausted, or a
provider failure — the winery-wide summary is still returned, but
`answeredFromQuestion` is `false`, `fallbackReason` says which, and the answer
opens by saying it is not an answer to the question. The explainer is skipped in
that case: a fluent paragraph about the wrong query is worse than none. If the
caller's role cannot run `winery_summary` (it reads the `reports` module, which
most specialist roles lack) the same honest response is returned rather than a
403, which would blame the asker for a planner that never ran.

## Model tiers and budgets

One constant used to serve every generative call. Models are now resolved per
slot in `server/config.ts`, each overridable by environment variable:

| Slot | Variable | Default | Used by |
| --- | --- | --- | --- |
| default | `AI_MODEL` | `gemini-2.5-flash` | copilot, answer explanation, invoice extraction, single-agent analysis |
| deep | `AI_MODEL_DEEP` | `gemini-2.5-pro` | multi-specialist analysis (`tier: 'deep'`) |
| planner | `AI_MODEL_PLANNER` | falls back to `AI_MODEL` | Ask My Winery query planning |

Deep analysis is the rarest call the layer makes — gated by finding type,
severity and cooldown, and capped per run — and the one where interpretation
quality is the product, so it gets the stronger model. Every call records its
model in telemetry, so the tier split is visible in the operations console.

Budgets are metered in two counters on `AiModelCallUsage`:

- `callCount` — generative calls, limited by `maxModelCallsPerDay`;
- `embeddingCount` — knowledge embeddings, limited by `maxEmbeddingCallsPerDay`.

They were previously the same counter, so retrieval for a winery with a
knowledge base spent the allowance deep analysis needed, despite costing
roughly two orders of magnitude less. Both are reserved before the provider
request and shared atomically across instances.

## Detector calibration

Review verdicts (`helpful`, `not_helpful`, `incorrect`, `already_handled`) were
collected and summarized but never acted on. A winery can now opt in with
`feedbackCalibrationEnabled` in **Winery Intelligence → Settings**, off by
default because it changes which alerts the winery receives.

A detector — one `source`/`area`/`findingType` combination — is muted once it
has verdicts on at least 3 distinct findings and either:

- 20% or more of its quality verdicts say `incorrect`;
- 40% or more say `not_helpful` or `incorrect`, across at least 5 verdicts; or
- 60% or more of all verdicts say `already_handled`, across at least 5 — the
  detector is right but arrives after the work is done.

Muting costs a detector the two things that are expensive: a notification, and a
model call. Its findings still appear in the activity log and the briefing, and
its status lifecycle is unchanged. **A critical finding is never muted**, so
calibration can only reduce noise, not silence the alerts the layer exists for.

Calibration is computed per organization from that organization's own findings —
never across tenants — and `GET /api/ai/calibration` reports it over the
findings the caller's role may see. The endpoint lists what *would* be muted
even while the setting is off, so an administrator sees the consequence before
accepting it. The master-admin panel pools verdicts across wineries and remains
advisory; nothing is muted from there.

Each analysis prompt also carries the winery's own verdict history for the
triggering detector, so an agent asked to interpret a rule its reviewers keep
calling wrong is told so.

## Notification channels

Each user opts in separately per winery. Existing users default to off for every
external channel. Email and browser push share the personal severity floor but
keep independent enable timestamps, preventing retroactive delivery.
Membership, role, account state, consent, severity, and provider readiness are
revalidated immediately before each send.

The monitoring job writes one idempotent outbox row per finding transition,
recipient, and channel. The delivery job leases rows, retries transient failures
with bounded backoff, cancels ineligible recipients, and surfaces terminal
failures in the master-admin AI operations panel.

### Email

Email uses the normal SMTP deployment settings. Only verified account addresses
are eligible.

### PWA browser push

Generate one VAPID key pair per deployment:

```bash
npx web-push generate-vapid-keys
```

Create these Secret Manager entries:

- `cellarflow-web-push-vapid-public-key`
- `cellarflow-web-push-vapid-private-key`
- `cellarflow-web-push-vapid-subject` — `mailto:` or HTTPS contact

Set the GitHub repository variable `WEB_PUSH_ENABLED=true`. A browser is
registered only after its user saves the explicit push opt-in. Expired endpoints
returning HTTP 404/410 are removed automatically.

## Scheduled execution

The deployment workflow creates immutable-image Cloud Run Jobs and Cloud
Scheduler triggers:

- hourly, daily, and weekly deterministic monitoring;
- notification delivery every 15 minutes; and
- database-backed cadence leases and outbox claims for safe retries.

Scheduled monitoring never calls a generative model. Knowledge embeddings are
generated only during administrator ingestion or an interactive deep analysis
and use the shared database-backed model-call budget.

## Release checklist

1. Apply the committed Prisma migrations through the zero-retry migration job.
2. Verify `/api/ready`.
3. Confirm the AI operations panel reports configured channels accurately.
4. Add a small reviewed reference and confirm its chunk/embedding counts.
5. Opt a test user into one channel and create a routed finding transition.
6. Execute the delivery job and confirm the outbox row reaches `delivered`.
7. For push, open the notification and confirm it deep-links to the finding.
