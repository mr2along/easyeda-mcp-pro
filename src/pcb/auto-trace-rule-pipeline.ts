import {
  calculateTraceRule,
  type TraceRuleResult,
} from './auto-trace-rule-calculator.js';
import { inferNetClass, type NetEvidence, type NetClassInference } from './net-class-inference.js';

export interface AutoTraceRulePipelineResult {
  inference: NetClassInference;
  rule?: TraceRuleResult;
  status: 'INFERRED_RULE_READY_FOR_REVIEW' | 'NEEDS_MORE_EVIDENCE' | 'CLASSIFICATION_CONFLICT';
  autoRouteAllowed: false;
}

/**
 * Runs inference followed by rule calculation when sufficient evidence exists.
 * It never authorizes routing; the result is a proposal for human review.
 */
export function inferAndCalculateTraceRule(
  evidence: NetEvidence,
  clearance?: { valueMm: number; source: string },
): AutoTraceRulePipelineResult {
  const inference = inferNetClass(evidence);

  if (inference.confidence === 'CONFLICT') {
    return { inference, status: 'CLASSIFICATION_CONFLICT', autoRouteAllowed: false };
  }

  if (!inference.autoCalculateRule || inference.inferredClass === 'UNKNOWN') {
    return { inference, status: 'NEEDS_MORE_EVIDENCE', autoRouteAllowed: false };
  }

  const rule = calculateTraceRule({
    netClass: inference.inferredClass,
    rmsCurrentA: inference.proposedRmsCurrentA,
    peakCurrentA: inference.proposedPeakCurrentA,
    workingVoltageV: evidence.voltageMaxV ?? evidence.voltageRmsV,
    isolationDomain: inference.proposedIsolationDomain,
    classificationApproved: true,
    electricalInputsApproved: false,
    ...(clearance ? { clearanceMm: clearance.valueMm, clearanceSource: clearance.source } : {}),
  });

  return {
    inference,
    rule,
    status: 'INFERRED_RULE_READY_FOR_REVIEW',
    autoRouteAllowed: false,
  };
}
