import { describe, expect, it } from 'vitest';
import {
  calculateExternalTraceWidthMm,
  calculateNetClassTraceRules,
  calculateTraceRule,
} from '../../src/pcb/auto-trace-rule-calculator.js';

describe('auto trace rule calculator', () => {
  it('returns a positive external trace width for valid electrical inputs', () => {
    const width = calculateExternalTraceWidthMm(1, 10, 35);
    expect(width).toBeGreaterThan(0);
    expect(Number.isFinite(width)).toBe(true);
  });

  it('applies the configured 1.5x margin and rounds upward to 0.05 mm', () => {
    const result = calculateTraceRule({
      netClass: 'LED_OUTPUT',
      rmsCurrentA: 1.8,
      classificationApproved: true,
      electricalInputsApproved: true,
      workingVoltageV: 55,
      isolationDomain: 'SELV_SECONDARY',
      clearanceMm: 0.5,
      clearanceSource: 'ENGINEER_APPROVED_DESIGN_RULE_REV_A',
    });

    expect(result.baseWidthMm).toBeDefined();
    expect(result.proposedWidthMm).toBeGreaterThanOrEqual((result.baseWidthMm ?? 0) * 1.5);
    expect(((result.proposedWidthMm ?? 0) / 0.05) % 1).toBeCloseTo(0, 8);
    expect(result.status).toBe('READY_FOR_REVIEW');
    expect(result.routeEligible).toBe(false);
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('blocks unknown classes and missing clearance evidence', () => {
    const result = calculateTraceRule({
      netClass: 'UNKNOWN',
      rmsCurrentA: 0.5,
    });

    expect(result.status).toBe('BLOCKED');
    expect(result.routeEligible).toBe(false);
    expect(result.blockers.join(' ')).toContain('UNKNOWN');
    expect(result.blockers.join(' ')).toContain('clearance');
  });

  it('generates a separate result for every declared net class', () => {
    const results = calculateNetClassTraceRules({});
    expect(Object.keys(results)).toHaveLength(10);
    expect(results.AC_INPUT.netClass).toBe('AC_INPUT');
    expect(results.UNKNOWN.status).toBe('BLOCKED');
  });
});
