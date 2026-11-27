---
"@idem/core": minor
"@idem/gateway": patch
"@idem/mcp": patch
"@idem/ndn": patch
"@idem/sim": minor
---

Fixes from the independent review of ADR-034 to ADR-038.

- `acceptData(data, { trust, now, name?, mustBeFresh, ttlMs?, toleranceMs? })`: the consumer's
  decision (name, `verifyData`, signed lifetime, age) as one function, with distinct verdict codes
  `BAD_SIGNATURE`, `UNTRUSTED_KEY`, `BAD_MANIFEST` and `EXPIRED`. `IdemClient`,
  `IdemConsumer.verifyToolResult`, `NdnConsumer`, the simulator's agents and the E5 harness use it.
  New export `staleByAge` [P-8.1].
- `Forwarder`: a downstream that asked for fresh Data no longer receives Data stale by its `ageMs`
  because another Interest of the same PIT entry asked with `mustBeFresh: false`; it gets `EXPIRED`
  (event `drop`, reason `stale`). The `pit_full` passthrough applies the signed-lifetime and age
  checks too [P-7.3, P-8.6].
- `ProxyProducer`: the credential of an origin call follows the operator's declared policy, so a tool
  declared public is never called with the end user's credential, also while held after a schema
  change or refused after `refresh()` [P-9.7].
- `@idem/sim`: parallel burst steps prepare their calls in plan order and send them at one instant,
  and the Interest-timeout retry is awaited by the clock, so runs no longer depend on WebCrypto
  completion order. B5 caches `private` cacheable tools in a partition per caller credential
  (`GatewayRelayOptions.perCredential`, `gatewayCacheKey(…, partition)`). E5: the judge works on ground
  truth, `baseline/tamper@upstream` judges only users answered from the gateway cache.
