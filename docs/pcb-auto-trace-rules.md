# Auto Trace Rule Calculator

## Scope

The first implementation is a pure TypeScript calculator. It does not write rules into EasyEDA Pro and does not claim to be a completed autorouter.

## Locked defaults

- Copper: 1 oz nominal, 35 µm configured thickness
- Width margin: 1.5×
- Temperature-rise assumption: 10 °C (provisional; override per net class)
- Width quantization: round upward to 0.05 mm
- Width model: IPC-2221 external-conductor empirical estimate

## Per-net-class inputs

The API accepts RMS current, peak current (review metadata), temperature rise, copper thickness, working voltage, isolation domain, allowed layers, and engineer approval flags. Clearance and its source/revision must be explicitly supplied; they are never calculated from current or inferred from voltage alone.

Supported initial classes:

- AC_INPUT
- PFC_POWER
- DC_BUS
- LLC_PRIMARY
- GATE_DRIVE
- LLC_SECONDARY
- LED_OUTPUT
- FEEDBACK
- CONTROL
- UNKNOWN

## Safety and routing contract

Every calculated result has `routeEligible: false` and `requiresHumanApproval: true`. A `READY_FOR_REVIEW` result means only that required inputs were supplied; it is not authorization to route.

The future routing integration must separately:
1. validate net-to-class mapping and isolation domains;
2. import approved width/clearance/layer rules into a routing proposal;
3. generate preview geometry without mutating the native PCB;
4. require explicit approval for the exact proposal and board revision;
5. apply only through a verified EasyEDA bridge capability;
6. read back native tracks/vias and run native DRC/connectivity checks;
7. abort or roll back on revision mismatch, unsupported API, or verification failure.

Unknown classes, missing RMS current, missing clearance source, or missing isolation domain must fail closed.

## Engineering limitations

IPC-2221 is used only as a preliminary width estimate. Validate the final design with IPC-2152 or measured thermal evidence, including copper distribution, board thickness, ambient temperature, enclosure, neighboring heat sources, and actual current waveform. Via capacity, voltage drop, current sharing, switching-loop geometry, and thermal hot spots are separate analyses.

Creepage/clearance depends on the applicable safety standard and factors such as working voltage, transient/overvoltage category, pollution degree, material group/CTI, altitude, and insulation class. This calculator intentionally does not invent those values.
