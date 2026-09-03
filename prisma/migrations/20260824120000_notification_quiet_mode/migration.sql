-- One user-level quiet mode applies consistently to in-app, email, push, and
-- task-assignment notifications. Existing accounts remain enabled.
ALTER TABLE "AiNotificationPreference"
  ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notificationsPausedUntil" TIMESTAMP(3);

CREATE INDEX "AiNotificationPreference_org_notifications_enabled_idx"
  ON "AiNotificationPreference"("organizationId", "notificationsEnabled");
