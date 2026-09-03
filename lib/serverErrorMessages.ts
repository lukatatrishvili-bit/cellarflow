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

  // --- Destructive administration ------------------------------------------
  orphaned_organizations_require_confirmation: {
    en: 'Deleting this account would leave one or more wineries with no members, and their records would be destroyed with it. Review the listed wineries and confirm, or add another member first to keep the history.',
    ka: 'ამ ანგარიშის წაშლის შემდეგ ერთ ან რამდენიმე მარანს წევრი აღარ დარჩება და მათი ჩანაწერებიც განადგურდება. გადახედეთ ჩამონათვალს და დაადასტურეთ, ან ჯერ დაამატეთ სხვა წევრი, რომ ისტორია შენარჩუნდეს.',
  },
  last_organization_member: {
    en: 'The last member cannot be removed. Assign another user first, or delete the organization from its settings.',
    ka: 'ბოლო წევრის წაშლა შეუძლებელია. ჯერ დაამატეთ სხვა მომხმარებელი, ან ორგანიზაცია მისი პარამეტრებიდან წაშალეთ.',
  },
  organization_deletion_requires_confirmation: {
    en: 'Type the organization name exactly as shown before permanently deleting its records and memberships.',
    ka: 'ჩანაწერებისა და წევრობების სამუდამოდ წაშლამდე ორგანიზაციის სახელი ზუსტად ისე აკრიფეთ, როგორც ნაჩვენებია.',
  },
  organization_suspended: {
    en: 'This organization is suspended. Ask the master administrator to restore access.',
    ka: 'ეს ორგანიზაცია შეჩერებულია. წვდომის აღსადგენად მიმართეთ მთავარ ადმინისტრატორს.',
  },
  organization_archived: {
    en: 'This organization is archived. Ask the master administrator to restore it.',
    ka: 'ეს ორგანიზაცია დაარქივებულია. აღსადგენად მიმართეთ მთავარ ადმინისტრატორს.',
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
  workflow_approval_required: {
    en: 'This command is waiting for an owner to approve it. Its exact details are saved; retry the same command after approval.',
    ka: 'ეს ბრძანება მფლობელის დამტკიცებას ელოდება. ზუსტი დეტალები შენახულია; დამტკიცების შემდეგ იგივე ბრძანება ხელახლა გააგზავნეთ.',
  },
  workflow_approval_payload_changed: {
    en: 'The command details changed after review. Cancel this request and submit the revised command for a new approval.',
    ka: 'განხილვის შემდეგ ბრძანების დეტალები შეიცვალა. გააუქმეთ ეს მოთხოვნა და შეცვლილი ბრძანება ახალი დამტკიცებისთვის გაგზავნეთ.',
  },
  workflow_approval_retry_required: {
    en: 'The approval queue changed while saving. Your command is still pending; retry it with the same details.',
    ka: 'შენახვისას დამტკიცების რიგი შეიცვალა. ბრძანება კვლავ მოლოდინშია; იგივე დეტალებით ხელახლა სცადეთ.',
  },
  workflow_approval_rejected: {
    en: 'An owner rejected this command. Review the decision note before creating a new command.',
    ka: 'მფლობელმა ეს ბრძანება უარყო. ახალი ბრძანების შექმნამდე გადაწყვეტილების შენიშვნა წაიკითხეთ.',
  },
  workflow_approval_cancelled: {
    en: 'This approval request was cancelled. Create a new command if the work is still required.',
    ka: 'დამტკიცების მოთხოვნა გაუქმებულია. თუ სამუშაო კვლავ საჭიროა, შექმენით ახალი ბრძანება.',
  },
  first_name_required: {
    en: 'Enter your first name.',
    ka: 'შეიყვანეთ თქვენი სახელი.',
  },
  last_name_required: {
    en: 'Enter your last name.',
    ka: 'შეიყვანეთ თქვენი გვარი.',
  },
  first_name_invalid: {
    en: 'Enter a valid first name using letters.',
    ka: 'შეიყვანეთ სწორი სახელი ასოებით.',
  },
  last_name_invalid: {
    en: 'Enter a valid last name using letters.',
    ka: 'შეიყვანეთ სწორი გვარი ასოებით.',
  },
  phone_required: {
    en: 'Enter a reachable phone number.',
    ka: 'შეიყვანეთ მოქმედი ტელეფონის ნომერი.',
  },
  phone_invalid: {
    en: 'Enter a valid phone number with country code, for example +995 555 12 34 56.',
    ka: 'შეიყვანეთ სწორი ნომერი ქვეყნის კოდით, მაგალითად +995 555 12 34 56.',
  },
  company_name_required: {
    en: 'Enter the company or estate name.',
    ka: 'შეიყვანეთ კომპანიის ან მამულის სახელი.',
  },
  google_registration_expired: {
    en: 'Your Google registration session expired. Continue with Google again.',
    ka: 'Google-ის რეგისტრაციის სესიას ვადა გაუვიდა. თავიდან გააგრძელეთ Google-ით.',
  },
  account_exists: {
    en: 'An account with this email already exists. Return to sign in with Google.',
    ka: 'ამ ელფოსტით ანგარიში უკვე არსებობს. დაბრუნდით და შედით Google-ით.',
  },
  registration_profile_incomplete: {
    en: 'This request is missing required identity or contact details and cannot be approved yet.',
    ka: 'ამ მოთხოვნას აკლია სავალდებულო პირადი ან საკონტაქტო მონაცემები და ჯერ ვერ დამტკიცდება.',
  },
  email_delivery_failed: {
    en: 'The message could not be sent. Check the address and try again.',
    ka: 'შეტყობინების გაგზავნა ვერ მოხერხდა. შეამოწმეთ მისამართი და სცადეთ ხელახლა.',
  },
  cross_origin_rejected: {
    en: 'This request was blocked because it did not come from the app itself. Reload the page and try again.',
    ka: 'ეს მოთხოვნა დაიბლოკა, რადგან თავად აპლიკაციიდან არ მოსულა. გადატვირთეთ გვერდი და სცადეთ ხელახლა.',
  },
  rate_limited: {
    en: 'Too many requests from this account in a short time. Your changes are kept — wait a moment and they will sync.',
    ka: 'ამ ანგარიშიდან მოკლე დროში ძალიან ბევრი მოთხოვნა შევიდა. თქვენი ცვლილებები შენახულია — მოიცადეთ და დასინქრონდება.',
  },

  // --- Notifications and background services -------------------------------
  notification_opt_in_required: {
    en: 'This person has email and browser push notifications turned off.',
    ka: 'ამ პირს ელფოსტისა და ბრაუზერის Push შეტყობინებები გამორთული აქვს.',
  },
  notification_suppressed: {
    en: 'This person has paused or turned off notifications. The task is still saved; they can review it in the app when ready.',
    ka: 'ამ პირს შეტყობინებები დროებით შეჩერებული ან გამორთული აქვს. დავალება მაინც შენახულია და აპში მისთვის სასურველ დროს ნახავს.',
  },
  ai_operations_unavailable: {
    en: 'Winery Intelligence is temporarily unavailable. Your data is unaffected.',
    ka: 'Winery Intelligence დროებით მიუწვდომელია. თქვენს მონაცემებზე ეს არ მოქმედებს.',
  },
  ai_budget_exhausted: {
    en: 'This winery has used its AI allowance for today. It resets tomorrow, or an administrator can raise the daily limit in AI settings.',
    ka: 'ამ მარანმა დღეს AI-ის ლიმიტი ამოწურა. ის ხვალ განახლდება, ან ადმინისტრატორს შეუძლია დღიური ლიმიტი AI-ის პარამეტრებში გაზარდოს.',
  },
  ai_provider_rate_limited: {
    en: 'The AI service is busy right now. Nothing was lost — ask again in a moment.',
    ka: 'AI სერვისი ამჟამად დატვირთულია. არაფერი დაკარგულა — სცადეთ ერთ წუთში.',
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
