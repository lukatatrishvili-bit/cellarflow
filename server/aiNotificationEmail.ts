import type { MailMessage } from './mailer';
import type { AiNotificationPayload } from './aiNotificationOutbox';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localized(value: { en: string; ka: string }, language: 'en' | 'ka'): string {
  return language === 'ka' ? value.ka : value.en;
}

function singleLine(value: string, max = 160): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const SEVERITY: Record<AiNotificationPayload['severity'], { en: string; ka: string }> = {
  critical: { en: 'Critical', ka: 'კრიტიკული' },
  warning: { en: 'Warning', ka: 'გაფრთხილება' },
  attention: { en: 'Attention', ka: 'საყურადღებო' },
  info: { en: 'Information', ka: 'ინფორმაცია' },
};

/** Builds a deliberately compact email from the validated outbox projection. */
export function buildAiFindingEmail(input: {
  to: string;
  language: 'en' | 'ka';
  wineryName: string;
  payload: AiNotificationPayload;
  appUrl?: string;
}): MailMessage {
  const { payload, language } = input;
  const ka = language === 'ka';
  const wineryName = singleLine(input.wineryName || 'Winery', 100);
  const severity = SEVERITY[payload.severity][language];
  const title = singleLine(localized(payload.title, language), 180);
  const observation = localized(payload.observation, language).trim();
  const whyItMatters = localized(payload.whyItMatters, language).trim();
  const entity = singleLine(payload.entityLabel || payload.entityId, 160);
  const configuredUrl = (input.appUrl || '').trim().replace(/\/+$/, '');
  const dashboardUrl = configuredUrl ? `${configuredUrl}/` : '';

  const subject = singleLine(`[${severity}] ${wineryName} — ${title}`, 200);
  const text = [
    `${severity}: ${title}`,
    `${ka ? 'ობიექტი' : 'Entity'}: ${entity}`,
    '',
    observation,
    '',
    `${ka ? 'რატომ არის მნიშვნელოვანი' : 'Why it matters'}:`,
    whyItMatters,
    dashboardUrl ? `\n${ka ? 'გახსენით მარნის ინტელექტი' : 'Open Winery Intelligence'}: ${dashboardUrl}` : '',
    '',
    ka
      ? 'ეს ავტომატური შეტყობინებაა. გადაწყვეტილებამდე გადაამოწმეთ ჩანაწერები VinOS-ში.'
      : 'This is an automated alert. Review the source records in VinOS before acting.',
  ].filter(Boolean).join('\n');

  const safeUrl = dashboardUrl ? escapeHtml(dashboardUrl) : '';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fcfbfa;padding:32px 16px;color:#2c221e;line-height:1.55">
      <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #ebdcd0;border-radius:14px;overflow:hidden">
        <div style="background:#4e0e15;padding:24px 28px;color:#fff">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.12em">${escapeHtml(severity)}</div>
          <h1 style="font-family:Georgia,serif;font-size:21px;margin:8px 0 0">${escapeHtml(title)}</h1>
        </div>
        <div style="padding:28px">
          <p style="font-size:12px;color:#7a6c69;margin:0 0 18px"><strong>${escapeHtml(ka ? 'ობიექტი' : 'Entity')}:</strong> ${escapeHtml(entity)}</p>
          <p style="font-size:15px;margin:0 0 22px">${escapeHtml(observation)}</p>
          <h2 style="font-family:Georgia,serif;color:#4e0e15;font-size:16px;margin:0 0 8px">${escapeHtml(ka ? 'რატომ არის მნიშვნელოვანი' : 'Why it matters')}</h2>
          <p style="font-size:14px;margin:0 0 24px">${escapeHtml(whyItMatters)}</p>
          ${safeUrl ? `<p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#801323;color:#fff;text-decoration:none;border-radius:8px;padding:11px 18px;font-weight:700">${escapeHtml(ka ? 'მარნის ინტელექტის გახსნა' : 'Open Winery Intelligence')}</a></p>` : ''}
          <p style="font-size:12px;color:#8c7f7e;border-top:1px solid #ebdcd0;padding-top:18px;margin:0">${escapeHtml(
            ka
              ? 'ეს ავტომატური შეტყობინებაა. გადაწყვეტილებამდე გადაამოწმეთ ჩანაწერები VinOS-ში.'
              : 'This is an automated alert. Review the source records in VinOS before acting.',
          )}</p>
        </div>
      </div>
    </div>
  `;
  return { to: input.to, subject, text, html };
}
