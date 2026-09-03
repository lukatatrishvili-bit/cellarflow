# Operations control workflows

**Status:** Reference
**Last verified:** 2026-08-13

This reference covers the operational workflows added around the existing
cellar command, traceability, task, inventory, and sync foundations. The
authoritative production records still use the same organization-scoped JSONB
state and idempotent command ledger.

## Today and workflow approvals

The Cellar **Today** tab merges active recalls, open tasks, due SOPs, expected
purchase orders, started production-plan items, and approval requests. Active
recalls are critical and remain at the top; overdue work then sorts ahead of
current work. Non-admin users only receive approval requests they submitted;
owners see the organization queue. Selecting a recall queue item opens that
exact case rather than the first lot in the cockpit.

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
contained, and closed in that order. Containment and closure are blocked until
every linked task is complete. Each transition retains actor/time evidence;
the server rejects skipped or reversed states, later exposure edits, and
lifecycle-evidence rewrites.

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
result therefore update atomically. Each delivery can receive any positive
quantity up to the outstanding amount on each line. Partial deliveries keep the
order open and prepend immutable per-command receipt evidence; the order closes
only when every line is fully received. Manual status jumps, received-quantity
reductions, line rewrites, and receipt-history edits fail at the sync boundary.
Each delivery uses a sequenced order receipt reference (`PO-…-R1`, `R2`, and so
on), so invoice duplicate protection remains effective without blocking a
legitimate later delivery.
The receiving flow requires the purchase-order currency to match the winery
accounting currency; foreign-currency orders should continue through invoice
import so an official or manually confirmed exchange-rate quote is retained.

AI invoice analysis is a Small-plan data-import feature. Its server endpoint
now enforces that entitlement; purchase-order receiving remains part of core
inventory operations and does not require AI.

## Production planner

The **Planner** displays a rolling 14-day schedule and supports harvest, intake,
transfer, fermentation, lab, bottling, sanitation, procurement, dispatch, and
other work. Harvest records can generate plan items once, and operators can
select prerequisite work when creating a plan item. Conflict checks flag:

- overlapping reservations for the same vessel;
- planned liquid above current selected-vessel headroom;
- missing dependencies;
- dependency timing or cycles; and
- invalid date order (also rejected by sync).

Dependency cycles and duplicate references are rejected by the sync boundary,
even if concurrent edits produce a graph the client did not previously see.

Planning has its own permission module: owners and winemakers can edit;
viticulturists, lab technicians, and cellar workers can view; read-only users
can view through the standard read-only policy.

## Winery Plan

**Winery Plan** is a standalone operational module, not only a diagram inside
the vessel register. Its compact command bar keeps the winery identity, view
switcher, production planner, and return-to-winery action available while the
map uses the remaining workspace. Access follows the vessel permission: users
who can view vessels can open the plan, while layout changes require vessel
update permission.

Top-down is optimized for quick daily decisions. It supports multi-floor plans,
real-world room dimensions, zones and utilities, pan/zoom/fullscreen, contents,
temperature, sanitation and work layers, vessel search, label modes, grid
snapping, automatic arrangement, and drag placement. A selected vessel can open
its wine lot or details, record an operation, assign future work, record
sanitation evidence, or begin a destination-aware transfer directly on the map.

The 3D view uses the same vessel, lot, floor, and percentage coordinates as
Top-down; it does not maintain a parallel layout. It provides an orbiting WebGL
room with zoom, camera rotation/reset, fullscreen, fill and sanitation context,
and a physical editor for:

- closed/open and jacketed tanks, insulated or horizontal tanks, IBCs,
  barrels, qvevri, concrete, and plastic vessels;
- width, depth, height, clearance/elevation, arbitrary rotation, X/Y placement,
  and floor assignment;
- direct drag placement on the cellar floor; and
- conservative footprint-overlap warnings before the room is finalized.

The server validates the model, dimensions, elevation, rotation, and saved map
coordinates. Devices without WebGL receive an explicit fallback and can keep
working in Top-down.

Planning and execution remain separate. **Assign work** creates a production
plan item with the exact cellar-operation subtype, responsible person, dates,
instructions, prerequisites, lot, source/destination vessels, and quantity.
Opening that item later restores the exact operation form. **Record operation**
opens the execution workflow immediately. Transfers check destination
cleanliness and headroom; cleaning an empty vessel requires dated sanitation
evidence rather than an unaudited status toggle.

The lot relationship is bidirectional: vessel actions open the assigned Wine
Lot command center, and a lot's **Winery plan** action focuses the vessel that
currently contains it. This keeps spatial location, traceability, planning, and
execution connected without duplicating wine-lot ownership.

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
