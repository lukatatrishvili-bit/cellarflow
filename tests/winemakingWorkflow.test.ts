import { describe, expect, it } from 'vitest';
import {
  nextStageForWineClass,
  stagesForCurrentLot,
  stagesForWineClass,
  winemakingWorkflowLabel,
  workflowKindForWineClass,
} from '../lib/winemakingWorkflow';

describe('wine-specific stage workflows', () => {
  it('orders red wine stages around fermentation, maceration, and pressing', () => {
    expect(stagesForWineClass('red')).toEqual([
      'crushing',
      'fermenting',
      'maceration',
      'pressing',
      'aging',
      'stabilization',
      'filtration',
      'bottled',
      'sold',
    ]);
  });

  it('presses white wine before fermentation and omits maceration', () => {
    expect(stagesForWineClass('white')).toEqual([
      'crushing',
      'pressing',
      'fermenting',
      'aging',
      'stabilization',
      'filtration',
      'bottled',
      'sold',
    ]);
  });

  it('starts amber skin contact before fermentation', () => {
    expect(stagesForWineClass('amber')).toEqual([
      'crushing',
      'maceration',
      'fermenting',
      'pressing',
      'aging',
      'stabilization',
      'filtration',
      'bottled',
      'sold',
    ]);
  });

  it('uses the dedicated qvevri sequence without forcing filtration', () => {
    expect(stagesForWineClass('qvevri')).toEqual([
      'crushing',
      'fermenting',
      'maceration',
      'pressing',
      'aging',
      'stabilization',
      'bottled',
      'sold',
    ]);
    expect(winemakingWorkflowLabel('qvevri', 'ka')).toBe('ქვევრის ღვინის ეტაპები');
  });

  it('uses the white sequence for rosé and sparkling base lots', () => {
    expect(workflowKindForWineClass('rose')).toBe('white');
    expect(workflowKindForWineClass('sparkling')).toBe('white');
    expect(workflowKindForWineClass('base_wine')).toBe('white');
  });

  it('selects the next stage from the lot-specific sequence', () => {
    expect(nextStageForWineClass('red', 'crushing')).toBe('fermenting');
    expect(nextStageForWineClass('white', 'crushing')).toBe('pressing');
    expect(nextStageForWineClass('amber', 'crushing')).toBe('maceration');
    expect(nextStageForWineClass('qvevri', 'stabilization')).toBe('bottled');
    expect(nextStageForWineClass('qvevri', 'sold')).toBe('sold');
  });

  it('keeps a legacy current stage visible even when the preferred workflow omits it', () => {
    expect(stagesForCurrentLot('qvevri', 'filtration')).toEqual([
      'crushing',
      'fermenting',
      'maceration',
      'pressing',
      'aging',
      'stabilization',
      'filtration',
      'bottled',
      'sold',
    ]);
  });
});
