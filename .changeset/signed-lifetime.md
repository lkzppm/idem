---
"@idem/core": minor
"@idem/gateway": minor
"@idem/mcp": minor
"@idem/ndn": minor
"@idem/sim": minor
---

Close open questions Q7 and Q6 of IDEM v1 (ADR-033, ADR-034).

- `Forwarder` never honours an `authContext` carried by a received Interest: on a consumer face it
  derives its own from the credential and `authSecret`, otherwise there is none [P-8.4]. A consumer
  that knew another user's value could read that user's `private` partition.
- Signed lifetime [P-8.6]: a Data is outside it when `now − producedAt ≥ min(freshnessMs, ttlMs) +
  clockToleranceMs` or when it is dated more than `clockToleranceMs` in the future. New exports
  `DEFAULT_CLOCK_TOLERANCE_MS` (60 000), `lifetimeState`, `isOutsideLifetime`, `lifetimeOf`,
  `apparentAge`, `lifetimeReason`, `clockTolerance`; new wire code `EXPIRED` (HTTP 502) and local
  code `CLOCK_SKEW`. Forwarders (option `clockToleranceMs`) do not store such Data, answer waiters that
  asked for fresh Data with `EXPIRED`, and never serve such a CS entry as fresh.
- Consumers [P-8.7]: `IdemClient` (options `clock`, `clockToleranceMs`) and `createMcpEdge`
  (`clockToleranceMs`) retry an expired answer as a plain call and fail with `CLOCK_SKEW` when the
  verified retry is still outside its lifetime; `CallOutcome.error` is now `CallError`.
  `IdemConsumer.verifyToolResult` reports `EXPIRED`. `NdnConsumer` (options `clock`,
  `clockToleranceMs`) fails closed with `EXPIRED`. The simulator's agents follow the same rule.
- E5: `replay/expired@*` are claims now; new variants `replay/in-tolerance@*` (limit),
  `replay/understated-age@core` and `replay/future-dated@upstream` (claims).
