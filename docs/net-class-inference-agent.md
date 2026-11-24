# Net Class Inference Agent

The agent analyzes unclassified nets from native schematic and PCB evidence: net labels, connected component references/names, pin names, topology, measured/declared voltage and current, and isolation-domain metadata.

## Behavior

- Proposes a class from evidence; it does not classify from a net name alone when evidence is weak or contradictory.
- Emits confidence HIGH/MEDIUM/LOW/CONFLICT and an evidence trail.
- Can automatically pass a HIGH/MEDIUM proposal to the trace-rule calculator only when RMS current and isolation domain are present.
- Never automatically routes. Every proposal requires human approval and native design verification.
- Unknown/conflicting nets are re-analyzed after additional schematic/PCB evidence is loaded.

## Critical constraints

A name such as GND is not enough to determine whether a net is PE, primary return, secondary return, analog ground, or control ground. Likewise, labels such as FB/CS/SENSE must be resolved from connected pins and topology. Primary/secondary isolation must be derived from explicit barrier/component/domain evidence, not guessed from voltage alone.

The initial pattern-based resolver is a deterministic baseline. The production agent should add graph traversal over the native schematic, component pin electrical types, transformer/opto/capacitive isolation boundaries, controller pin functions, and native net voltage/current annotations. LLM output may rank explanations but must not bypass deterministic safety gates.
