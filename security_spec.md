# Security Specification: Vinea Zero-Trust Access Rules

This specification establishes Attribute-Based Access Control (ABAC) and the "Dirty Dozen" security payloads to safeguard the winery records in Vinea.

## Data Invariants

1. **Winery Scoping**: All resources (Tanks, Lots, Transfers, Fermentations) belong under `/wineries/{wineryId}`. Users must possess authenticated membership keys or direct ownership of the winery node to execute read/write actions.
2. **Volatile Content Lock**: Once a wine lot is marked as `"bottled"`, its physical volume in tanks cannot decrease, and its parameters are frozen to maintain historical compliance.
3. **No Over-capacity**: Destination tanks cannot be allocated a volume that exceeds their physical capacity.
4. **Time Invariance**: `createdAt` and `originalOwnerId` represent absolute immutable properties and must not be updated during state modifications.
5. **No Negative Quantities**: Wine volumes, grape quantities, or capacity records must not contain negative values.

## The Dirty Dozen (Vulnerability Attack Payloads)

Here are the 12 negative payloads designed to probe the system for gaps:

1. **ID Poisoning Attack**: Trying to inject a 200KB junk-character string as a tank ID. (Should be blocked by `isValidId(tankId)`).
2. **Winery Identity Spoofing**: An authenticated user `user_A` writes a Transfer to winery `winery_B` which they do not own. (Blocked by winery access control).
3. **Negative Volume Infusion**: Issuing a Transfer with `volume: -5000` to artificially pump wine. (Blocked by `isValidTransfer()`).
4. **Capacity Theft**: Force-writing a tank volume that exceeds its capacity limit (`vol: 12000` on a `capacity: 10000` tank).
5. **PII Profile Scraping**: Standard user attempting to fetch other winemakers' private details without direct permissions. (Blocked by split collections and direct owner rules).
6. **Privilege Escalation**: Standard cellar worker attempting to update their role to `Owner/Admin` in their user profile document.
7. **Stuck Fermentation Bypass**: Writing a fraudulent `fermentationLog` marked with future timestamps and a high alcohol percentage.
8. **Shadow Field Injection**: Saving a tank document with an extra undocumented boolean field `isVerifiedByFDA: true` to bypass verification rules. (Blocked by `keys().size() == N`).
9. **Zero-Volume Transfer Exploitation**: Crafting a transfer with empty fields to pollute the immutable transfer trail.
10. **Orphaned Fermentation Creation**: Launching a fermentation process referencing a non-existent lot or tank.
11. **Immortal Field Mutation**: Attempting to alter `createdAt` on a vintage lot record during an update.
12. **Blanket Query Scraping**: Issuing a broad request to fetch all tanks across the entire Firestore database without scoping it to a single `wineryId`.

## Recommended Rules Structure

These rules enforce strict schema checks and owner constraints. See `firestore.rules` for the implemented fortifications.
