/**
 * Preliminary trace-rule calculator for two-layer PCB designs.
 *
 * Width model: IPC-2221 external-conductor empirical equation.
 * This is a screening estimate, not an IPC-2152 thermal validation or
 * a safety/manufacturing certification. Clearance is never inferred from
 * current or voltage; it must come from an engineer-approved rule source.
 */

export const PCB_TRACE_RULE_DEFAULTS = Object.freeze({
  copperOz: 1,
  copperThicknessUm: 35,
  widthMargin: 1.5,
  temperatureRiseC: 10,
  widthGridMm: 0.05,
});

export const PCB_NET_CLASSES = [
  'AC_INPUT',
  'PFC_POWER',
  'DC_BUS',
  'LLC_PRIMARY',
  'GATE_DRIVE',
  'LLC_SECONDARY',
  'LED_OUTPUT',
  'FEEDBACK',
  'CONTROL',
  'UNKNOWN',
] as const;

export type PcbNetClass = (typeof PCB_NET_CLASSES)[number];
export type PcbLayer = 'TOP' | 'BOTTOM' | 'BOTH';

export interface TraceRuleInput {
  netClass: PcbNetClass;
  /** Continuous/RMS current in amperes, measured or derived from validated design data. */
  rmsCurrentA?: number;
  /** Peak current is retained for review; it is not substituted into the thermal equation. */
  peakCurrentA?: number;
  /** Allowed copper temperature rise. Defaults to the calculator's provisional 10 C. */
  temperatureRiseC?: number;
  /** Actual finished copper thickness for the selected layer. */
  copperThicknessUm?: number;
  /** Engineer-approved clearance from the applicable standard/design rule. */
  clearanceMm?: number;
  clearanceSource?: string;
  /** Working voltage is metadata for review, not enough by itself to derive clearance. */
  workingVoltageV?: number;
  /** Identifies whether a net belongs to a hazardous/live or isolated domain. */
  isolationDomain?: string;
  /** Explicit confirmation that the net class assignment was reviewed. */
  classificationApproved?: boolean;
  /** Explicit confirmation that current and thermal assumptions were reviewed. */
  electricalInputsApproved?: boolean;
  /** Layers on which this class may be routed. */
  allowedLayers?: PcbLayer[];
}

export interface TraceRuleResult {
  netClass: PcbNetClass;
  status: 'READY_FOR_REVIEW' | 'BLOCKED';
  routeEligible: false;
  baseWidthMm?: number;
  proposedWidthMm?: number;
  widthMargin: number;
  copperThicknessUm: number;
  temperatureRiseC: number;
  clearanceMm?: number;
  clearanceSource?: string;
  workingVoltageV?: number;
  peakCurrentA?: number;
  allowedLayers: PcbLayer[];
  blockers: string[];
  warnings: string[];
  model: 'IPC-2221-external-preliminary';
  requiresHumanApproval: true;
}

function roundUp(value: number, step: number): number {
  return Math.ceil((value - Number.EPSILON) / step) * step;
}

/**
 * IPC-2221 external conductor estimate:
 * A[mil^2] = (I / (0.048 * dT^0.44))^(1/0.725)
 * W[mil] = A / thickness[mil]
 * 1 mil = 0.0254 mm; 1 oz copper is nominally ~34.8 um.
 */
export function calculateExternalTraceWidthMm(
  currentA: number,
  temperatureRiseC: number,
  copperThicknessUm: number,
): number {
  if (!Number.isFinite(currentA) || currentA <= 0) {
    throw new RangeError('currentA must be a finite value greater than zero');
  }
  if (!Number.isFinite(temperatureRiseC) || temperatureRiseC <= 0) {
    throw new RangeError('temperatureRiseC must be a finite value greater than zero');
  }
  if (!Number.isFinite(copperThicknessUm) || copperThicknessUm <= 0) {
    throw new RangeError('copperThicknessUm must be a finite value greater than zero');
  }

  const areaMilSquared = Math.pow(
    currentA / (0.048 * Math.pow(temperatureRiseC, 0.44)),
    1 / 0.725,
  );
  const thicknessMil = copperThicknessUm / 25.4;
  const widthMil = areaMilSquared / thicknessMil;
  return widthMil * 0.0254;
}

export function calculateTraceRule(input: TraceRuleInput): TraceRuleResult {
  const widthMargin = PCB_TRACE_RULE_DEFAULTS.widthMargin;
  const copperThicknessUm = input.copperThicknessUm ?? PCB_TRACE_RULE_DEFAULTS.copperThicknessUm;
  const temperatureRiseC = input.temperatureRiseC ?? PCB_TRACE_RULE_DEFAULTS.temperatureRiseC;
  const allowedLayers = input.allowedLayers ?? ['TOP', 'BOTTOM'];
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.netClass === 'UNKNOWN') blockers.push('Net class is UNKNOWN; classify the net before routing.');
  if (!input.classificationApproved) blockers.push('Net-class assignment has not been approved.');
  if (!input.electricalInputsApproved) blockers.push('Electrical and thermal inputs have not been approved.');
  if (input.rmsCurrentA === undefined || !Number.isFinite(input.rmsCurrentA) || input.rmsCurrentA <= 0) {
    blockers.push('A valid RMS current is required; peak current cannot replace it.');
  }
  if (input.workingVoltageV === undefined || !Number.isFinite(input.workingVoltageV) || input.workingVoltageV < 0) {
    blockers.push('Working voltage is missing; record it for insulation-rule review.');
  }
  if (!input.isolationDomain?.trim()) {
    blockers.push('Isolation domain is missing; primary/secondary separation cannot be checked.');
  }
  if (input.clearanceMm === undefined || !Number.isFinite(input.clearanceMm) || input.clearanceMm <= 0) {
    blockers.push('Engineer-approved clearance is missing; the calculator will not infer it.');
  }
  if (!input.clearanceSource?.trim()) {
    blockers.push('Clearance rule source/revision is missing.');
  }
  if (allowedLayers.length === 0) blockers.push('At least one allowed copper layer is required.');

  let baseWidthMm: number | undefined;
  let proposedWidthMm: number | undefined;
  if (input.rmsCurrentA !== undefined && input.rmsCurrentA > 0 &&
      Number.isFinite(input.rmsCurrentA) && copperThicknessUm > 0 && temperatureRiseC > 0) {
    baseWidthMm = calculateExternalTraceWidthMm(
      input.rmsCurrentA,
      temperatureRiseC,
      copperThicknessUm,
    );
    proposedWidthMm = roundUp(
      baseWidthMm * widthMargin,
      PCB_TRACE_RULE_DEFAULTS.widthGridMm,
    );
  }

  if (input.peakCurrentA !== undefined && input.peakCurrentA > 0) {
    warnings.push('Peak current is recorded for separate pulse/EMI review; thermal width uses RMS current.');
  }
  warnings.push('IPC-2221 result is preliminary. Validate final copper geometry and thermal rise using IPC-2152 or measured evidence.');
  warnings.push('Via current capacity, parallel-path sharing, voltage drop, and local hot spots require separate checks.');

  return {
    netClass: input.netClass,
    status: blockers.length === 0 ? 'READY_FOR_REVIEW' : 'BLOCKED',
    routeEligible: false,
    ...(baseWidthMm === undefined ? {} : { baseWidthMm }),
    ...(proposedWidthMm === undefined ? {} : { proposedWidthMm }),
    widthMargin,
    copperThicknessUm,
    temperatureRiseC,
    ...(input.clearanceMm === undefined ? {} : { clearanceMm: input.clearanceMm }),
    ...(input.clearanceSource === undefined ? {} : { clearanceSource: input.clearanceSource }),
    ...(input.workingVoltageV === undefined ? {} : { workingVoltageV: input.workingVoltageV }),
    ...(input.peakCurrentA === undefined ? {} : { peakCurrentA: input.peakCurrentA }),
    allowedLayers,
    blockers,
    warnings,
    model: 'IPC-2221-external-preliminary',
    requiresHumanApproval: true,
  };
}

/**
 * Calculates one proposal per net class. No class is routable at this stage:
 * a separate approval + native-rule readback gate is required before routing.
 */
export function calculateNetClassTraceRules(
  inputs: Partial<Record<PcbNetClass, Omit<TraceRuleInput, 'netClass'>>>,
): Record<PcbNetClass, TraceRuleResult> {
  return Object.fromEntries(
    PCB_NET_CLASSES.map((netClass) => [
      netClass,
      calculateTraceRule({ netClass, ...(inputs[netClass] ?? {}) }),
    ]),
  ) as Record<PcbNetClass, TraceRuleResult>;
}
