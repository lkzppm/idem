---
"@idem/gateway": patch
"@idem/mcp": patch
---

The consumer's retry after a bad signature [P-5.5] is verified like the first answer. `IdemClient.call`
now fails with `BAD_SIGNATURE` (and an error result) when the retried result carries no signed Data, is
signed for another name, or does not verify; it used to return such a result. `createMcpEdge` returns
that error to the MCP client instead of the unverified content.
