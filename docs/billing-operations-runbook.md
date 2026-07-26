# VinOS billing operations runbook

**Status:** code and scheduled Cloud Run job are implemented; TBC merchant approval, production secrets, sandbox evidence, and the first observed renewal remain operator actions.

## Production configuration

Set the repository variable `BILLING_ENABLED=true` only after these Secret Manager entries exist and the runtime service account can access them:

- `cellarflow-tbc-api-key`;
- `cellarflow-tbc-client-id`;
- `cellarflow-tbc-client-secret`;
- `cellarflow-billing-cron-secret`.

The encrypted recurring-card token derives its key from `cellarflow-session-secret`. Rotating the session secret makes existing recurring tokens unreadable, so session-secret rotation requires a billing migration/re-consent plan, not only a forced login.

Repository variables:

- `TBC_API_BASE_URL` (defaults to `https://api.tbcbank.ge`);
- `TBC_RECURRING_ENABLED` (`true` only after TBC enables merchant-initiated recurring charges);
- optional `BILLING_VAT_LABEL_EN` and `BILLING_VAT_LABEL_KA`.

The protected deployment maps the provider settings into the service. The daily Scheduled Operations workflow resolves the latest deployed image and runs `npm run billing:renewals` in a one-task Cloud Run Job attached to the production Cloud SQL instance. The job fails before changing subscriptions when the provider, recurring feature, session secret, or database is unavailable.

## Invariants

- Provider callbacks are notifications, not authority. VinOS queries TBC before activating a subscription.
- `merchantPaymentId`, provider payment ID, and renewal idempotency key prevent duplicate local charges.
- A renewal retry first reconciles the existing provider payment; it does not create another charge after an ambiguous response.
- Existing winery records remain readable and exportable when a plan is past due or over capacity. Feature limits may block new writes, never retrieval of customer data.
- Provider tokens are encrypted at rest. API credentials, token plaintext, card details, and full provider payloads never enter browser state or logs.
- Operators use routes and the master billing console; they do not edit payment or subscription rows manually.

## Daily checks

1. Confirm the `billing_renewals` Scheduled Operations job completed.
2. Review only aggregate output: processed, succeeded, failed, and canceled.
3. In the master billing console, review pending/initiating payments and past-due/grace-period subscriptions.
4. Investigate a workflow failure as an infrastructure/provider incident. A customer payment failure is handled through subscription state and support, not by rerunning an arbitrary charge.

## Incident procedures

### Callback outage or lost callback

1. Do not create a second checkout.
2. Ask an organization owner to use the payment reconciliation action, or use the corresponding master-admin view.
3. VinOS queries TBC by the stored provider payment ID and applies only the verified result.
4. Record the reconciliation outcome in the subscription audit trail.

### Duplicate callback

No operator action is normally required. The same provider payment resolves to the existing row and verified state. Confirm there is one billing payment and one subscription activation audit event.

### Provider succeeded but VinOS timed out

Treat the result as ambiguous. Reconcile the existing payment ID. Never issue a fresh payment or renewal until TBC confirms the original state.

### Renewal job unavailable

1. Stop repeated manual attempts until database and provider readiness are known.
2. Resolve the failed workflow or Cloud Run Job logs without printing secrets.
3. Re-run the idempotent job from `workflow_dispatch` after the fault is repaired.
4. Verify existing idempotency keys were reconciled rather than replaced.

### Customer renewal failed

1. Confirm the provider result is terminal.
2. Leave the subscription in `past_due`/grace handling according to the saved policy.
3. Ask the customer to update payment details through an approved checkout flow.
4. Do not paste card or provider-token data into support tickets.

### Cancellation

`cancelAtPeriodEnd` is processed by the renewal job. The provider recurring token is deleted first; the subscription is marked canceled only after that operation succeeds. If provider deletion fails, keep the job failure visible and retry idempotently.

### Refund or chargeback

The current provider adapter records returned, partially returned, canceled, and review-required states when TBC reports them, but it does not initiate refunds. Follow the signed TBC merchant process, then reconcile the provider payment in VinOS. Record the customer-facing decision and accounting action outside free-form application logs.

## Sandbox acceptance matrix

Before enabling a paid cohort, retain redacted evidence for:

1. monthly and annual checkout;
2. duplicate callback;
3. lost callback plus manual reconciliation;
4. saved recurring token and successful renewal;
5. ambiguous renewal response followed by idempotent reconciliation;
6. terminal renewal failure and past-due transition;
7. cancel-at-period-end and provider token deletion;
8. returned/partially returned provider status;
9. disabled/missing provider configuration failing before subscription mutation;
10. customer access to existing records and exports while writes are plan-restricted.

Do not use production customer cards for this matrix.
