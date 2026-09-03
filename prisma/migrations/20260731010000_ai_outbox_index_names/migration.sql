-- PostgreSQL truncates identifiers to 63 bytes. The original generated names
-- lost their `_key` / `_idx` suffixes, while Prisma's datamodel keeps those
-- suffixes when it truncates. Give both indexes stable explicit names so fresh
-- databases and already-deployed databases have the same schema.
ALTER INDEX IF EXISTS "AiNotificationOutbox_organizationId_eventKey_recipientUsername_"
RENAME TO "AiNotificationOutbox_organizationId_eventKey_recipientUsern_key";

ALTER INDEX IF EXISTS "AiNotificationOutbox_organizationId_recipientUsername_createdAt"
RENAME TO "AiNotificationOutbox_organizationId_recipientUsername_creat_idx";
