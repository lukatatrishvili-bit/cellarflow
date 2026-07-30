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

## Notification channels

Each user opts in separately per winery. Existing users default to off for every
external channel. Email, browser push, and WhatsApp share the personal severity
floor but keep independent enable timestamps, preventing retroactive delivery.
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

### AI WhatsApp findings

AI findings use a separate approved Utility template from task assignments.
Create `cellarflow_ai_finding` in English (US) and Georgian with six body
variables in this order:

1. winery name;
2. severity;
3. finding title;
4. entity label;
5. observation; and
6. application URL.

Set:

- `WHATSAPP_ENABLED=true`
- `WHATSAPP_AI_FINDING_TEMPLATE_NAME=cellarflow_ai_finding`
- `WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_EN=en_US`
- `WHATSAPP_AI_FINDING_TEMPLATE_LANGUAGE_KA=ka`

The existing WhatsApp access-token and phone-number secrets are reused. A user
must also have a valid international number and the existing profile-level
WhatsApp opt-in. Outbox delivery means Meta accepted the template request; task
webhook read-state tracking remains separate.

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
