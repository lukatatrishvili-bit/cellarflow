# VinOS WhatsApp task notifications

VinOS sends task assignments with Meta's WhatsApp Business Platform Cloud API. Delivery is server-side and uses an approved Utility template; access tokens and team-member phone numbers are never sent to the browser. A tenant-scoped delivery row makes each task send idempotent, while signed Meta webhooks advance the visible state from accepted to sent, delivered, read, or failed.

## 1. Create the template in WhatsApp Manager

Create one Utility template named `cellarflow_task_assignment` with two language translations. The variable order must be identical in both translations.

English (US), language code `en_US`:

```text
Hello {{1}}, you have a new task in VinOS.

Task: {{2}}
Priority: {{3}}
Due: {{4}}
Details: {{5}}
Assigned by: {{6}}

Open task: {{7}}

This is an operational notification from VinOS.
```

Georgian, language code `ka`:

```text
გამარჯობა {{1}}, VinOS-ში ახალი დავალება გაქვთ.

დავალება: {{2}}
პრიორიტეტი: {{3}}
ვადა: {{4}}
დეტალები: {{5}}
დავალება გამოგიგზავნათ: {{6}}

დავალების გახსნა: {{7}}

ეს არის VinOS-ის საოპერაციო შეტყობინება.
```

The parameters are: assignee name, task title, localized priority, localized due date, task details, assigner name, and the exact VinOS task deep link.

The internal template identifier can remain `cellarflow_task_assignment` for compatibility. Changing the visible template copy requires Meta approval for both translations before production sends use the new version.

## 2. Configure the deployment

Set these server environment variables:

```dotenv
WHATSAPP_ACCESS_TOKEN="your-long-lived-system-user-token"
WHATSAPP_PHONE_NUMBER_ID="your-meta-phone-number-id"
WHATSAPP_GRAPH_API_VERSION="a-current-supported-version-such-as-v26.0"
WHATSAPP_TASK_TEMPLATE_NAME="cellarflow_task_assignment"
WHATSAPP_TASK_TEMPLATE_LANGUAGE_EN="en_US"
WHATSAPP_TASK_TEMPLATE_LANGUAGE_KA="ka"
WHATSAPP_WEBHOOK_VERIFY_TOKEN="a-random-value-used-during-meta-subscription"
WHATSAPP_APP_SECRET="the-meta-app-secret-used-to-verify-signed-posts"
APP_URL="https://your-cellarflow-domain.example"
```

Use the Graph API version currently supported for your Meta app. Store the access token in the production secret manager, not in source control or a client-side environment variable.

The protected Cloud Run workflow expects these Secret Manager entries:

- `cellarflow-whatsapp-access-token`;
- `cellarflow-whatsapp-phone-number-id`;
- `cellarflow-whatsapp-webhook-verify-token`;
- `cellarflow-whatsapp-app-secret`.

It reads Graph API version, template name, and language codes from optional repository variables and otherwise uses the defaults shown above.
Set the repository variable `WHATSAPP_ENABLED=true` after all four secrets exist. When the variable is not true, the deployment leaves existing WhatsApp runtime settings unchanged and does not require the optional secrets.

## 3. Configure the signed webhook

In Meta App Dashboard → WhatsApp → Configuration:

1. set the callback URL to `https://YOUR_APP/api/notifications/whatsapp/webhook`;
2. enter the same value stored as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
3. verify and save the callback;
4. subscribe the WhatsApp Business Account to the `messages` webhook field.

Meta's GET verification challenge is compared in constant time. Every POST must carry a valid `X-Hub-Signature-256` HMAC created with `WHATSAPP_APP_SECRET`; unsigned, malformed, oversized, or incorrectly signed bodies are rejected. Only bounded `sent`, `delivered`, `read`, and `failed` status events are stored. Inbound message bodies and recipient phone numbers are not persisted by this integration.

If a valid status cannot be saved, the endpoint returns a non-2xx response so Meta can retry. Unknown provider message IDs are acknowledged without revealing whether a task or organization exists.

## 4. Enable recipients

Each team member opens Settings → Operator Profile, saves an international number such as `+995555123456`, selects **Receive WhatsApp tasks**, and saves. This explicit opt-in defaults to off for all existing and new accounts.

The task creator can then select that member in the task form. VinOS chooses Georgian or English from the recipient's saved profile language. A task is still created if Meta rejects or times out the notification; the task card records the notification failure and offers an idempotent retry.

## 5. Delivery lifecycle

- `sending`: VinOS has reserved the tenant/task delivery and is calling Meta.
- `accepted`: Meta returned a provider message ID.
- `sent`: Meta reports that the message left its service.
- `delivered`: Meta reports delivery to the recipient.
- `read`: Meta reports that the recipient read it, when read receipts are available.
- `failed`: Meta rejected the send or later reported delivery failure.

The task screen reconciles server-owned status on load and every 30 seconds while open. Retrying an accepted/sent/delivered/read task replays its durable status without sending a duplicate. A failed or abandoned send can be claimed for a new attempt.

Each template's seventh variable opens `/tasks?task=TASK_ID`. VinOS preserves that URL through authentication, opens the Tasks workspace, highlights the permitted task, and does not expose cross-workspace records.

## 6. Go-live checklist

- Both `en_US` and `ka` Utility template translations are approved with the exact seven-variable order.
- The permanent system-user token has only the WhatsApp permissions required by the selected business account.
- All four Secret Manager entries exist and the runtime service account can access them.
- `/api/ready` reports the WhatsApp optional integration as `ready`, not `degraded`.
- Meta successfully verifies the production callback and the `messages` field is subscribed.
- A test recipient has explicitly opted in and saved a valid E.164 number.
- One English and one Georgian test task progress from accepted through the statuses Meta makes available.
- Duplicate POST and retry tests do not create duplicate provider messages.
- An invalid-signature webhook returns 401 and does not change delivery state.
- Opt-out is tested by clearing the profile checkbox.

## Operational notes

- Meta acceptance is not handset delivery. The UI reports each later signed status separately.
- Do not rename, remove, or reorder template variables without changing the server payload and re-approving both translations.
- Production should use a permanent system-user access token with only the permissions required by the WhatsApp Business account.
- Recipients must have agreed to receive these operational messages, and opt-out requests should be honored by clearing their profile checkbox.
- Provider errors are bounded before storage or display. Tokens, app secrets, webhook verify tokens, phone numbers, and free-form webhook payloads must never enter logs or browser responses.
