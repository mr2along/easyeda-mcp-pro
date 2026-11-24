import {
  optimizeComponentPlacement,
  type PlacementBoard,
  type PlacementComponent,
  type PlacementNet,
  type PlacementOptions,
  type PlacementResult,
} from './component-placement-optimizer.js';

export interface NativePcbIdentity {
  projectUuid: string;
  documentUuid: string;
  documentName: string;
  /** Native editor version reported by the focused EasyEDA Pro document. */
  editorVersion?: string;
  /** Stable snapshot token supplied by the native bridge when available. */
  revision?: string;
}

export interface NativePcbSnapshot {
  identity: NativePcbIdentity;
  units: 'mm';
  board: PlacementBoard;
  components: PlacementComponent[];
  nets: PlacementNet[];
  extraction: {
    outlineExact: boolean;
    courtyardsExact: boolean;
    padsExact: boolean;
    netsExact: boolean;
    positionsExact: boolean;
    unsupportedFields: string[];
    warnings: string[];
  };
  /** Canonical digest of all native geometry, nets and placement inputs. */
  fingerprint: string;
}

export interface NativePcbExtractionPayload {
  identity: NativePcbIdentity;
  units: string;
  board: PlacementBoard;
  components: PlacementComponent[];
  nets: PlacementNet[];
  extraction: NativePcbSnapshot['extraction'];
  fingerprint: string;
}

/**
 * Strict boundary between native EasyEDA values and the optimizer's normalized
 * model. The bridge must provide exact geometry; this function never fabricates
 * an outline/courtyard/pad from a bounding box or reference designator.
 */
export function normalizeNativePcbSnapshot(
  payload: NativePcbExtractionPayload,
): NativePcbSnapshot {
  const blockers: string[] = [];
  if (payload.units !== 'mm') blockers.push('native-units-not-millimetres');
  if (!payload.identity?.projectUuid || !payload.identity.documentUuid) {
    blockers.push('native-project-or-document-identity-missing');
  }
  if (!payload.fingerprint || payload.fingerprint.trim().length < 16) {
    blockers.push('native-snapshot-fingerprint-missing-or-invalid');
  }
  if (!Array.isArray(payload.board?.outline) || payload.board.outline.length < 3) {
    blockers.push('exact-board-outline-unavailable');
  }
  if (!payload.extraction?.outlineExact) blockers.push('board-outline-not-exact');
  if (!payload.extraction?.courtyardsExact) blockers.push('component-courtyards-not-exact');
  if (!payload.extraction?.padsExact) blockers.push('native-pad-geometry-not-exact');
  if (!payload.extraction?.netsExact) blockers.push('native-net-membership-not-exact');
  if (!payload.extraction?.positionsExact) blockers.push('native-component-positions-not-exact');

  for (const component of payload.components ?? []) {
    if (!component.ref || !component.mountTechnology || !component.primitiveId) {
      blockers.push('component-reference-or-mount-technology-missing');
      break;
    }
    if (!Array.isArray(component.courtyard) || component.courtyard.length < 3) {
      blockers.push(`exact-courtyard-missing:${component.ref}`);
    }
    if (!Array.isArray(component.pads)) {
      blockers.push(`native-pad-list-missing:${component.ref}`);
    }
    if (!Number.isFinite(component.x) || !Number.isFinite(component.y)) {
      blockers.push(`native-placement-missing:${component.ref}`);
    }
  }
  if (blockers.length > 0) {
    throw new NativePcbExtractionError(blockers, payload.extraction?.warnings ?? []);
  }

  return {
    identity: payload.identity,
    units: 'mm',
    board: payload.board,
    components: payload.components,
    nets: payload.nets,
    extraction: payload.extraction,
    fingerprint: payload.fingerprint,
  };
}

export class NativePcbExtractionError extends Error {
  constructor(
    readonly blockers: string[],
    readonly warnings: string[],
  ) {
    super(`Native PCB snapshot is incomplete: ${blockers.join(', ')}`);
    this.name = 'NativePcbExtractionError';
  }
}

export interface PadEscapeMetric {
  componentRef: string;
  padId: string;
  net?: string;
  distanceToCourtyardEdgeMm: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface NetCrossingMetric {
  netA: string;
  netB: string;
  intersections: number;
}

export interface RoutingAnalysis {
  source: 'GEOMETRY_HEURISTIC' | 'NATIVE_ROUTER';
  padEscape: PadEscapeMetric[];
  padEscapeHighRiskCount: number;
  estimatedCongestionIndex: number;
  netCrossings: NetCrossingMetric[];
  crossingCount: number;
  routerFeedback?: {
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'UNAVAILABLE';
    unroutedNetCount?: number;
    failedNetNames?: string[];
    routedLengthMm?: number;
    viaCount?: number;
    drcViolationCount?: number;
    message?: string;
  };
  warnings: string[];
}

export interface PcbPlacementPreview {
  status: PlacementResult['status'] | 'BLOCKED_INCOMPLETE_NATIVE_DATA';
  identity: NativePcbIdentity;
  sourceFingerprint: string;
  placement: PlacementResult | null;
  routing: RoutingAnalysis | null;
  geometryIssues: string[];
  warnings: string[];
  requiresHumanApproval: true;
  nativeWritePerformed: false;
  proposalId: string;
}

export interface PlacementChange {
  primitiveId: string;
  ref: string;
  x: number;
  y: number;
  rotationDeg: 0 | 90 | 180 | 270;
  side: 'TOP' | 'BOTTOM';
}

export interface NativeApplyReceipt {
  success: boolean;
  appliedPrimitiveIds: string[];
  failedPrimitiveIds: string[];
  /** True only if the adapter verified that every native write completed. */
  allWritesVerified: boolean;
  /** Native revision after the write, if exposed by the runtime. */
  revisionAfter?: string;
  errors: string[];
}

export interface NativeReadbackResult {
  snapshot: NativePcbSnapshot;
  mismatches: string[];
}

export interface NativeDrcResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  violations: Array<{ rule: string; severity: 'error' | 'warning'; description: string }>;
}

export interface PcbAutomationAdapter {
  extractNativeSnapshot(): Promise<NativePcbExtractionPayload>;
  /** Optional read-only router-analysis integration. Must not modify the focused PCB. */
  evaluateRoutingReadOnly?(input: {
    projectUuid: string;
    documentUuid: string;
    sourceFingerprint: string;
    proposalId: string;
  }): Promise<RoutingAnalysis['routerFeedback']>;
  /**
   * Actual EasyEDA PCB_Document.autoRouting is a mutating beta API. It is exposed
   * separately and may only be called through runApprovedNativeAutorouting().
   */
  runNativeAutorouting?(input: {
    projectUuid: string;
    documentUuid: string;
    expectedFingerprint: string;
    proposalId: string;
    confirmWrite: true;
  }): Promise<RoutingAnalysis['routerFeedback']>;
  /**
   * Adapter must check focused document identity and perform all writes under the
   * existing explicit-write/confirmWrite policy. It must not save implicitly.
   */
  applyPlacementChanges(input: {
    projectUuid: string;
    documentUuid: string;
    expectedFingerprint: string;
    proposalId: string;
    changes: PlacementChange[];
    confirmWrite: true;
  }): Promise<NativeApplyReceipt>;
  readBackAndCompare(input: {
    projectUuid: string;
    documentUuid: string;
    expected: PlacementChange[];
  }): Promise<NativeReadbackResult>;
  runPcbDrc(): Promise<NativeDrcResult>;
}

export interface PreviewOptions {
  placement?: PlacementOptions;
  runRouter?: boolean;
}

export interface ApplyApproval {
  approved: true;
  proposalId: string;
  sourceFingerprint: string;
  /** User approval must be scoped to this exact EasyEDA document. */
  projectUuid: string;
  documentUuid: string;
}

export interface PcbApplyResult {
  status:
    | 'APPLIED_AND_VERIFIED'
    | 'WRITE_REJECTED'
    | 'PARTIAL_WRITE'
    | 'READBACK_MISMATCH'
    | 'DRC_FAILED'
    | 'POST_WRITE_CHECK_FAILED';
  receipt?: NativeApplyReceipt;
  readback?: NativeReadbackResult;
  drc?: NativeDrcResult;
  blockers: string[];
  nativeWritePerformed: boolean;
  savePerformed: false;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pointSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

function pointToPolygonEdgeDistance(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    minimum = Math.min(
      minimum,
      pointSegmentDistance(point, polygon[i]!, polygon[(i + 1) % polygon.length]!),
    );
  }
  return minimum;
}

function rotateTranslate(
  point: { x: number; y: number },
  x: number,
  y: number,
  rotation: number,
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: x + point.x * Math.cos(radians) - point.y * Math.sin(radians),
    y: y + point.x * Math.sin(radians) + point.y * Math.cos(radians),
  };
}

function orientation(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properIntersection(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number },
): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return ((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) &&
    ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7));
}

function buildNetSegments(
  components: PlacementComponent[],
  placements: PlacementResult['placements'],
  nets: PlacementNet[],
): Map<string, Array<[{ x: number; y: number }, { x: number; y: number }]>> {
  const byRef = new Map(components.map((component) => [component.ref, component]));
  const placed = new Map(placements.map((item) => [item.ref, item]));
  const result = new Map<string, Array<[{ x: number; y: number }, { x: number; y: number }]>>();
  for (const net of nets) {
    const points = net.pins.flatMap((pin) => {
      const component = byRef.get(pin.ref);
      const placement = placed.get(pin.ref);
      const pad = component?.pads?.find((candidate) => candidate.id === pin.padId);
      if (!component || !placement || !pad) return [];
      return [rotateTranslate(pad, placement.x, placement.y, placement.rotationDeg)];
    });
    const segments: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
    if (points.length > 1) {
      // Star topology is a lower-bound geometric proxy, not a proposed route.
      for (let i = 1; i < points.length; i++) segments.push([points[0]!, points[i]!]);
    }
    result.set(net.name, segments);
  }
  return result;
}

export function analyzePlacementRouting(
  components: PlacementComponent[],
  nets: PlacementNet[],
  placement: PlacementResult,
  routerFeedback?: RoutingAnalysis['routerFeedback'],
): RoutingAnalysis {
  const placed = new Map(placement.placements.map((item) => [item.ref, item]));
  const padEscape: PadEscapeMetric[] = [];
  for (const component of components) {
    const position = placed.get(component.ref);
    if (!position) continue;
    const transformedCourtyard = component.courtyard.map((point) =>
      rotateTranslate(point, position.x, position.y, position.rotationDeg),
    );
    for (const pad of component.pads ?? []) {
      const absolutePad = rotateTranslate(pad, position.x, position.y, position.rotationDeg);
      const distanceMm = pointToPolygonEdgeDistance(absolutePad, transformedCourtyard);
      padEscape.push({
        componentRef: component.ref,
        padId: pad.id,
        ...(pad.net ? { net: pad.net } : {}),
        distanceToCourtyardEdgeMm: Number(distanceMm.toFixed(3)),
        risk: distanceMm > 2.5 ? 'HIGH' : distanceMm > 1.2 ? 'MEDIUM' : 'LOW',
      });
    }
  }

  const segments = buildNetSegments(components, placement.placements, nets);
  const netNames = [...segments.keys()];
  const netCrossings: NetCrossingMetric[] = [];
  for (let i = 0; i < netNames.length; i++) {
    for (let j = i + 1; j < netNames.length; j++) {
      const netA = netNames[i]!;
      const netB = netNames[j]!;
      let intersections = 0;
      for (const [a, b] of segments.get(netA) ?? []) {
        for (const [c, d] of segments.get(netB) ?? []) {
          if (properIntersection(a, b, c, d)) intersections++;
        }
      }
      if (intersections > 0) netCrossings.push({ netA, netB, intersections });
    }
  }

  const boardArea = Math.max(1, Math.abs(
    placement.metrics.boardUtilization > 0
      ? 1 / placement.metrics.boardUtilization
      : 1,
  ));
  const padDensity = padEscape.length / boardArea;
  const crossingCount = netCrossings.reduce((sum, item) => sum + item.intersections, 0);
  const estimatedCongestionIndex = Math.min(
    1,
    padDensity / 20 + crossingCount / Math.max(10, nets.length * 4),
  );
  const warnings = [
    'Pad escape and net crossing are geometric proxies; they do not prove copper clearance or routability.',
    'Congestion index is comparative only and is not a router success probability.',
  ];
  if (!routerFeedback || routerFeedback.status === 'UNAVAILABLE') {
    warnings.push('Native router feedback is unavailable; preview uses geometry heuristics only.');
  }
  return {
    source: routerFeedback && routerFeedback.status !== 'UNAVAILABLE'
      ? 'NATIVE_ROUTER'
      : 'GEOMETRY_HEURISTIC',
    padEscape,
    padEscapeHighRiskCount: padEscape.filter((item) => item.risk === 'HIGH').length,
    estimatedCongestionIndex: Number(estimatedCongestionIndex.toFixed(4)),
    netCrossings,
    crossingCount,
    ...(routerFeedback ? { routerFeedback } : {}),
    warnings,
  };
}

function proposalId(snapshot: NativePcbSnapshot, placements: PlacementResult): string {
  const serialized = JSON.stringify({
    fingerprint: snapshot.fingerprint,
    placements: placements.placements,
    seed: placements.seed,
    iterations: placements.iterations,
  });
  // Stable, deterministic non-cryptographic ID. Native fingerprint remains the
  // authoritative document-state check; adapters should bind approvals to it.
  let hash = 2166136261;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `pcbprop_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function createPcbPlacementPreview(
  adapter: Pick<PcbAutomationAdapter, 'extractNativeSnapshot' | 'evaluateRoutingReadOnly'>,
  options: PreviewOptions = {},
): Promise<PcbPlacementPreview> {
  const payload = await adapter.extractNativeSnapshot();
  let snapshot: NativePcbSnapshot;
  try {
    snapshot = normalizeNativePcbSnapshot(payload);
  } catch (error) {
    const blockers = error instanceof NativePcbExtractionError
      ? error.blockers
      : ['native-pcb-extraction-failed'];
    return {
      status: 'BLOCKED_INCOMPLETE_NATIVE_DATA',
      identity: payload.identity,
      sourceFingerprint: payload.fingerprint,
      placement: null,
      routing: null,
      geometryIssues: blockers,
      warnings: payload.extraction?.warnings ?? [],
      requiresHumanApproval: true,
      nativeWritePerformed: false,
      proposalId: 'blocked',
    };
  }

  const placement = optimizeComponentPlacement(
    snapshot.components,
    snapshot.nets,
    snapshot.board,
    options.placement,
  );
  let routerFeedback: RoutingAnalysis['routerFeedback'];
  if (options.runRouter && adapter.evaluateRoutingReadOnly && placement.status === 'PREVIEW_READY') {
    try {
      routerFeedback = await adapter.evaluateRoutingReadOnly({
        projectUuid: snapshot.identity.projectUuid,
        documentUuid: snapshot.identity.documentUuid,
        sourceFingerprint: snapshot.fingerprint,
        proposalId: proposalId(snapshot, placement),
      });
    } catch (error) {
      routerFeedback = {
        status: 'FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  } else if (options.runRouter) {
    routerFeedback = { status: 'UNAVAILABLE', message: 'Read-only router-analysis adapter is not connected. EasyEDA native autorouting is a separate approved write action.' };
  }

  const routing = placement.status === 'PREVIEW_READY'
    ? analyzePlacementRouting(snapshot.components, snapshot.nets, placement, routerFeedback)
    : null;
  const geometryIssues = [...placement.blockers];
  return {
    status: placement.status,
    identity: snapshot.identity,
    sourceFingerprint: snapshot.fingerprint,
    placement,
    routing,
    geometryIssues,
    warnings: [...snapshot.extraction.warnings, ...placement.warnings, ...(routing?.warnings ?? [])],
    requiresHumanApproval: true,
    nativeWritePerformed: false,
    proposalId: proposalId(snapshot, placement),
  };
}

function changesFromPreview(
  snapshot: NativePcbSnapshot,
  preview: PcbPlacementPreview,
): PlacementChange[] {
  const byRef = new Map(snapshot.components.map((component) => [component.ref, component]));
  return (preview.placement?.placements ?? []).flatMap((placement) => {
    const component = byRef.get(placement.ref);
    if (!component) return [];
    const primitiveId = component.primitiveId;
    if (!primitiveId) return [];
    return [{
      primitiveId,
      ref: placement.ref,
      x: placement.x,
      y: placement.y,
      rotationDeg: placement.rotationDeg,
      side: placement.side,
    }];
  });
}

export async function applyApprovedPcbPlacement(
  adapter: PcbAutomationAdapter,
  preview: PcbPlacementPreview,
  approval: ApplyApproval,
): Promise<PcbApplyResult> {
  const blockers: string[] = [];
  if (!approval || approval.approved !== true) blockers.push('explicit-user-approval-required');
  if (preview.status !== 'PREVIEW_READY' || !preview.placement) blockers.push('preview-is-not-ready');
  if (approval?.proposalId !== preview.proposalId) blockers.push('approval-proposal-id-mismatch');
  if (approval?.sourceFingerprint !== preview.sourceFingerprint) blockers.push('approval-fingerprint-mismatch');
  if (approval?.projectUuid !== preview.identity.projectUuid ||
      approval?.documentUuid !== preview.identity.documentUuid) {
    blockers.push('approval-document-identity-mismatch');
  }
  if (blockers.length) {
    return { status: 'WRITE_REJECTED', blockers, nativeWritePerformed: false, savePerformed: false };
  }

  let freshPayload: NativePcbExtractionPayload;
  let fresh: NativePcbSnapshot;
  try {
    freshPayload = await adapter.extractNativeSnapshot();
    fresh = normalizeNativePcbSnapshot(freshPayload);
  } catch {
    return {
      status: 'WRITE_REJECTED',
      blockers: ['fresh-native-snapshot-incomplete'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }
  if (fresh.fingerprint !== preview.sourceFingerprint ||
      fresh.identity.projectUuid !== approval.projectUuid ||
      fresh.identity.documentUuid !== approval.documentUuid) {
    return {
      status: 'WRITE_REJECTED',
      blockers: ['board-changed-after-preview-or-focus-changed'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }

  const changes = changesFromPreview(fresh, preview);
  if (changes.length !== fresh.components.length) {
    return {
      status: 'WRITE_REJECTED',
      blockers: ['one-or-more-components-have-no-native-primitive-id'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }
  let receipt: NativeApplyReceipt;
  try {
    receipt = await adapter.applyPlacementChanges({
      projectUuid: approval.projectUuid,
      documentUuid: approval.documentUuid,
      expectedFingerprint: preview.sourceFingerprint,
      proposalId: preview.proposalId,
      changes,
      confirmWrite: true,
    });
  } catch (error) {
    // A transport/API exception can happen after the editor accepted some writes.
    // Treat native state as uncertain and require a fresh manual inspection.
    return {
      status: 'PARTIAL_WRITE',
      blockers: [
        'native-write-outcome-uncertain',
        error instanceof Error ? error.message : String(error),
      ],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
  if (!receipt.success || !receipt.allWritesVerified || receipt.failedPrimitiveIds.length > 0) {
    return {
      status: receipt.appliedPrimitiveIds.length > 0 ? 'PARTIAL_WRITE' : 'WRITE_REJECTED',
      receipt,
      blockers: ['native-write-not-fully-verified', ...receipt.errors],
      nativeWritePerformed: receipt.appliedPrimitiveIds.length > 0,
      savePerformed: false,
    };
  }

  let readback: NativeReadbackResult;
  try {
    readback = await adapter.readBackAndCompare({
      projectUuid: approval.projectUuid,
      documentUuid: approval.documentUuid,
      expected: changes,
    });
  } catch (error) {
    return {
      status: 'POST_WRITE_CHECK_FAILED',
      receipt,
      blockers: [`native-readback-failed:${error instanceof Error ? error.message : String(error)}`],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
  if (readback.mismatches.length > 0) {
    return {
      status: 'READBACK_MISMATCH',
      receipt,
      readback,
      blockers: readback.mismatches,
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }

  let drc: NativeDrcResult;
  try {
    drc = await adapter.runPcbDrc();
  } catch (error) {
    return {
      status: 'POST_WRITE_CHECK_FAILED',
      receipt,
      readback,
      blockers: [`native-drc-failed:${error instanceof Error ? error.message : String(error)}`],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
  if (!drc.passed || drc.errorCount > 0) {
    return {
      status: 'DRC_FAILED',
      receipt,
      readback,
      drc,
      blockers: ['post-write-pcb-drc-has-errors'],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
  return {
    status: 'APPLIED_AND_VERIFIED',
    receipt,
    readback,
    drc,
    blockers: [],
    nativeWritePerformed: true,
    savePerformed: false,
  };
}


export interface NativeAutorouteResult {
  status: 'ROUTED_AND_DRC_VERIFIED' | 'ROUTER_NOT_AVAILABLE' | 'STALE_BOARD' |
    'ROUTER_FAILED' | 'ROUTING_INCOMPLETE' | 'DRC_FAILED' | 'POST_ROUTE_CHECK_FAILED';
  routerFeedback?: RoutingAnalysis['routerFeedback'];
  drc?: NativeDrcResult;
  blockers: string[];
  nativeWritePerformed: boolean;
  savePerformed: false;
}

/**
 * Runs EasyEDA's native autorouter only after a separate explicit approval.
 * This is intentionally not called by createPcbPlacementPreview: the native
 * autorouter changes the PCB and is not a read-only preview operation.
 */
export async function runApprovedNativeAutorouting(
  adapter: PcbAutomationAdapter,
  approval: ApplyApproval,
  expectedFingerprint: string,
): Promise<NativeAutorouteResult> {
  if (!approval || approval.approved !== true ||
      !approval.proposalId || !approval.projectUuid || !approval.documentUuid ||
      !expectedFingerprint || approval.sourceFingerprint !== expectedFingerprint) {
    return {
      status: 'STALE_BOARD',
      blockers: ['explicit-router-approval-and-matching-fingerprint-required'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }
  if (!adapter.runNativeAutorouting) {
    return {
      status: 'ROUTER_NOT_AVAILABLE',
      blockers: ['native-autorouter-adapter-not-connected'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }

  try {
    const before = normalizeNativePcbSnapshot(await adapter.extractNativeSnapshot());
    if (before.fingerprint !== expectedFingerprint ||
        before.identity.projectUuid !== approval.projectUuid ||
        before.identity.documentUuid !== approval.documentUuid) {
      return {
        status: 'STALE_BOARD',
        blockers: ['board-changed-before-native-autorouting'],
        nativeWritePerformed: false,
        savePerformed: false,
      };
    }
  } catch {
    return {
      status: 'STALE_BOARD',
      blockers: ['fresh-native-snapshot-unavailable-before-autorouting'],
      nativeWritePerformed: false,
      savePerformed: false,
    };
  }

  let feedback: RoutingAnalysis['routerFeedback'];
  try {
    feedback = await adapter.runNativeAutorouting({
      projectUuid: approval.projectUuid,
      documentUuid: approval.documentUuid,
      expectedFingerprint,
      proposalId: approval.proposalId,
      confirmWrite: true,
    });
  } catch (error) {
    return {
      status: 'ROUTER_FAILED',
      blockers: [
        'native-autorouter-outcome-may-have-modified-board',
        error instanceof Error ? error.message : String(error),
      ],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }

  if (!feedback || feedback.status !== 'COMPLETED') {
    return {
      status: 'ROUTER_FAILED',
      routerFeedback: feedback,
      blockers: ['native-autorouter-did-not-report-completed'],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
  if ((feedback.unroutedNetCount ?? 0) > 0 || (feedback.failedNetNames?.length ?? 0) > 0) {
    return {
      status: 'ROUTING_INCOMPLETE',
      routerFeedback: feedback,
      blockers: ['native-autorouter-left-unrouted-or-failed-nets'],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }

  try {
    const after = normalizeNativePcbSnapshot(await adapter.extractNativeSnapshot());
    if (after.identity.projectUuid !== approval.projectUuid ||
        after.identity.documentUuid !== approval.documentUuid) {
      return {
        status: 'POST_ROUTE_CHECK_FAILED',
        routerFeedback: feedback,
        blockers: ['focused-document-changed-after-autorouting'],
        nativeWritePerformed: true,
        savePerformed: false,
      };
    }
    const drc = await adapter.runPcbDrc();
    if (!drc.passed || drc.errorCount > 0) {
      return {
        status: 'DRC_FAILED',
        routerFeedback: feedback,
        drc,
        blockers: ['post-autoroute-pcb-drc-has-errors'],
        nativeWritePerformed: true,
        savePerformed: false,
      };
    }
    return {
      status: 'ROUTED_AND_DRC_VERIFIED',
      routerFeedback: feedback,
      drc,
      blockers: [],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  } catch (error) {
    return {
      status: 'POST_ROUTE_CHECK_FAILED',
      routerFeedback: feedback,
      blockers: [`post-autoroute-readback-or-drc-failed:${error instanceof Error ? error.message : String(error)}`],
      nativeWritePerformed: true,
      savePerformed: false,
    };
  }
}
