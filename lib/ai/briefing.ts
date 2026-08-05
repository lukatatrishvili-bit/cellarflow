import type { Language } from '../i18n';
import { SEVERITY_LABELS } from './labels';
import { wineryStatus, type WineryStatus } from './orchestrator';
import { filterFindingsRoutedToRole } from './roles';
import { localize, text, type LocalizedText } from './text';
import { severityRank, type AiFindingRecord, type UserRole } from './types';

/**
 * The daily briefing exists to replace opening every module. It ranks rather
 * than lists: a section that would be a wall of low-value rows is collapsed to
 * a count, and a quiet winery gets an explicit "nothing needs you today"
 * instead of an empty page.
 */

export type BriefingSectionKey = 'critical' | 'attention' | 'vineyard' | 'operations' | 'everythingElse';

export interface BriefingSection {
  key: BriefingSectionKey;
  title: LocalizedText;
  findings: AiFindingRecord[];
  /** Findings in this section beyond the display cap. */
  overflow: number;
}

export interface DailyBriefing {
  date: string;
  greeting: LocalizedText;
  status: WineryStatus;
  headline: LocalizedText;
  sections: BriefingSection[];
  openCount: number;
  /** Findings withheld because they sit below the winery's notification threshold. */
  suppressedCount: number;
}

const SECTION_TITLES: Record<BriefingSectionKey, LocalizedText> = {
  critical: text('Critical', 'კრიტიკული'),
  attention: text('Attention', 'ყურადღება'),
  vineyard: text('Vineyard', 'ვენახი'),
  operations: text('Operations', 'ოპერაციები'),
  everythingElse: text('Everything else', 'დანარჩენი'),
};

const SECTION_LIMIT = 5;

function greetingFor(hour: number): LocalizedText {
  if (hour < 12) return text('Good morning', 'დილა მშვიდობისა');
  if (hour < 18) return text('Good afternoon', 'დღე მშვიდობისა');
  return text('Good evening', 'საღამო მშვიდობისა');
}

function sectionFor(finding: AiFindingRecord): BriefingSectionKey {
  if (finding.severity === 'critical') return 'critical';
  if (finding.severity === 'warning') return 'attention';
  if (finding.area === 'vineyard') return 'vineyard';
  if (finding.area === 'operations' || finding.area === 'inventory' || finding.area === 'compliance') {
    return 'operations';
  }
  return 'everythingElse';
}

export interface BriefingOptions {
  role?: UserRole;
  now?: Date;
  /** Findings below this severity are counted but not listed. */
  minimumSeverity?: AiFindingRecord['severity'];
}

const OPEN_STATUSES = new Set(['new', 'reviewed', 'accepted']);

export function buildDailyBriefing(
  records: AiFindingRecord[],
  options: BriefingOptions = {},
): DailyBriefing {
  const now = options.now || new Date();
  const open = records.filter((record) => OPEN_STATUSES.has(record.status));
  // Routing, not visibility: a briefing is what *you* are responsible for.
  const scoped = options.role ? filterFindingsRoutedToRole(open, options.role) : open;

  const threshold = options.minimumSeverity || 'info';
  const visible = scoped.filter((record) => severityRank(record.severity) >= severityRank(threshold));
  const suppressedCount = scoped.length - visible.length;

  const buckets = new Map<BriefingSectionKey, AiFindingRecord[]>();
  for (const record of visible) {
    const key = sectionFor(record);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(record);
    else buckets.set(key, [record]);
  }

  const order: BriefingSectionKey[] = ['critical', 'attention', 'vineyard', 'operations', 'everythingElse'];
  const sections: BriefingSection[] = [];
  for (const key of order) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length === 0) continue;
    const sorted = [...bucket].sort((a, b) => {
      const bySeverity = severityRank(b.severity) - severityRank(a.severity);
      if (bySeverity !== 0) return bySeverity;
      return b.confidence.score - a.confidence.score;
    });
    sections.push({
      key,
      title: SECTION_TITLES[key],
      findings: sorted.slice(0, SECTION_LIMIT),
      overflow: Math.max(0, sorted.length - SECTION_LIMIT),
    });
  }

  const status = wineryStatus(records);
  const criticalCount = visible.filter((record) => record.severity === 'critical').length;
  const warningCount = visible.filter((record) => record.severity === 'warning').length;

  const headline: LocalizedText = visible.length === 0
    ? text('No significant issues detected.', 'მნიშვნელოვანი პრობლემები არ არის აღმოჩენილი.')
    : criticalCount > 0
      ? text(
        `${criticalCount} critical ${criticalCount === 1 ? 'issue needs' : 'issues need'} attention today${warningCount > 0 ? `, plus ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}.`,
        `დღეს ${criticalCount} კრიტიკული საკითხი საჭიროებს ყურადღებას${warningCount > 0 ? `, დამატებით ${warningCount} გაფრთხილება` : ''}.`,
      )
      : text(
        `${visible.length} ${visible.length === 1 ? 'item needs' : 'items need'} attention today.`,
        `დღეს ${visible.length} საკითხი საჭიროებს ყურადღებას.`,
      );

  return {
    date: now.toISOString().slice(0, 10),
    greeting: greetingFor(now.getHours()),
    status,
    headline,
    sections,
    openCount: visible.length,
    suppressedCount,
  };
}

/**
 * Flat text rendering for channels without a UI (email, browser push, a log line).
 * Uses the same ranked structure so the message a winemaker gets on their phone
 * matches the dashboard they will open later.
 */
export function renderBriefingText(briefing: DailyBriefing, lang: Language): string {
  const lines: string[] = [
    `${localize(briefing.greeting, lang)} — ${briefing.date}`,
    localize(briefing.headline, lang),
  ];

  for (const section of briefing.sections) {
    lines.push('', localize(section.title, lang).toUpperCase());
    for (const finding of section.findings) {
      lines.push(
        `• [${localize(SEVERITY_LABELS[finding.severity], lang)}] ${localize(finding.title, lang)}`,
        `  ${localize(finding.observation, lang)}`,
      );
    }
    if (section.overflow > 0) {
      lines.push(lang === 'ka'
        ? `  …და კიდევ ${section.overflow}`
        : `  …and ${section.overflow} more`);
    }
  }

  if (briefing.suppressedCount > 0) {
    lines.push('', lang === 'ka'
      ? `${briefing.suppressedCount} დაბალი პრიორიტეტის დაკვირვება დამალულია თქვენი შეტყობინებების ზღვრის მიხედვით.`
      : `${briefing.suppressedCount} lower-priority observation(s) hidden by your notification threshold.`);
  }

  return lines.join('\n');
}
