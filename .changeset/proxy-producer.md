---
"@idem/mcp": minor
---

Proxy-producer mode (protocol §9.1, [P-9.5]–[P-9.8], ADR-038): `createProxyProducer({ upstream,
name, key, tools })` returns a `ProxyProducer`, a core `Producer` with its own name and key whose
tools call an MCP server that knows nothing about IDEM. Nothing is cacheable unless the operator
declares it; a tool without `readOnlyHint` needs `operatorAssertsReadOnly`, and `readOnlyHint: false`
is never cached. Public tools never see the end user's credential; private tools get it and are
signed `private`. After every signed origin call the proxy re-reads the origin's `tools/list`; a
schema change holds the tool not cacheable under a new manifest version until `refresh()`. Each
listed tool carries `_meta["dev.idem/origin"]` (`ORIGIN_META_KEY`). `createMcpProducer` and
`createMcpEdge` now pass a tool's `_meta` through to `tools/list`, and `createMcpProducer` reads the
producer's tool list per server instance. `@modelcontextprotocol/client` is now a runtime dependency.
