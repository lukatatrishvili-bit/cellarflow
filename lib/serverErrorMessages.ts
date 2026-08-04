import type { Language } from './language';

/**
 * Georgian text for the errors the server raises.
 *
 * The API answers with an English `error` string and a machine-readable `code`.
 * The client was localizing only the surrounding frame, so a Georgian cellar
 * worker hitting a rejected sync saw a half-Georgian sentence finished in
 * English — at precisely the moment they need to understand what happened and
 * what to do about it. Translating server prose on the server would mean
 * threading a locale through every route and every background job; keying off
 * the `code` the responses already carry keeps the API monolingual and puts the
 * translation next to the rest of the UI text.
 *
 * `localizeServerError` falls back to the server's own English string for any
 * code not listed here, so an untranslated or newly added error degrades to the
 * previous behaviour instead of showing the user nothing.
 */

export interface LocalizedServerMessage {
  readonly en: string;
  readonly ka: string;
}

/**
 * Codes are the contract. When adding one, keep the Georgian actionable — say
 * what to do, not only what failed.
 */
export const SERVER_ERROR_MESSAGES: Readonly<Record<string, LocalizedServerMessage>> = {
  // --- Sync ceilings -------------------------------------------------------
  sync_payload_too_large: {
    en: 'This workspace has more pending changes than one sync can carry. Files attached while offline are the usual cause: stay connected so they upload to file storage, or remove them and re-attach as a link. Nothing was lost — your changes are still on this device.',
    ka: 'ამ სამუშაო სივრცეს იმაზე მეტი შეუნახავი ცვლილება აქვს, ვიდრე ერთ სინქრონიზაციაში ეტევა. ჩვეულებრივ ამის მიზეზი ოფლაინ რეჟიმში მიმაგრებული ფაილებია: დარჩით ონლაინ, რომ ისინი ფაილსაცავში აიტვირთოს, ან წაშალეთ და ხელახლა მიამაგრეთ ბმულის სახით. არაფერი დაკარგულა — თქვენი ცვლილებები ამ მოწყობილობაზეა.',
  },
  sync_payload_invalid: {
    en: 'The server could not read this sync request. Your changes were kept for a retry.',
    ka: 'სერვერმა ვერ წაიკითხა ეს სინქრონიზაციის მოთხოვნა. თქვენი ცვლილებები შენახულია ხელახლა მცდელობისთვის.',
  },
  sync_collection_record_limit_exceeded: {
    en: 'One of your record lists has grown past the limit a single sync can carry. Archive older entries, then sync again.',
    ka: 'ერთ-ერთი ჩანაწერების სია გაიზარდა იმაზე მეტად, ვიდრე ერთ სინქრონიზაციაში ეტევა. დააარქივეთ ძველი ჩანაწერები და ხელახლა მოახდინეთ სინქრონიზაცია.',
  },
  sync_total_record_limit_exceeded: {
    en: 'This winery holds more records than one sync can carry. Archive older entries, then sync again.',
    ka: 'ამ მარანს იმაზე მეტი ჩანაწერი აქვს, ვიდრე ერთ სინქრონიზაციაში ეტევა. დააარქივეთ ძველი ჩანაწერები და ხელახლა მოახდინეთ სინქრონიზაცია.',
  },
  sync_tombstone_limit_exceeded: {
    en: 'Too many pending deletions to send at once. Sync the current ones, then continue.',
    ka: 'ერთდროულად გასაგზავნად ძალიან ბევრი შეუნახავი წაშლაა. ჯერ არსებულები დაასინქრონიზეთ, შემდეგ გააგრძელეთ.',
  },
  inline_attachment_budget_exceeded: {
    en: 'This winery has reached its limit for files stored directly in the record. Attach large files as an external link, or remove some existing ones.',
    ka: 'ამ მარანმა ამოწურა უშუალოდ ჩანაწერში შენახული ფაილების ლიმიტი. დიდი ფაილები მიამაგრეთ გარე ბმულით, ან წაშალეთ ზოგიერთი არსებული.',
  },

  // --- Concurrency ---------------------------------------------------------
  org_state_conflict: {
    en: 'This winery changed in another session while saving. Your change was kept and is ready to retry.',
    ka: 'შენახვისას ეს მარანი სხვა სესიაში შეიცვალა. თქვენი ცვლილება შენახულია და ხელახლა გაგზავნისთვის მზადაა.',
  },
  org_context_changed: {
    en: 'You switched to a different winery while this was saving. Nothing was written to the wrong one.',
    ka: 'შენახვის დროს სხვა მარანზე გადახვედით. არასწორ მარანში არაფერი ჩაწერილა.',
  },

  // --- Access and account --------------------------------------------------
  subscription_feature_required: {
    en: 'This feature is not included in the current plan.',
    ka: 'ეს ფუნქცია არ შედის მიმდინარე გეგმაში.',
  },
  email_unverified: {
    en: 'Confirm your email address before signing in.',
    ka: 'შესვლამდე დაადასტურეთ თქვენი ელფოსტის მისამართი.',
  },
  approval_pending: {
    en: 'Your registration is waiting for an administrator to approve it.',
    ka: 'თქვენი რეგისტრაცია ელოდება ადმინისტრატორის დადასტურებას.',
  },
  approval_rejected: {
    en: 'This registration request was declined.',
    ka: 'ეს სარეგისტრაციო მოთხოვნა უარყოფილია.',
  },
  email_delivery_failed: {
    en: 'The message could not be sent. Check the address and try again.',
    ka: 'შეტყობინების გაგზავნა ვერ მოხერხდა. შეამოწმეთ მისამართი და სცადეთ ხელახლა.',
  },

  // --- Notifications and background services -------------------------------
  whatsapp_not_configured: {
    en: 'WhatsApp notifications are not configured for this workspace.',
    ka: 'ამ სამუშაო სივრცისთვის WhatsApp შეტყობინებები კონფიგურირებული არ არის.',
  },
  whatsapp_opt_in_required: {
    en: 'This person has not agreed to receive WhatsApp notifications.',
    ka: 'ამ პირს არ დაუდასტურებია WhatsApp შეტყობინებების მიღება.',
  },
  whatsapp_phone_required: {
    en: 'A phone number is required to send a WhatsApp notification.',
    ka: 'WhatsApp შეტყობინების გასაგზავნად საჭიროა ტელეფონის ნომერი.',
  },
  whatsapp_delivery_failed: {
    en: 'The WhatsApp notification could not be delivered.',
    ka: 'WhatsApp შეტყობინების ჩაბარება ვერ მოხერხდა.',
  },
  whatsapp_delivery_store_unavailable: {
    en: 'Notification delivery records are temporarily unavailable.',
    ka: 'შეტყობინებების ჩაბარების ჩანაწერები დროებით მიუწვდომელია.',
  },
  ai_operations_unavailable: {
    en: 'Winery Intelligence is temporarily unavailable. Your data is unaffected.',
    ka: 'Winery Intelligence დროებით მიუწვდომელია. თქვენს მონაცემებზე ეს არ მოქმედებს.',
  },
  ai_notification_retry_unavailable: {
    en: 'This notification cannot be retried right now.',
    ka: 'ამ შეტყობინების ხელახლა გაგზავნა ამჟამად შეუძლებელია.',
  },
  billing_storage_unavailable: {
    en: 'Billing records are temporarily unavailable. No charge was made.',
    ka: 'ბილინგის ჩანაწერები დროებით მიუწვდომელია. თანხა არ ჩამოჭრილა.',
  },
};

/**
 * Resolve a server error to the user's language.
 *
 * Falls back to the server's English text, then to a generic localized line, so
 * the user is never shown an empty message or a bare code.
 */
export function localizeServerError(
  code: string | null | undefined,
  serverMessage: string | null | undefined,
  lang: Language,
): string {
  const known = typeof code === 'string' ? SERVER_ERROR_MESSAGES[code] : undefined;
  if (known) return lang === 'ka' ? known.ka : known.en;

  const fallback = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  if (fallback) return fallback;

  return lang === 'ka'
    ? 'მოქმედება ვერ შესრულდა. სცადეთ ხელახლა.'
    : 'The action could not be completed. Please try again.';
}

/** True when the code has a translation, so callers can tell prose from a fallback. */
export function hasLocalizedServerError(code: string | null | undefined): boolean {
  return typeof code === 'string' && code in SERVER_ERROR_MESSAGES;
}
