import type {
  AiFeedbackVerdict,
  AiFindingFeedback,
  AiFindingRecord,
  AiFindingSource,
  AiMonitoringArea,
} from './types';

export const AI_FEEDBACK_VERDICTS = [
  'helpful',
  'not_helpful',
  'incorrect',
  'already_handled',
] as const satisfies readonly AiFeedbackVerdict[];

const MAX_FEEDBACK_ENTRIES_PER_FINDING = 100;
const MAX_FEEDBACK_COMMENT_LENGTH = 1_000;
const MAX_CALIBRATION_CANDIDATES = 20;
export const AI_CALIBRATION_MIN_QUALITY_RESPONSES = 5;
export const AI_CALIBRATION_MIN_FINDINGS = 3;
export const AI_CALIBRATION_INCORRECT_RATE_THRESHOLD = 0.2;
export const AI_CALIBRATION_NEGATIVE_RATE_THRESHOLD = 0.4;
/**
 * `already_handled` does not mean the detector is wrong — it means it fires
 * after the winemaker has already acted. Past this share of all verdicts the
 * alert has stopped carrying information, so it is muted for a different reason
 * and a higher bar than an incorrect one.
 */
export const AI_CALIBRATION_ALREADY_HANDLED_RATE_THRESHOLD = 0.6;
const VERDICT_SET = new Set<string>(AI_FEEDBACK_VERDICTS);

export function isAiFeedbackVerdict(value: unknown): value is AiFeedbackVerdict {
  return typeof value === 'string' && VERDICT_SET.has(value);
}

export interface AiFeedbackCounts {
  helpful: number;
  not_helpful: number;
  incorrect: number;
  already_handled: number;
}

export interface AiFeedbackSourceSummary {
  totalResponses: number;
  counts: AiFeedbackCounts;
}

export interface AiDetectorCalibrationCandidate {
  findingType: string;
  source: AiFindingSource;
  area: AiMonitoringArea;
  findingsReviewed: number;
  totalResponses: number;
  qualityResponses: number;
  counts: AiFeedbackCounts;
  helpfulRate: number;
  incorrectRate: number;
  negativeRate: number;
  alreadyHandledRate: number;
}

export interface AiDetectorCalibrationSummary {
  minimumQualityResponses: number;
  minimumFindings: number;
  detectorsWithFeedback: number;
  assessedDetectors: number;
  needsReview: number;
  /** Highest-risk advisory candidates only, capped for the operations payload. */
  candidates: AiDetectorCalibrationCandidate[];
}

export interface AiFeedbackQualitySummary {
  totalResponses: number;
  /** Helpful/not-helpful/incorrect verdicts; excludes the timeliness signal. */
  qualityResponses: number;
  findingsWithFeedback: number;
  counts: AiFeedbackCounts;
  helpfulRate: number;
  incorrectRate: number;
  alreadyHandledRate: number;
  bySource: Record<AiFindingSource, AiFeedbackSourceSummary>;
  calibration: AiDetectorCalibrationSummary;
}

function emptyCounts(): AiFeedbackCounts {
  return {
    helpful: 0,
    not_helpful: 0,
    incorrect: 0,
    already_handled: 0,
  };
}

interface DetectorAccumulator {
  findingType: string;
  source: AiFindingSource;
  area: AiMonitoringArea;
  findingsReviewed: number;
  totalResponses: number;
  qualityResponses: number;
  counts: AiFeedbackCounts;
}

/** Stable identity of "this kind of finding, from this producer, in this area". */
export function detectorKey(
  finding: Pick<AiFindingRecord, 'findingType' | 'source' | 'area'>,
): string {
  return `${finding.source}\u0000${finding.area}\u0000${finding.findingType}`;
}

function detectorCandidate(
  detector: DetectorAccumulator,
): AiDetectorCalibrationCandidate {
  return {
    findingType: detector.findingType,
    source: detector.source,
    area: detector.area,
    findingsReviewed: detector.findingsReviewed,
    totalResponses: detector.totalResponses,
    qualityResponses: detector.qualityResponses,
    counts: detector.counts,
    helpfulRate: detector.qualityResponses > 0
      ? detector.counts.helpful / detector.qualityResponses
      : 0,
    incorrectRate: detector.qualityResponses > 0
      ? detector.counts.incorrect / detector.qualityResponses
      : 0,
    negativeRate: detector.qualityResponses > 0
      ? (detector.counts.not_helpful + detector.counts.incorrect) / detector.qualityResponses
      : 0,
    alreadyHandledRate: detector.totalResponses > 0
      ? detector.counts.already_handled / detector.totalResponses
      : 0,
  };
}

function normalizeComment(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const comment = value.trim().slice(0, MAX_FEEDBACK_COMMENT_LENGTH);
  return comment || undefined;
}

function normalizeStoredFeedback(value: unknown): AiFindingFeedback | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isAiFeedbackVerdict(candidate.verdict)) return null;
  if (typeof candidate.submittedBy !== 'string' || !candidate.submittedBy.trim()) return null;
  if (typeof candidate.submittedAt !== 'string' || !candidate.submittedAt.trim()) return null;
  return {
    verdict: candidate.verdict,
    comment: normalizeComment(candidate.comment),
    submittedBy: candidate.submittedBy.trim(),
    submittedAt: candidate.submittedAt,
  };
}

/**
 * Reads the new history and the legacy single-review field into one canonical
 * list. A reviewer owns one current verdict per finding; the latest copy wins.
 */
export function findingFeedbackEntries(
  finding: Pick<AiFindingRecord, 'feedback' | 'feedbackEntries'>,
): AiFindingFeedback[] {
  const candidates = [
    ...(Array.isArray(finding.feedbackEntries) ? finding.feedbackEntries : []),
    finding.feedback,
  ];
  const byReviewer = new Map<string, AiFindingFeedback>();
  for (const candidate of candidates) {
    const normalized = normalizeStoredFeedback(candidate);
    if (!normalized?.submittedBy) continue;
    const existing = byReviewer.get(normalized.submittedBy);
    if (!existing || normalized.submittedAt >= existing.submittedAt) {
      byReviewer.set(normalized.submittedBy, normalized);
    }
  }
  return [...byReviewer.values()]
    .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt))
    .slice(-MAX_FEEDBACK_ENTRIES_PER_FINDING);
}

/** Returns only the caller's own review, with reviewer identity removed. */
export function feedbackForViewer(
  finding: Pick<AiFindingRecord, 'feedback' | 'feedbackEntries'>,
  username: string,
): AiFindingFeedback | undefined {
  const own = findingFeedbackEntries(finding)
    .find((entry) => entry.submittedBy === username);
  if (!own) return undefined;
  return {
    verdict: own.verdict,
    comment: own.comment,
    submittedAt: own.submittedAt,
  };
}

/** Replaces this reviewer's verdict without disturbing any other reviewer. */
export function upsertFindingFeedback(
  finding: AiFindingRecord,
  input: {
    username: string;
    verdict: AiFeedbackVerdict;
    comment?: unknown;
    now: string;
  },
): AiFindingRecord {
  const entries = findingFeedbackEntries(finding)
    .filter((entry) => entry.submittedBy !== input.username);
  entries.push({
    verdict: input.verdict,
    comment: normalizeComment(input.comment),
    submittedBy: input.username,
    submittedAt: input.now,
  });
  return {
    ...finding,
    feedback: undefined,
    feedbackEntries: entries.slice(-MAX_FEEDBACK_ENTRIES_PER_FINDING),
    lastModified: input.now,
  };
}

/** Per-detector rates for every detector that has any feedback at all. */
function detectorRates(
  findings: readonly AiFindingRecord[],
): AiDetectorCalibrationCandidate[] {
  const accumulators = new Map<string, DetectorAccumulator>();
  for (const finding of findings) {
    const entries = findingFeedbackEntries(finding);
    if (entries.length === 0) continue;
    const key = detectorKey(finding);
    let detector = accumulators.get(key);
    if (!detector) {
      detector = {
        findingType: finding.findingType,
        source: finding.source,
        area: finding.area,
        findingsReviewed: 0,
        totalResponses: 0,
        qualityResponses: 0,
        counts: emptyCounts(),
      };
      accumulators.set(key, detector);
    }
    detector.findingsReviewed += 1;
    for (const entry of entries) {
      detector.totalResponses += 1;
      detector.counts[entry.verdict] += 1;
      if (entry.verdict !== 'already_handled') detector.qualityResponses += 1;
    }
  }
  return [...accumulators.values()].map(detectorCandidate);
}

export type AiDetectorMuteReason = 'incorrect' | 'unhelpful' | 'already_handled';

export interface AiDetectorMute extends AiDetectorCalibrationCandidate {
  reason: AiDetectorMuteReason;
}

/** Why this winery's own verdicts disqualify a detector, if they do. */
function muteReason(
  detector: AiDetectorCalibrationCandidate,
): AiDetectorMuteReason | null {
  if (detector.findingsReviewed < AI_CALIBRATION_MIN_FINDINGS) return null;
  if (detector.qualityResponses >= AI_CALIBRATION_MIN_QUALITY_RESPONSES) {
    if (detector.incorrectRate >= AI_CALIBRATION_INCORRECT_RATE_THRESHOLD) return 'incorrect';
    if (detector.negativeRate >= AI_CALIBRATION_NEGATIVE_RATE_THRESHOLD) return 'unhelpful';
  }
  // Counted against every verdict, because a detector can be unanimously
  // "already handled" and so have no quality responses at all.
  if (
    detector.totalResponses >= AI_CALIBRATION_MIN_QUALITY_RESPONSES
    && detector.alreadyHandledRate >= AI_CALIBRATION_ALREADY_HANDLED_RATE_THRESHOLD
  ) return 'already_handled';
  return null;
}

/**
 * Detectors this winery's reviewers have disqualified, keyed by `detectorKey`.
 *
 * Computed from one organization's own findings and used only within it: this
 * is a winery calibrating its own alerts, never cross-tenant learning.
 */
export function mutedDetectors(
  findings: readonly AiFindingRecord[],
): Map<string, AiDetectorMute> {
  const muted = new Map<string, AiDetectorMute>();
  for (const detector of detectorRates(findings)) {
    const reason = muteReason(detector);
    if (reason) muted.set(detectorKey(detector), { ...detector, reason });
  }
  return muted;
}

/** The winery's own verdict history for one detector, for the ops view and prompts. */
export function detectorTrackRecord(
  findings: readonly AiFindingRecord[],
  finding: Pick<AiFindingRecord, 'findingType' | 'source' | 'area'>,
): AiDetectorCalibrationCandidate | undefined {
  const key = detectorKey(finding);
  return detectorRates(findings).find((detector) => detectorKey(detector) === key);
}

/**
 * Produces aggregate quality signals only. Reviewer names and comments cannot
 * enter the operations payload because this return type has nowhere for them.
 */
export function summarizeAiFindingFeedback(
  findings: readonly AiFindingRecord[],
): AiFeedbackQualitySummary {
  const detectorAccumulators = new Map<string, DetectorAccumulator>();
  const summary: AiFeedbackQualitySummary = {
    totalResponses: 0,
    qualityResponses: 0,
    findingsWithFeedback: 0,
    counts: emptyCounts(),
    helpfulRate: 0,
    incorrectRate: 0,
    alreadyHandledRate: 0,
    bySource: {
      rule: { totalResponses: 0, counts: emptyCounts() },
      model: { totalResponses: 0, counts: emptyCounts() },
      hybrid: { totalResponses: 0, counts: emptyCounts() },
    },
    calibration: {
      minimumQualityResponses: AI_CALIBRATION_MIN_QUALITY_RESPONSES,
      minimumFindings: AI_CALIBRATION_MIN_FINDINGS,
      detectorsWithFeedback: 0,
      assessedDetectors: 0,
      needsReview: 0,
      candidates: [],
    },
  };

  for (const finding of findings) {
    const entries = findingFeedbackEntries(finding);
    if (entries.length > 0) summary.findingsWithFeedback += 1;
    let detector: DetectorAccumulator | undefined;
    if (entries.length > 0) {
      const key = detectorKey(finding);
      detector = detectorAccumulators.get(key);
      if (!detector) {
        detector = {
          findingType: finding.findingType,
          source: finding.source,
          area: finding.area,
          findingsReviewed: 0,
          totalResponses: 0,
          qualityResponses: 0,
          counts: emptyCounts(),
        };
        detectorAccumulators.set(key, detector);
      }
      detector.findingsReviewed += 1;
    }
    for (const entry of entries) {
      summary.totalResponses += 1;
      summary.counts[entry.verdict] += 1;
      if (entry.verdict !== 'already_handled') summary.qualityResponses += 1;
      summary.bySource[finding.source].totalResponses += 1;
      summary.bySource[finding.source].counts[entry.verdict] += 1;
      if (detector) {
        detector.totalResponses += 1;
        detector.counts[entry.verdict] += 1;
        if (entry.verdict !== 'already_handled') detector.qualityResponses += 1;
      }
    }
  }

  if (summary.qualityResponses > 0) {
    summary.helpfulRate = summary.counts.helpful / summary.qualityResponses;
    summary.incorrectRate = summary.counts.incorrect / summary.qualityResponses;
  }
  if (summary.totalResponses > 0) {
    summary.alreadyHandledRate = summary.counts.already_handled / summary.totalResponses;
  }

  const detectorSummaries = [...detectorAccumulators.values()]
    .map(detectorCandidate);
  const assessed = detectorSummaries.filter((detector) => (
    detector.qualityResponses >= AI_CALIBRATION_MIN_QUALITY_RESPONSES
    && detector.findingsReviewed >= AI_CALIBRATION_MIN_FINDINGS
  ));
  const candidates = assessed
    .filter((detector) => (
      detector.incorrectRate >= AI_CALIBRATION_INCORRECT_RATE_THRESHOLD
      || detector.negativeRate >= AI_CALIBRATION_NEGATIVE_RATE_THRESHOLD
    ))
    .sort((left, right) => (
      right.incorrectRate - left.incorrectRate
      || right.negativeRate - left.negativeRate
      || right.qualityResponses - left.qualityResponses
      || left.findingType.localeCompare(right.findingType)
    ));
  summary.calibration.detectorsWithFeedback = detectorSummaries.length;
  summary.calibration.assessedDetectors = assessed.length;
  summary.calibration.needsReview = candidates.length;
  summary.calibration.candidates = candidates.slice(0, MAX_CALIBRATION_CANDIDATES);
  return summary;
}
