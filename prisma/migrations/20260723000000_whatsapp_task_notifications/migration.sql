-- Personal WhatsApp delivery preferences. Opt-in is false by default so
-- existing accounts never begin receiving messages without explicit consent.
ALTER TABLE "User"
ADD COLUMN "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false;
