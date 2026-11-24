import { describe, expect, it } from 'vitest';
import { inferNetClass } from '../../src/pcb/net-class-inference.js';

describe('net class inference', () => {
  it('infers LED output from label and connected topology evidence', () => {
    const result = inferNetClass({
      netName: 'LED_OUT+',
      connectedComponentRefs: ['D12', 'J3'],
      connectedComponentNames: ['LED connector'],
      connectedPinNames: ['ANODE', 'LED+'],
      currentRmsA: 1.8,
      voltageMaxV: 55,
      isolationDomain: 'SELV_SECONDARY',
    });
    expect(result.inferredClass).toBe('LED_OUTPUT');
    expect(result.confidence).toBe('HIGH');
    expect(result.autoCalculateRule).toBe(true);
    expect(result.autoRouteAllowed).toBe(false);
  });

  it('does not guess when class evidence conflicts', () => {
    const result = inferNetClass({
      netName: 'LLC_FB_LED_OUT',
      connectedComponentNames: ['PFC controller', 'optocoupler', 'LED driver'],
    });
    expect(result.inferredClass).toBe('UNKNOWN');
    expect(result.confidence).toBe('CONFLICT');
    expect(result.autoCalculateRule).toBe(false);
  });

  it('can infer a likely class but will not calculate a rule without RMS current and domain', () => {
    const result = inferNetClass({
      netName: 'DC_BUS_P',
      connectedComponentRefs: ['Cbulk1', 'Qpfc1'],
      connectedPinNames: ['HV', 'DRAIN'],
      voltageMaxV: 420,
    });
    expect(result.inferredClass).toBe('DC_BUS');
    expect(result.autoCalculateRule).toBe(false);
    expect(result.missingEvidence).toContain('RMS current not available from native design evidence');
  });

  it('keeps weak evidence as UNKNOWN', () => {
    const result = inferNetClass({ netName: 'N$123' });
    expect(result.inferredClass).toBe('UNKNOWN');
    expect(result.confidence).toBe('LOW');
    expect(result.autoRouteAllowed).toBe(false);
  });
});
