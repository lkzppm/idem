---
"@idem/sim": minor
---

Arbitrary graphs, several producers and per-agent workloads (ADR-027). `SimConfig.producers` puts a
producer with its own name, tools and key on any producer node; calls are routed on latency-shortest
paths per producer (only forwarders relay; multi-homed agents pick the link per call); a call to an
unreachable producer fails with `CallRecord.error = "NO_ROUTE"`. New tools `search_corpus` and
`weather` (`TOOL_CATALOG`), a `per-agent` workload with weighted tool mixes, per-forwarder
`csMaxBytes`, `SimConfigError`, and the helpers `routesTo`, `pathToProducer`, `reachableProducers`.
Configurations without `producers` run exactly as before.
