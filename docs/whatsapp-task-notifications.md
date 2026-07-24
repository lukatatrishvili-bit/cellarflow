# WhatsApp task notifications

CellarFlow sends task assignments with Meta's WhatsApp Business Platform Cloud API. Delivery is server-side and uses an approved Utility template; access tokens and team-member phone numbers are never sent to the browser.

## 1. Create the template in WhatsApp Manager

Create one Utility template named `cellarflow_task_assignment` with two language translations. The variable order must be identical in both translations.

English (US), language code `en_US`:

```text
Hello {{1}}, you have a new task in CellarFlow.

Task: {{2}}
Priority: {{3}}
Due: {{4}}
Details: {{5}}
Assigned by: {{6}}

Open task: {{7}}

This is an operational notification from CellarFlow.
```

Georgian, language code `ka`:

```text
გამარჯობა {{1}}, CellarFlow-ში ახალი დავალება გაქვთ.

დავალება: {{2}}
პრიორიტეტი: {{3}}
ვადა: {{4}}
დეტალები: {{5}}
დავალება გამოგიგზავნათ: {{6}}

დავალების გახსნა: {{7}}

ეს არის CellarFlow-ის საოპერაციო შეტყობინება.
```

The parameters are: assignee name, task title, localized priority, localized due date, task details, assigner name, and the CellarFlow task-list link.

## 2. Configure the deployment

Set these server environment variables:

```dotenv
WHATSAPP_ACCESS_TOKEN="your-long-lived-system-user-token"
WHATSAPP_PHONE_NUMBER_ID="your-meta-phone-number-id"
WHATSAPP_GRAPH_API_VERSION="a-current-supported-version-such-as-v26.0"
WHATSAPP_TASK_TEMPLATE_NAME="cellarflow_task_assignment"
WHATSAPP_TASK_TEMPLATE_LANGUAGE_EN="en_US"
WHATSAPP_TASK_TEMPLATE_LANGUAGE_KA="ka"
APP_URL="https://your-cellarflow-domain.example"
```

Use the Graph API version currently supported for your Meta app. Store the access token in the production secret manager, not in source control or a client-side environment variable.

## 3. Enable recipients

Each team member opens Settings → Operator Profile, saves an international number such as `+995555123456`, selects **Receive WhatsApp tasks**, and saves. This explicit opt-in defaults to off for all existing and new accounts.

The task creator can then select that member in the task form. CellarFlow chooses Georgian or English from the recipient's saved profile language. A task is still created if Meta rejects or times out the notification; the task card records the notification failure for follow-up.

## Operational notes

- Meta accepts the request before final handset delivery. The current UI reports `accepted`, not `delivered`.
- Do not rename, remove, or reorder template variables without changing the server payload and re-approving both translations.
- Production should use a permanent system-user access token with only the permissions required by the WhatsApp Business account.
- Recipients must have agreed to receive these operational messages, and opt-out requests should be honored by clearing their profile checkbox.
