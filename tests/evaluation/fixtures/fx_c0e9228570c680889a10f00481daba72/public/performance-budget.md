# Journey Brief performance budget

The Journey Brief user task requests route, weather, platform, and service
alert data for one trip.

At the declared concurrency of one user:

- Collect at least 20 warm samples.
- Each key endpoint must have p95 latency at or below 200 ms.
- The complete Journey Brief task must have p95 latency at or below 250 ms.
- The sample set must have no request errors.

The task threshold is a project baseline. Endpoint results do not replace the
complete task measurement.
