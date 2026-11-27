---
"@idem/sim": minor
---

The industry baseline B5 and code-driven bursts W-code (ADR-036, ADR-037).

- New `SimMode` `"mcp-gateway-cache"` (evaluation mode B5): plain MCP with one shared, unsigned
  response cache at each edge, keyed by producer, tool and the arguments as sent (`stableJson`,
  `gatewayCacheKey`), a TTL per tool, no coalescing of identical calls in flight, error results not
  stored. New exports `GatewayCache`, `GatewayRelay`, `GatewayCacheEntry`, `GatewayRelayOptions`;
  `Simulation.gatewayCaches`; `Metrics.gatewayCacheHits` and `Metrics.gatewayInflightDuplicates`.
  Sweeps gain the columns `upstream_reduction_vs_b5`, `gateway_cache_hits` and
  `gateway_inflight_duplicates`. Runs of the other modes are unchanged, draw for draw.
- E5 gains three baseline rows (`expected: "baseline"`, with the `mirrors` id of the IDEM variant
  they stand next to): the same attacks against B5. `SafetyData.baseline` holds them apart from
  `rows`; new type `SafetyRowData`.
- `SyntheticWorkload.burst` (`{ size, parallel? }`) and `startSpreadMs`: calls issued by code in
  steps, and agents started within a window. Absent, a run is exactly what it was. Sweep parameters
  `burstSize` and `startSpreadMs`.
