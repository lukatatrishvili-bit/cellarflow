ALTER TABLE "AiNotificationPreference"
ADD COLUMN "inAppMinimumSeverity" TEXT NOT NULL DEFAULT 'info';

ALTER TABLE "AiNotificationPreference"
ADD CONSTRAINT "AiNotificationPreference_inAppMinimumSeverity_check"
CHECK ("inAppMinimumSeverity" IN ('info', 'attention', 'warning', 'critical'));
