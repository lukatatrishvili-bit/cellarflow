# Terroir Pulse

Terroir Pulse publishes privacy-protected vintage benchmarks from vineyard data that an organization explicitly opts in to share.

## User workflow

Owners, winemakers, and viticulturists can open **Settings → Terroir Pulse**, choose anonymous or attributed participation, select data categories, and select individual vineyard blocks. Sharing is off by default. Disabling it immediately excludes that organization from future API responses.

The public page is available at `/terroir-pulse`. Its data endpoint is `GET /api/terroir-pulse` and supports exact `country`, `region`, `variety`, `vintage`, and `level` filters.

## Privacy contract

A region/terroir, variety, and vintage group is published only when all of these conditions hold:

- At least five independent organizations contribute.
- At least five hectares are represented.
- No organization represents more than 40% of the group's area.
- Observations are at least seven days old.

The thresholds can be made stricter with the `TERROIR_PULSE_*` environment variables. The minimum contributor threshold cannot be configured below three.

Metrics are calculated in two stages: each organization's block values are reduced to an organization median, then those organization values are reduced to a group median. This prevents an organization that records more frequently from dominating the result.

The public response contains no organization IDs, block IDs, block names, coordinates, raw records, notes, exact organization values, prices, buyers, or contracts. An organization name appears only when it explicitly selects attributed participation.

## Persistence

Sharing preferences live in the existing authoritative `OrganizationState.data` JSONB document (and in the JSON fallback store when PostgreSQL is not configured). No relational schema migration is required. The dedicated settings endpoint uses optimistic concurrency so it cannot silently overwrite a simultaneous operational sync.
