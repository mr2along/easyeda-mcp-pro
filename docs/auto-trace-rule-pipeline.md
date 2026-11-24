# Auto Trace Rule Pipeline

`inferAndCalculateTraceRule` joins net-class inference and the trace-width calculator. A confident classification plus RMS current and isolation domain creates a per-net-class rule proposal. The rule remains blocked until electrical inputs and applicable clearances are approved. This is intentional: inference does not silently grant engineering approval.
