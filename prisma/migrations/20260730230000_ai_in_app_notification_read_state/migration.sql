CREATE TABLE "AiNotificationReadState" (
    "organizationId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiNotificationReadState_pkey"
      PRIMARY KEY ("organizationId", "username", "findingId")
);

CREATE INDEX "AiNotificationReadState_organizationId_username_updatedAt_idx"
ON "AiNotificationReadState"("organizationId", "username", "updatedAt");

ALTER TABLE "AiNotificationReadState"
ADD CONSTRAINT "AiNotificationReadState_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiNotificationReadState"
ADD CONSTRAINT "AiNotificationReadState_username_fkey"
FOREIGN KEY ("username") REFERENCES "User"("username")
ON DELETE CASCADE ON UPDATE CASCADE;
