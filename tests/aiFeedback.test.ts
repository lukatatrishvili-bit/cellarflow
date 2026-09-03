import { describe, expect, it } from 'vitest';
import {
  feedbackForViewer,
  findingFeedbackEntries,
  summarizeAiFindingFeedback,
  upsertFindingFeedback,
  type AiFindingRecord,
  type AiFindingSource,
} from '../lib/ai';

function finding(source: AiFindingSource = 'rule'): AiFindingRecord {
  return {
    id: `feedback-${source}`,
    createdAt: '2026-07-29T10:00:00.000Z',
    source,
    agent: 'laboratory',
    area: 'laboratory',
    findingType: 'lab_gap',
    severity: 'warning',
    entityType: 'lot',
    entityId: 'L1',
    entityLabel: 'Saperavi (L1)',
    relatedEntities: [],
    title: { en: 'Analysis overdue', ka: 'ანალიზი დაგვიანებულია' },
    observation: { en: 'No recent analysis.', ka: 'ბოლო ანალიზი არ არის.' },
    whyItMatters: { en: 'Review is needed.', ka: 'საჭიროა გადახედვა.' },
    possibleCauses: [],
    recommendedActions: [],
    evidence: [],
    confidence: { level: 'high', score: 1, reasons: [] },
    missingInformation: [],
    requiresHumanConfirmation: true,
    roles: [],
    cooldownHours: 24,
    dedupeKey: `lab_gap:${source}`,
    status: 'new',
    lastSeenAt: '2026-07-29T10:00:00.000Z',
    occurrences: 1,
    lastModified: '2026-07-29T10:00:00.000Z',
  };
}

describe('AI finding feedback', () => {
  it('keeps independent reviewer verdicts and projects only the caller review', () => {
    const aliceReview = upsertFindingFeedback(finding(), {
      username: 'alice',
      verdict: 'helpful',
      comment: '  Useful context.  ',
      now: '2026-07-29T11:00:00.000Z',
    });
    const bothReviews = upsertFindingFeedback(aliceReview, {
      username: 'bob',
      verdict: 'incorrect',
      comment: 'The measurement was superseded.',
      now: '2026-07-29T11:05:00.000Z',
    });

    expect(findingFeedbackEntries(bothReviews)).toHaveLength(2);
    expect(feedbackForViewer(bothReviews, 'alice')).toEqual({
      verdict: 'helpful',
      comment: 'Useful context.',
      submittedAt: '2026-07-29T11:00:00.000Z',
    });
    expect(feedbackForViewer(bothReviews, 'alice')).not.toHaveProperty('submittedBy');
    expect(feedbackForViewer(bothReviews, 'charlie')).toBeUndefined();

    const aliceUpdated = upsertFindingFeedback(bothReviews, {
      username: 'alice',
      verdict: 'already_handled',
      now: '2026-07-29T11:10:00.000Z',
    });
    expect(findingFeedbackEntries(aliceUpdated)).toEqual([
      expect.objectContaining({ submittedBy: 'bob', verdict: 'incorrect' }),
      expect.objectContaining({ submittedBy: 'alice', verdict: 'already_handled' }),
    ]);
  });

  it('migrates a legacy single-review record without losing it', () => {
    const legacy: AiFindingRecord = {
      ...finding(),
      feedback: {
        verdict: 'not_helpful',
        submittedBy: 'legacy-user',
        submittedAt: '2026-07-28T08:00:00.000Z',
      },
    };
    const migrated = upsertFindingFeedback(legacy, {
      username: 'new-user',
      verdict: 'helpful',
      now: '2026-07-29T08:00:00.000Z',
    });

    expect(migrated.feedback).toBeUndefined();
    expect(migrated.feedbackEntries).toHaveLength(2);
    expect(feedbackForViewer(migrated, 'legacy-user')?.verdict).toBe('not_helpful');
  });

  it('returns source-level quality aggregates without identities or comments', () => {
    const rule = upsertFindingFeedback(finding('rule'), {
      username: 'alice',
      verdict: 'helpful',
      comment: 'private rule note',
      now: '2026-07-29T11:00:00.000Z',
    });
    const model = upsertFindingFeedback(finding('model'), {
      username: 'bob',
      verdict: 'incorrect',
      comment: 'private model note',
      now: '2026-07-29T11:05:00.000Z',
    });
    const summary = summarizeAiFindingFeedback([rule, model]);

    expect(summary).toEqual(expect.objectContaining({
      totalResponses: 2,
      findingsWithFeedback: 2,
      helpfulRate: 0.5,
      incorrectRate: 0.5,
    }));
    expect(summary.bySource.rule.counts.helpful).toBe(1);
    expect(summary.bySource.model.counts.incorrect).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('alice');
    expect(JSON.stringify(summary)).not.toContain('private');
  });

  it('flags detector calibration only after enough findings and quality verdicts', () => {
    const reviewed = [0, 1, 2].map((index) => ({
      ...finding('rule'),
      id: `private-finding-${index}`,
      entityId: `private-lot-${index}`,
      findingType: 'lab_gap',
      feedbackEntries: [
        {
          verdict: index === 0 ? 'incorrect' as const : 'not_helpful' as const,
          comment: `private calibration note ${index}`,
          submittedBy: `private-reviewer-${index}-a`,
          submittedAt: `2026-07-29T11:0${index}:00.000Z`,
        },
        {
          verdict: index === 1 ? 'incorrect' as const : 'helpful' as const,
          submittedBy: `private-reviewer-${index}-b`,
          submittedAt: `2026-07-29T11:1${index}:00.000Z`,
        },
      ],
    }));

    const summary = summarizeAiFindingFeedback(reviewed);

    expect(summary.calibration).toEqual(expect.objectContaining({
      minimumQualityResponses: 5,
      minimumFindings: 3,
      detectorsWithFeedback: 1,
      assessedDetectors: 1,
      needsReview: 1,
    }));
    expect(summary.calibration.candidates).toEqual([
      expect.objectContaining({
        findingType: 'lab_gap',
        source: 'rule',
        area: 'laboratory',
        findingsReviewed: 3,
        qualityResponses: 6,
        incorrectRate: 2 / 6,
        negativeRate: 4 / 6,
      }),
    ]);
    const serialized = JSON.stringify(summary.calibration);
    expect(serialized).not.toContain('private-finding');
    expect(serialized).not.toContain('private-lot');
    expect(serialized).not.toContain('private-reviewer');
    expect(serialized).not.toContain('private calibration note');
  });

  it('does not calibrate from one-off feedback or count already-handled as quality', () => {
    const sparse = [0, 1].map((index) => ({
      ...finding('model'),
      id: `sparse-${index}`,
      feedbackEntries: [
        {
          verdict: 'incorrect' as const,
          submittedBy: `reviewer-${index}-a`,
          submittedAt: `2026-07-29T11:0${index}:00.000Z`,
        },
        {
          verdict: 'already_handled' as const,
          submittedBy: `reviewer-${index}-b`,
          submittedAt: `2026-07-29T11:1${index}:00.000Z`,
        },
      ],
    }));

    const summary = summarizeAiFindingFeedback(sparse);

    expect(summary.calibration).toEqual(expect.objectContaining({
      detectorsWithFeedback: 1,
      assessedDetectors: 0,
      needsReview: 0,
      candidates: [],
    }));
    expect(summary.qualityResponses).toBe(2);
    expect(summary.alreadyHandledRate).toBe(0.5);
  });

  it('treats already-handled as timeliness feedback, not a quality verdict', () => {
    const handled = upsertFindingFeedback(finding('hybrid'), {
      username: 'alice',
      verdict: 'already_handled',
      now: '2026-07-29T11:00:00.000Z',
    });
    const helpful = upsertFindingFeedback(handled, {
      username: 'bob',
      verdict: 'helpful',
      now: '2026-07-29T11:05:00.000Z',
    });
    const summary = summarizeAiFindingFeedback([helpful]);

    expect(summary.totalResponses).toBe(2);
    expect(summary.qualityResponses).toBe(1);
    expect(summary.helpfulRate).toBe(1);
    expect(summary.alreadyHandledRate).toBe(0.5);
  });
});
