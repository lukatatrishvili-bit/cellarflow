import { text, type LocalizedText } from './text';
import type {
  AiAgentKey,
  AiConfidenceLevel,
  AiEvidenceKind,
  AiFeedbackVerdict,
  AiFindingStatus,
  AiMonitoringArea,
  AiRecommendedActionKind,
  AiSeverity,
} from './types';

export const SEVERITY_LABELS: Record<AiSeverity, LocalizedText> = {
  info: text('Info', 'ინფორმაცია'),
  attention: text('Attention', 'ყურადღება'),
  warning: text('Warning', 'გაფრთხილება'),
  critical: text('Critical', 'კრიტიკული'),
};

export const AGENT_LABELS: Record<AiAgentKey, LocalizedText> = {
  winemaking: text('Winemaking', 'მეღვინეობა'),
  vineyard: text('Vineyard', 'ვენახი'),
  laboratory: text('Laboratory', 'ლაბორატორია'),
  inventory: text('Inventory', 'მარაგები'),
  compliance: text('Compliance', 'შესაბამისობა'),
  management: text('Management', 'მენეჯმენტი'),
};

export const AREA_LABELS: Record<AiMonitoringArea, LocalizedText> = {
  fermentation: text('Fermentation', 'დუღილი'),
  laboratory: text('Laboratory', 'ლაბორატორია'),
  inventory: text('Inventory', 'მარაგები'),
  vineyard: text('Vineyard', 'ვენახი'),
  compliance: text('Compliance', 'შესაბამისობა'),
  operations: text('Operations', 'ოპერაციები'),
};

export const STATUS_LABELS: Record<AiFindingStatus, LocalizedText> = {
  new: text('New', 'ახალი'),
  reviewed: text('Reviewed', 'განხილული'),
  accepted: text('Accepted', 'მიღებული'),
  rejected: text('Rejected', 'უარყოფილი'),
  resolved: text('Resolved', 'მოგვარებული'),
  dismissed: text('Dismissed', 'გაუქმებული'),
};

export const FEEDBACK_LABELS: Record<AiFeedbackVerdict, LocalizedText> = {
  helpful: text('Helpful', 'სასარგებლო'),
  not_helpful: text('Not helpful', 'უსარგებლო'),
  incorrect: text('Incorrect', 'არასწორი'),
  already_handled: text('Already handled', 'უკვე მოგვარებულია'),
};

export const CONFIDENCE_LABELS: Record<AiConfidenceLevel, LocalizedText> = {
  low: text('Low confidence', 'დაბალი სანდოობა'),
  medium: text('Medium confidence', 'საშუალო სანდოობა'),
  high: text('High confidence', 'მაღალი სანდოობა'),
};

/**
 * The fact / inference / prediction / recommendation split is shown in the UI
 * so a winemaker can tell a measurement from the layer's reasoning at a glance.
 */
export const EVIDENCE_KIND_LABELS: Record<AiEvidenceKind, LocalizedText> = {
  fact: text('Fact', 'ფაქტი'),
  inference: text('Inference', 'დასკვნა'),
  prediction: text('Prediction', 'პროგნოზი'),
  recommendation: text('Recommendation', 'რეკომენდაცია'),
};

export const ACTION_KIND_LABELS: Record<AiRecommendedActionKind, LocalizedText> = {
  check: text('Check', 'შემოწმება'),
  measure: text('Measure', 'გაზომვა'),
  create_task: text('Create task', 'დავალების შექმნა'),
  notify: text('Notify', 'შეტყობინება'),
  purchase: text('Purchase', 'შესყიდვა'),
  schedule: text('Schedule', 'დაგეგმვა'),
  document: text('Document', 'დოკუმენტირება'),
  inspect: text('Inspect', 'დათვალიერება'),
};

/** Section headings used by both the finding card and the daily briefing. */
export const SECTION_LABELS = {
  observation: text('Observation', 'დაკვირვება'),
  whyItMatters: text('Why this matters', 'რატომ არის მნიშვნელოვანი'),
  possibleCauses: text('Possible causes', 'შესაძლო მიზეზები'),
  recommendedActions: text('Recommended checks', 'რეკომენდებული შემოწმებები'),
  evidence: text('Data used', 'გამოყენებული მონაცემები'),
  confidence: text('Confidence', 'სანდოობა'),
  missingInformation: text('Missing information', 'აკლია ინფორმაცია'),
} satisfies Record<string, LocalizedText>;
