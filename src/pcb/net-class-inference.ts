/**
 * Evidence-based net-class inference for EasyEDA schematic/PCB data.
 *
 * This module proposes classifications; it does not certify electrical safety.
 * Unknown nets are analyzed rather than being treated as permanently unclassifiable.
 * Ambiguous isolation boundaries and conflicting evidence remain blocked.
 */

import type { PcbNetClass } from './auto-trace-rule-calculator.js';

export type InferenceConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'CONFLICT';

export interface NetEvidence {
  netName: string;
  connectedComponentRefs?: string[];
  connectedComponentNames?: string[];
  connectedPinNames?: string[];
  connectedPinNumbers?: string[];
  connectedNetLabels?: string[];
  voltageMinV?: number;
  voltageMaxV?: number;
  voltageRmsV?: number;
  currentRmsA?: number;
  currentPeakA?: number;
  isGround?: boolean;
  isChassis?: boolean;
  hasIsolationBarrierEvidence?: boolean;
  isolationDomain?: string;
  sourceDocument?: 'SCHEMATIC' | 'PCB' | 'BOTH';
}

export interface NetClassInference {
  netName: string;
  inferredClass: PcbNetClass;
  confidence: InferenceConfidence;
  score: number;
  evidence: string[];
  missingEvidence: string[];
  conflicts: string[];
  proposedRmsCurrentA?: number;
  proposedPeakCurrentA?: number;
  proposedIsolationDomain?: string;
  autoCalculateRule: boolean;
  autoRouteAllowed: false;
  requiresHumanApproval: true;
}

interface Candidate {
  netClass: PcbNetClass;
  points: number;
  reason: string;
}

const patterns: Array<{ netClass: PcbNetClass; pattern: RegExp; points: number; reason: string }> = [
  { netClass: 'AC_INPUT', pattern: /(^|[_\W])(L|LINE|LIVE|AC_L|AC_N|NEUTRAL|MAINS|ACIN)([_\W]|$)/i, points: 5, reason: 'AC input net label' },
  { netClass: 'PFC_POWER', pattern: /PFC|BOOST|SW_PFC|PFC_GATE|PFC_DRAIN/i, points: 5, reason: 'PFC/boost topology label' },
  { netClass: 'DC_BUS', pattern: /DC.?BUS|HV.?BUS|BULK|VBUS|HVDC|BUS_P|BUS_N/i, points: 5, reason: 'DC bus label' },
  { netClass: 'LLC_PRIMARY', pattern: /LLC|RESONANT|HALF.?BRIDGE|PRI(MARY)?|SW_HB|DRV_HS|DRV_LS/i, points: 4, reason: 'LLC/primary topology label' },
  { netClass: 'GATE_DRIVE', pattern: /GATE|DRV|HO|LO|GH|GL|PWM|DRIVE/i, points: 3, reason: 'Gate-drive/control pin label' },
  { netClass: 'LLC_SECONDARY', pattern: /SEC(ONDARY)?|SR_GATE|SYNC.?RECT|RECTIFIER/i, points: 4, reason: 'Secondary rectification label' },
  { netClass: 'LED_OUTPUT', pattern: /LED|LED_OUT|LED\+|LED-|VOUT|I_OUT/i, points: 4, reason: 'LED/output label' },
  { netClass: 'FEEDBACK', pattern: /FB|COMP|ISENSE|VSENSE|CS|OPTO|TL431|BIAS_SENSE/i, points: 4, reason: 'Feedback/sense label' },
  { netClass: 'CONTROL', pattern: /MCU|GPIO|I2C|SDA|SCL|UART|RESET|EN(ABLE)?|DIM|CTRL|NTC/i, points: 3, reason: 'Low-voltage control label' },
];

function collectText(e: NetEvidence): string {
  return [
    e.netName,
    ...(e.connectedComponentRefs ?? []),
    ...(e.connectedComponentNames ?? []),
    ...(e.connectedPinNames ?? []),
    ...(e.connectedNetLabels ?? []),
  ].join(' ');
}

export function inferNetClass(e: NetEvidence): NetClassInference {
  const text = collectText(e);
  const candidates: Candidate[] = [];

  for (const item of patterns) {
    if (item.pattern.test(text)) {
      candidates.push({ netClass: item.netClass, points: item.points, reason: item.reason });
    }
  }

  if (e.isGround || /(^|[_\W])(GND|PGND|AGND|DGND|COM|RTN)([_\W]|$)/i.test(text)) {
    candidates.push({ netClass: 'CONTROL', points: 1, reason: 'Ground/return indication; functional domain still needs context' });
  }
  if (e.isChassis || /CHASSIS|PE_|PROTECTIVE.?EARTH/i.test(text)) {
    candidates.push({ netClass: 'AC_INPUT', points: 2, reason: 'Protective-earth/chassis indication; requires dedicated PE rule review' });
  }

  const totals = new Map<PcbNetClass, number>();
  const reasons = new Map<PcbNetClass, string[]>();
  for (const c of candidates) {
    totals.set(c.netClass, (totals.get(c.netClass) ?? 0) + c.points);
    reasons.set(c.netClass, [...(reasons.get(c.netClass) ?? []), c.reason]);
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const second = ranked[1];
  const conflicts = second && top && top[1] - second[1] <= 1
    ? [`Conflicting class evidence: ${top[0]}=${top[1]}, ${second[0]}=${second[1]}`]
    : [];

  const inferredClass = conflicts.length > 0 || !top ? 'UNKNOWN' : top[0];
  const score = top ? Math.min(1, top[1] / 6) : 0;
  const confidence: InferenceConfidence =
    conflicts.length > 0 ? 'CONFLICT' :
    score >= 0.8 ? 'HIGH' :
    score >= 0.5 ? 'MEDIUM' : 'LOW';

  const evidence = inferredClass === 'UNKNOWN' ? [] : (reasons.get(inferredClass) ?? []);
  const missingEvidence: string[] = [];
  if (e.currentRmsA === undefined) missingEvidence.push('RMS current not available from native design evidence');
  if (e.voltageMaxV === undefined && e.voltageRmsV === undefined) missingEvidence.push('Working voltage not available');
  if (!e.isolationDomain && !e.hasIsolationBarrierEvidence) missingEvidence.push('Isolation domain/barrier not established');
  if (!e.connectedComponentRefs?.length) missingEvidence.push('Connected component references are missing');
  if (!e.connectedPinNames?.length) missingEvidence.push('Connected pin names are missing');

  // Classification can be proposed from labels/topology, but rule calculation
  // requires actual RMS current and an identified electrical domain.
  const autoCalculateRule =
    inferredClass !== 'UNKNOWN' &&
    (confidence === 'HIGH' || confidence === 'MEDIUM') &&
    e.currentRmsA !== undefined &&
    Number.isFinite(e.currentRmsA) &&
    e.currentRmsA > 0 &&
    Boolean(e.isolationDomain);

  return {
    netName: e.netName,
    inferredClass,
    confidence,
    score,
    evidence,
    missingEvidence,
    conflicts,
    ...(e.currentRmsA === undefined ? {} : { proposedRmsCurrentA: e.currentRmsA }),
    ...(e.currentPeakA === undefined ? {} : { proposedPeakCurrentA: e.currentPeakA }),
    ...(e.isolationDomain === undefined ? {} : { proposedIsolationDomain: e.isolationDomain }),
    autoCalculateRule,
    autoRouteAllowed: false,
    requiresHumanApproval: true,
  };
}
