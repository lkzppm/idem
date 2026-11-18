# IDEM

**Interest-Driven Exchange for Models**: LLM tool calls as named, signed data.

IDEM is a content-centric transport layer for the [Model Context Protocol](https://modelcontextprotocol.io).
A read-only tool call becomes a _name_ derived from the tool and its canonicalized arguments. The result
becomes a _Data object signed by the producer_, so any node on the path can cache and serve it and any
consumer can verify it. Identical concurrent calls from many agents are collapsed into one upstream request.

> Status: research prototype (UFRJ, EEL878 — Computer Networks I, 2026/2). Spec in [`spec/`](spec/README.md) (English; the final report is in Portuguese).
