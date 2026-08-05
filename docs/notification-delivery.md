# VinOS email and browser-push notifications

VinOS delivers task assignments and routed intelligence alerts through email
and standards-based browser push. Each channel is disabled by default and must
be enabled by the recipient for each winery from **Profile Settings → Personal
notifications**.

## Task assignments

Task creators can enable **Notify the assignee** while creating a task. VinOS
uses every channel the selected assignee has enabled:

- email requires a verified account email and configured SMTP transport;
- browser push requires an active browser subscription and configured VAPID
  keys.

The task is created even when notification delivery fails. Each task/channel
pair is recorded idempotently in `TaskNotificationDelivery`; a retry reuses a
successful channel and retries only a failed channel.

Task email and push content is localized to the recipient's Georgian or English
profile language and links directly to `/tasks?task=TASK_ID`.

## Browser push configuration

Generate one VAPID key pair per deployment:

```bash
npx web-push generate-vapid-keys
```

Create these Secret Manager entries:

- `cellarflow-web-push-vapid-public-key`;
- `cellarflow-web-push-vapid-private-key`;
- `cellarflow-web-push-vapid-subject` — a `mailto:` or HTTPS contact.

Set the GitHub repository variable `WEB_PUSH_ENABLED=true`. Enabling push in
the profile requests browser permission and registers the current device. HTTP
404/410 endpoints are removed automatically.

On iPhone and iPad, add VinOS to the Home Screen before enabling push. Desktop
and Android browsers can subscribe directly when the relevant browser supports
the Push, Notifications, and Service Worker APIs.

## Email configuration

Email reuses the normal SMTP settings:

- `SMTP_HOST`;
- `SMTP_PORT`;
- `SMTP_SECURE`;
- `SMTP_USER`;
- Secret Manager entry `cellarflow-smtp-pass` exposed as `SMTP_PASS`;
- `MAIL_FROM`.

Production fails closed when SMTP delivery is unavailable; notification
messages are never treated as delivered merely because they were logged.

## Release verification

1. Apply the committed Prisma migration.
2. Confirm `/api/ready` reports `email` and `browserPush` as `ready`.
3. Enable email for a verified test account.
4. Enable browser push and accept the browser permission prompt.
5. Assign a task with **Notify the assignee** enabled.
6. Verify both notifications link to the matching task.
7. Turn each channel off and confirm it is no longer used for new tasks or AI
   findings.
