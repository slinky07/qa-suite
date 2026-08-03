# Dispatch Relay reliability contract

REL-01 applies after a healthy Dispatch Relay has passed its startup check.

- The major operation is production of one dispatch summary.
- A dependency outage makes the operation unavailable and raises the recovery alert.
- The service performs at most two retry attempts while the dependency is unavailable.
- The unavailable dependency is restored at logical time 50 ms.
- The dispatch summary must become available and the alert must resolve no later than 100 logical ms after restoration.
- Evidence must include the ordered fault, retry, restoration, recovery, and alert transitions.

Logical time establishes event order and the recovery objective only. It is
not a general latency or performance measurement.
