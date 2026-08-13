# Operations control workflows

**Status:** Reference
**Last verified:** 2026-08-13

This reference covers the operational workflows added around the existing
cellar command, traceability, task, inventory, and sync foundations. The
authoritative production records still use the same organization-scoped JSONB
state and idempotent command ledger.

## Today and workflow approvals

The Cellar **Today** tab merges open tasks, due SOPs, expected purchase orders,
started production-plan items, and approval requests. Overdue work sorts ahead
of current work. Non-admin users only receive approval requests they submitted;
owners see the organization queue.

Workflow approvals are a Professional-plan feature and are disabled by
default. An owner can enable them for any combination of cellar operations,
transfers, bottling, sales dispatches, and their correction commands.

When a protected command is submitted:

1. The server hashes the exact command payload and stores one request for its
   idempotency key.
2. It returns `workflow_approval_required` without consuming the client's
   pending command intent.
3. An owner approves or rejects the request in **Today**.
4. Approval never executes work by itself. The requester reviews and resubmits
   the same pending command; a changed payload is rejected.
5. The command ledger still provides the final atomic execution and replay
   result. The approval list derives `executed` from that durable ledger.

This separation is deliberate: a reviewer authorizes an exact intent but never
silently performs a physical cellar action on another operator's behalf.

## Scan to action

The scanner button in the global header accepts QR, Data Matrix, and Code 128
when the browser exposes `BarcodeDetector`. Camera frames remain on the device.
Manual entry is always available.

Recognized values include existing `?tank=...&op=1` links, `?lot=...` links,
`vessel:ID`, `lot:ID`, compact JSON containing a vessel/lot id, and an exact
workspace record id. A vessel opens the operation form with that vessel
preselected. A lot opens its traceability passport. Unknown or cross-workspace
ids do not navigate.

## Recall and containment

The **Recall** tab walks the directed lineage graph from the selected lot. It
includes downstream blend lots, bottling runs, storage movements, reservations,
active dispatches, and affected customers, while upstream traversal identifies
the original intake and harvest evidence. Reversed dispatches are excluded.

Opening a recall freezes the calculated exposure ids and creates three high
priority containment tasks when the operator can create tasks: quarantine,
stock reconciliation, and customer contact. Cases move through active,
contained, and closed. Closure requires actor/time evidence and is terminal;
the server rejects later exposure edits or reopening.

## Quality SOPs

The **Quality SOPs** tab schedules one-time, daily, weekly, monthly, quarterly,
or seasonal procedures. Every checklist item must be checked, and procedures
marked as evidence-required also need a result or evidence note. Completion
history is append-only and bounded to 100 entries. Calendar recurrence clamps
month-end dates correctly (for example, January 31 becomes February 28).

SOPs can reference a lot or vessel. The sync boundary rejects missing
references, malformed evidence, history rewrites, and oversized checklists.

## Purchasing and receiving

The **Purchasing** tab groups inventory at or below its reorder point by
supplier and creates a draft purchase order with suggested quantities. Orders
can carry expected dates and progress through draft, submitted, ordered,
partially received, received, or cancelled.

Receiving uses the existing `invoice.receipt` idempotent command. Inventory
quantity, weighted unit cost, movement ledger, receipt evidence, and replay
result therefore update atomically. The purchase order closes only after that
command succeeds and retains its command id. The initial receiving flow requires
the purchase-order currency to match the winery accounting currency; foreign
currency orders should continue through invoice import so an official or
manually confirmed exchange-rate quote is retained.

AI invoice analysis is a Small-plan data-import feature. Its server endpoint
now enforces that entitlement; purchase-order receiving remains part of core
inventory operations and does not require AI.

## Production planner

The **Planner** displays a rolling 14-day schedule and supports harvest, intake,
transfer, fermentation, lab, bottling, sanitation, procurement, dispatch, and
other work. Harvest records can generate plan items once. Conflict checks flag:

- overlapping reservations for the same vessel;
- planned liquid above current selected-vessel headroom;
- missing dependencies; and
- invalid date order (also rejected by sync).

Planning has its own permission module: owners and winemakers can edit;
viticulturists, lab technicians, and cellar workers can view; read-only users
can view through the standard read-only policy.

## Subscription truth

The catalog now sells only capabilities that exist end-to-end. Data import,
advanced reports, workflow approvals, production costing, and custom
integrations are gated at their relevant UI and/or server boundaries. SSO,
external API access, custom fields, multi-site, and multi-company claims were
removed from standard plans until corresponding production contracts exist.
Legacy billing feature keys remain parsable so historic overrides do not break
storage, but the billing console no longer offers those keys for new grants.

## Recovery and offline behavior

Quality SOPs, purchase orders, plans, and recall cases are client-editable sync
collections with baseline timestamps and conflict handling. Workflow approvals
are server-owned. A protected command remains in the durable pending-command
queue after the approval response, so closing the browser does not invent a new
idempotency key. Existing sync payload and record ceilings still apply.
