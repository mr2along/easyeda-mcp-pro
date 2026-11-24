import { describe, expect, it } from 'vitest';
import { inferAndCalculateTraceRule } from '../../src/pcb/auto-trace-rule-pipeline.js';

describe('auto trace rule pipeline', () => {
  it('infers a net class and calculates a review proposal without enabling routing', () => {
    const result = inferAndCalculateTraceRule({
      netName: 'LED_OUT+',
      connectedComponentRefs: ['D12', 'J3'],
      connectedComponentNames: ['LED connector'],
      connectedPinNames: ['ANODE', 'LED+'],
      currentRmsA: 1.8,
      voltageMaxV: 55,
      isolationDomain: 'SELV_SECONDARY',
    }, { valueMm: 0.5, source: 'ENGINEER_APPROVED_RULE_REV_A' });

    expect(result.rule).toBeDefined();
    expect(result.rule?.netClass).toBe('LED_OUTPUT');
    expect(result.rule?.status).toBe('BLOCKED');
    expect(result.autoRouteAllowed).toBe(false);
  });

  it('returns needs-more-evidence for a net without current/domain data', () => {
    const result = inferAndCalculateTraceRule({ netName: 'DC_BUS_P' });
    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.rule).toBeUndefined();
  });
});
