import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovedPcbPlacement,
  createPcbPlacementPreview,
  normalizeNativePcbSnapshot,
  runApprovedNativeAutorouting,
  type NativePcbExtractionPayload,
  type PcbAutomationAdapter,
} from '../../src/pcb/pcb-automation-pipeline.js';

function nativePayload(): NativePcbExtractionPayload {
  return {
    identity: {
      projectUuid: 'project-1',
      documentUuid: 'pcb-1',
      documentName: 'LED Driver 100W',
      editorVersion: '3.2.209',
    },
    units: 'mm',
    board: {
      outline: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
      ],
      gridMm: 0.25,
      componentClearanceMm: 0.2,
    },
    components: [
      {
        primitiveId: 'native-u1',
        ref: 'U1',
        mountTechnology: 'TH',
        x: 5,
        y: 5,
        rotationDeg: 0,
        side: 'TOP',
        fixed: true,
        courtyard: [
          { x: -1, y: -1 },
          { x: 1, y: -1 },
          { x: 1, y: 1 },
          { x: -1, y: 1 },
        ],
        pads: [{ id: '1', x: -0.5, y: 0, net: 'VIN' }, { id: '2', x: 0.5, y: 0, net: 'GND' }],
      },
    ],
    nets: [
      { name: 'VIN', pins: [{ ref: 'U1', padId: '1' }] },
      { name: 'GND', pins: [{ ref: 'U1', padId: '2' }] },
    ],
    extraction: {
      outlineExact: true,
      courtyardsExact: true,
      padsExact: true,
      netsExact: true,
      positionsExact: true,
      unsupportedFields: [],
      warnings: [],
    },
    fingerprint: 'native-board-fingerprint-001',
  };
}

describe('native PCB automation pipeline', () => {
  it('rejects bounding-box-only or incomplete native geometry', () => {
    const payload = nativePayload();
    payload.extraction.courtyardsExact = false;
    expect(() => normalizeNativePcbSnapshot(payload)).toThrow(/courtyards-not-exact/);
  });

  it('rejects self-intersecting native board outlines', () => {
    const payload = nativePayload();
    payload.board.outline = [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 20, y: 0 },
    ];
    expect(() => normalizeNativePcbSnapshot(payload)).toThrow(/board-outline-self-intersects/);
  });

  it('rejects pad-to-net membership that disagrees with the native netlist', () => {
    const payload = nativePayload();
    payload.components[0]!.pads![0]!.net = 'GND';
    expect(() => normalizeNativePcbSnapshot(payload)).toThrow(/pad-net-membership-mismatch/);
  });

  it('builds a read-only placement preview from exact native evidence', async () => {
    const adapter = {
      extractNativeSnapshot: vi.fn(async () => nativePayload()),
    } as unknown as PcbAutomationAdapter;
    const preview = await createPcbPlacementPreview(adapter, {
      placement: { iterations: 0 },
    });
    expect(preview.status).toBe('PREVIEW_READY');
    expect(preview.nativeWritePerformed).toBe(false);
    expect(preview.requiresHumanApproval).toBe(true);
    expect(preview.routing?.source).toBe('GEOMETRY_HEURISTIC');
  });

  it('does not apply without matching explicit approval', async () => {
    const adapter = {
      extractNativeSnapshot: vi.fn(async () => nativePayload()),
      applyPlacementChanges: vi.fn(),
      readBackAndCompare: vi.fn(),
      runPcbDrc: vi.fn(),
    } as unknown as PcbAutomationAdapter;
    const preview = await createPcbPlacementPreview(adapter, {
      placement: { iterations: 0 },
    });
    const result = await applyApprovedPcbPlacement(adapter, preview, {
      approved: true,
      proposalId: 'wrong-proposal',
      sourceFingerprint: preview.sourceFingerprint,
      projectUuid: 'project-1',
      documentUuid: 'pcb-1',
    });
    expect(result.status).toBe('WRITE_REJECTED');
    expect(result.nativeWritePerformed).toBe(false);
    expect(adapter.applyPlacementChanges).not.toHaveBeenCalled();
  });

  it('rejects stale native board state before writing', async () => {
    let reads = 0;
    const adapter = {
      extractNativeSnapshot: vi.fn(async () => {
        reads++;
        const payload = nativePayload();
        if (reads > 1) payload.fingerprint = 'different-board-fingerprint-002';
        return payload;
      }),
      applyPlacementChanges: vi.fn(),
    } as unknown as PcbAutomationAdapter;
    const preview = await createPcbPlacementPreview(adapter, {
      placement: { iterations: 0 },
    });
    const result = await applyApprovedPcbPlacement(adapter, preview, {
      approved: true,
      proposalId: preview.proposalId,
      sourceFingerprint: preview.sourceFingerprint,
      projectUuid: 'project-1',
      documentUuid: 'pcb-1',
    });
    expect(result.status).toBe('WRITE_REJECTED');
    expect(result.blockers).toContain('board-changed-after-preview-or-focus-changed');
    expect(adapter.applyPlacementChanges).not.toHaveBeenCalled();
  });

  it('requires native write receipt, readback match and clean DRC for verified status', async () => {
    const payload = nativePayload();
    const adapter: PcbAutomationAdapter = {
      extractNativeSnapshot: vi.fn(async () => payload),
      applyPlacementChanges: vi.fn(async ({ changes }) => ({
        success: true,
        appliedPrimitiveIds: changes.map((change) => change.primitiveId),
        failedPrimitiveIds: [],
        allWritesVerified: true,
        errors: [],
      })),
      readBackAndCompare: vi.fn(async () => ({
        snapshot: normalizeNativePcbSnapshot(payload),
        mismatches: [],
      })),
      runPcbDrc: vi.fn(async () => ({
        passed: true,
        errorCount: 0,
        warningCount: 0,
        violations: [],
      })),
    };
    const preview = await createPcbPlacementPreview(adapter, {
      placement: { iterations: 0 },
    });
    const result = await applyApprovedPcbPlacement(adapter, preview, {
      approved: true,
      proposalId: preview.proposalId,
      sourceFingerprint: preview.sourceFingerprint,
      projectUuid: 'project-1',
      documentUuid: 'pcb-1',
    });
    expect(result.status).toBe('APPLIED_AND_VERIFIED');
    expect(result.nativeWritePerformed).toBe(true);
    expect(result.savePerformed).toBe(false);
    expect(adapter.applyPlacementChanges).toHaveBeenCalledWith(expect.objectContaining({
      confirmWrite: true,
      routingNets: ['VIN', 'GND'],
      enabledLayers: [1, 2],
      expectedFingerprint: payload.fingerprint,
    }));
    expect(adapter.readBackAndCompare).toHaveBeenCalledTimes(1);
    expect(adapter.runPcbDrc).toHaveBeenCalledTimes(1);
  });

  it('reports DRC failure after a successful native write', async () => {
    const payload = nativePayload();
    const adapter: PcbAutomationAdapter = {
      extractNativeSnapshot: vi.fn(async () => payload),
      applyPlacementChanges: vi.fn(async ({ changes }) => ({
        success: true,
        appliedPrimitiveIds: changes.map((change) => change.primitiveId),
        failedPrimitiveIds: [],
        allWritesVerified: true,
        errors: [],
      })),
      readBackAndCompare: vi.fn(async () => ({
        snapshot: normalizeNativePcbSnapshot(payload),
        mismatches: [],
      })),
      runPcbDrc: vi.fn(async () => ({
        passed: false,
        errorCount: 1,
        warningCount: 0,
        violations: [{ rule: 'clearance', severity: 'error', description: 'Clearance violation' }],
      })),
    };
    const preview = await createPcbPlacementPreview(adapter, { placement: { iterations: 0 } });
    const result = await applyApprovedPcbPlacement(adapter, preview, {
      approved: true,
      proposalId: preview.proposalId,
      sourceFingerprint: preview.sourceFingerprint,
      projectUuid: 'project-1',
      documentUuid: 'pcb-1',
    });
    expect(result.status).toBe('DRC_FAILED');
    expect(result.nativeWritePerformed).toBe(true);
  });
});


describe('approved native autorouting', () => {
  it('does not call the native router when no explicit approval is supplied', async () => {
    const payload = nativePayload();
    const adapter: PcbAutomationAdapter = {
      extractNativeSnapshot: vi.fn(async () => payload),
      runNativeAutorouting: vi.fn(async () => ({
        status: 'COMPLETED',
        unroutedNetCount: 0,
        failedNetNames: [],
      })),
      applyPlacementChanges: vi.fn(),
      readBackAndCompare: vi.fn(),
      runPcbDrc: vi.fn(),
    };
    const result = await runApprovedNativeAutorouting(
      adapter,
      undefined as never,
      payload.fingerprint,
    );
    expect(result.status).toBe('STALE_BOARD');
    expect(result.nativeWritePerformed).toBe(false);
    expect(adapter.runNativeAutorouting).not.toHaveBeenCalled();
  });

  it('runs native autorouting only after approval and requires post-route DRC', async () => {
    const payload = nativePayload();
    const adapter: PcbAutomationAdapter = {
      extractNativeSnapshot: vi.fn(async () => payload),
      runNativeAutorouting: vi.fn(async () => ({
        status: 'COMPLETED',
        unroutedNetCount: 0,
        failedNetNames: [],
        routedLengthMm: 35.2,
        viaCount: 1,
      })),
      applyPlacementChanges: vi.fn(),
      readBackAndCompare: vi.fn(),
      runPcbDrc: vi.fn(async () => ({
        passed: true,
        errorCount: 0,
        warningCount: 0,
        violations: [],
      })),
    };
    const result = await runApprovedNativeAutorouting(
      adapter,
      {
        approved: true,
        operation: 'NATIVE_AUTOROUTE',
        routingNets: ['VIN', 'GND'],
        ignoreNets: [],
        enabledLayers: [1, 2],
        keepExistingTracksAndVias: true,
        optimization: 'COMPLETION',
        proposalId: 'pcbprop_12345678',
        sourceFingerprint: payload.fingerprint,
        projectUuid: 'project-1',
        documentUuid: 'pcb-1',
      },
      payload.fingerprint,
    );
    expect(result.status).toBe('ROUTED_AND_DRC_VERIFIED');
    expect(result.nativeWritePerformed).toBe(true);
    expect(adapter.runNativeAutorouting).toHaveBeenCalledWith(expect.objectContaining({
      confirmWrite: true,
      expectedFingerprint: payload.fingerprint,
    }));
    expect(adapter.runPcbDrc).toHaveBeenCalledTimes(1);
  });

  it('does not treat missing native unrouted-net accounting as a completed route', async () => {
    const payload = nativePayload();
    const adapter: PcbAutomationAdapter = {
      extractNativeSnapshot: vi.fn(async () => payload),
      runNativeAutorouting: vi.fn(async () => ({ status: 'COMPLETED' })),
      applyPlacementChanges: vi.fn(),
      readBackAndCompare: vi.fn(),
      runPcbDrc: vi.fn(),
    };
    const result = await runApprovedNativeAutorouting(
      adapter,
      {
        approved: true,
        operation: 'NATIVE_AUTOROUTE',
        routingNets: ['VIN'],
        ignoreNets: ['GND'],
        enabledLayers: [1, 2],
        keepExistingTracksAndVias: true,
        optimization: 'COMPLETION',
        proposalId: 'pcbprop_12345678',
        sourceFingerprint: payload.fingerprint,
        projectUuid: 'project-1',
        documentUuid: 'pcb-1',
      },
      payload.fingerprint,
    );
    expect(result.status).toBe('ROUTING_INCOMPLETE');
    expect(result.blockers).toContain('native-router-did-not-report-complete-net-accounting');
    expect(adapter.runPcbDrc).not.toHaveBeenCalled();
  });
});
