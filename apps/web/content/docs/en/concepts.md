This page explains IDEM's ideas in the order a request meets them. It is a guide, not the specification: where it says *must*, the binding wording is the rule it points to in the [protocol](/docs/protocol).

## Names {#names}

In an ordinary MCP call the request says *who* to ask: a server address. In IDEM it says *what* is being asked. That "what" is a name, and two requests that mean the same thing must end up with the same name on every node, without talking to each other.

```
/idem/v1/<producer>/<tool>/<schema-digest>/<args-digest>
```

::figure[name] The five components of a name. Only the last one changes from call to call.

- **`/idem/v1`** versions the wire format. An incompatible change to names, Interests, Data or the manifest needs `/idem/v2`.
- **producer** is who runs the tool and signs the answer: a host name in the HTTP overlay.
- **tool** is the MCP tool name, percent-encoded.
- **schema digest** is the first 22 characters of `b64u(SHA-256(JCS(tool-identity)))`, where the tool identity is the tool's name, its input schema, its output schema and a `policyVersion`. If the schema changes, the name changes, so an answer shaped by an old schema is never served for a new one. The tool's `description` is deliberately left out: prose can be reworded without changing meaning [P-2.2].
- **args digest** is `b64u(SHA-256(JCS(canonical-args)))`, 43 characters. The arguments themselves never appear in the name, only their digest [P-2.3].

The name is a function of exactly three things: the producer, the tool identity and the canonical arguments [P-2.1]. Nothing about the caller, the time or the path goes in. That is what lets a cache that has never seen you answer your question.

```ts
import { canonicalizeArgs, makeName } from "@idem/core";

const args = await canonicalizeArgs({ url: "https://EXAMPLE.com:443/p?b=2&a=1#x" }, tool, policy);
const name = await makeName({ producer: "demo.idem.dev", tool, args });
// "/idem/v1/demo.idem.dev/fetch_page/<22 chars>/<43 chars>"
```

### Canonicalization {#canonicalization}

Arguments are written by a language model, and models are not consistent about spelling. One agent writes `https://EXAMPLE.com:443/p?b=2&a=1#x`, another writes `https://example.com/p?a=1&b=2`. They are the same page. If the two calls got different names, no cache would ever hit.

So before hashing, the arguments go through one pipeline, run identically by the consumer, by every forwarder and by the producer:

1. **Validate** against the tool's `inputSchema`. Invalid arguments are not an IDEM call: the request goes on as plain MCP [P-3.1].
2. **Apply defaults** from the schema, so "omitted" and "written out with the default value" are the same call [P-3.2].
3. **Apply the normalizers** the producer declared for each field, and nothing else [P-3.3].
4. **Serialize** with JCS (RFC 8785), which fixes key order, number formatting and string escaping [P-3.4].

```
{"url":"https://EXAMPLE.com:443/p?b=2&a=1#x"}     agent A
{"url":"https://example.com/p?a=1&b=2"}           agent B
        │  validate → defaults → url:sortQuery → JCS
        ▼
{"url":"https://example.com/p?a=1&b=2"}           canonical args: the same bytes
```

The normalizers a producer can declare, per field (a JSON Pointer such as `/url`):

| Normalizer | Effect |
|---|---|
| `trim` | strips surrounding whitespace |
| `lowercase` | Unicode lowercase mapping, independent of locale |
| `nfc` | Unicode NFC normalization |
| `url` | WHATWG URL parse; lowercase scheme and host; drops the default port and the fragment |
| `url:sortQuery` | `url`, then sorts the query parameters by name |
| `set` | treats an array as a set: removes duplicates and sorts the items |

> [!IMPORTANT]
> A forwarder never guesses. It applies only the normalizers in the producer's signed manifest [P-3.3]. Treating a string as a URL because it looks like one would give two different requests the same name, and one of them would receive the other's answer. A lower hit rate is the price of never being wrong (ADR-006).

Everyone must also agree on what "valid" means, or they would disagree on names. IDEM v1 therefore fixes a subset of JSON Schema that every implementation supports exactly; a tool whose schema uses anything else (`$ref`, `if`/`then`, ...) is simply not cacheable [P-3.6].

## Interest and Data {#interest-and-data}

IDEM has two protocol objects. An **Interest** asks for a name. A **Data** answers it. The model is *pull*: nothing is sent unless someone asked, one Interest yields at most one Data per hop, and the Data returns along the reverse of the path the Interest took.

```ts
interface Interest {
  name: string;          // what is being asked
  args: unknown;         // the canonical arguments (the producer needs them to run the tool)
  mustBeFresh: boolean;  // default true
  lifetimeMs: number;    // default 10 000: how long the asker waits
  nonce: string;         // 64 random bits: tells a loop from a new request
  hopLimit: number;      // default 8, decremented at every forwarder
  authContext?: string;  // left unset by senders: the edge derives its own, see Scope
}
```

The name carries only a digest, so the Interest also carries the arguments. Every node that receives it recomputes the digest from those arguments and drops the Interest if it does not match the name [P-4.3]. A name cannot be forged to point at someone else's arguments.

```ts
interface Data {
  name: string;
  content: CallToolResult;   // the MCP result, without its ephemeral _meta
  meta: {
    contentDigest: string;   // b64u(SHA-256(JCS(content)))
    producedAt: number;      // producer clock, epoch ms
    freshnessMs: number;
    scope: "public" | "private";
    policyVersion: number;
  };
  signature: { alg: "Ed25519"; keyLocator: string; value: string };
  ageMs?: number;            // not signed
}
```

::figure[signed] What the producer's signature covers. Change the name, the content or any meta field and verification fails.

The signature binds the *name* to the *content*. That is the difference from a signed HTTP response or from TLS: TLS proves you talked to a server; a signed Data proves that this producer gave this answer to this question, no matter which node hands it to you, or when.

The producer never copies the name from the Interest. It recomputes it from the arguments it received and refuses to answer if the two differ [P-5.1].

## The forwarder: PIT, CS, FIB {#forwarder}

A **forwarder** is an intermediate node, a gateway. It never runs tools. It keeps three tables, the same three an NDN router keeps.

::figure[tables] A forwarder between its downstream faces (toward consumers) and its upstream face (toward the producer).

| Table | Maps | What it gives |
|---|---|---|
| **PIT**, Pending Interest Table | a name → the faces waiting for it | aggregation: a second Interest for a pending name joins the first instead of going upstream |
| **CS**, Content Store | a name → a signed Data | caching: a fresh Data answers the Interest right here |
| **FIB**, Forwarding Information Base | a producer prefix → the next hop | routing: where to send an Interest nobody here can answer |

A **face** is the forwarder's word for a link: an HTTP connection, a simulated wire, a browser channel. The engine only sees faces, which is why the same code runs in all three.

For each Interest, the forwarder asks its questions in a fixed order:

```
on Interest I from face F:
  tool not cacheable (manifest)            → not IDEM; event "bypass"
  digest(I.args) ≠ I.name.argsDigest       → DIGEST_MISMATCH; event "drop"
  hopLimit == 0, or a loop (name, nonce)   → drop
  CS has fresh Data for I.name (scope ok)  → reply from the CS; event "cs_hit"
  PIT has an entry for I.name              → add F to it; event "pit_aggregate"
  otherwise                                → new PIT entry; FIB → next hop; event "upstream_out"
```

And for the Data that comes back:

```
on Data D from upstream:
  verify signature and contentDigest       → on failure: drop, error to the waiters
  cacheable and the scope allows it        → store in the CS; event "cs_insert"
  deliver D to every face in the PIT entry → event "pit_satisfy"
  remove the PIT entry
```

::figure[exchange] A miss with aggregation, then a hit. The producer runs the tool once for four requests.

Two details matter in that sequence. The second and third Interests arrive while the first is still unanswered: the **PIT** is what saves them, since there is nothing in the cache yet. The fourth arrives later: the **CS** is what saves it. A plain cache gives you only the second effect.

Every line in those two listings is also an **event** the engine emits (`cs_hit`, `pit_aggregate`, `upstream_out`, `verify_ok`, ...). The sandbox draws that event stream and the experiments count it; no metric is computed anywhere else.

The tables are bounded. The PIT limits its entries and the faces per entry, and beyond the limit an Interest is forwarded without state, neither aggregated nor cached [P-7.3]. The CS has a byte budget and a replacement policy, `lru` by default [P-7.4].

## Signatures and the trust manifest {#trust}

A cache is only safe if a bad answer cannot get in. IDEM checks twice: a forwarder verifies a Data before it stores or delivers it [P-7.1], and the consumer verifies again before handing the content to the agent [P-5.5]. If the consumer's check fails, it retries without any cache.

Verification needs to know which keys speak for a producer and what that producer allows to be cached. Both are in the **manifest**, a document the producer signs and publishes at `/.well-known/idem.json`:

```ts
interface Manifest {
  producer: string;
  version: number;      // bumped on every change, including key rotation
  keys: { keyId: string; publicKeyJwk: JsonWebKey; notAfter?: number }[];
  tools: {
    tool: string;
    schemaDigest: string;
    cacheable: boolean;
    ttlMs: number;
    scope: "public" | "private";
    normalizers: Record<string, Normalizer[]>;   // JSON Pointer → normalizers
    policyVersion: number;
  }[];
  signature: { alg: "Ed25519"; keyId: string; value: string };
}
```

A call is cacheable only if **all** of these hold [P-6.1]:

1. the manifest marks the tool `cacheable: true`;
2. the tool declares `readOnlyHint: true` (defence in depth: the hint alone is never enough, because MCP annotations are untrusted);
3. the manifest's `schemaDigest` matches the one computed from the tool list the consumer actually sees;
4. the result is not an error and not a multi-round-trip interim result.

Trust in v1 is **trust on first use**, with optional key pinning [P-6.2]. The first manifest a node sees for a producer is accepted if it is signed by a key it lists. After that, a new manifest is accepted only if it is signed by a key the node already trusts for that producer: a pinned key, or one the currently accepted manifest lists. So a rotation is announced by a key that is already trusted, and a key dropped by a rotation can no longer sign manifests. A manifest with a lower `version` than the accepted one is rejected, which stops a rollback to an old policy [P-6.3]. A deployment that cannot accept first-use trust pins the producer's key by configuration.

A Data names its key with a `keyLocator` of the form `/idem/v1/<producer>/_key/<keyId>`, and the locator's producer must be the producer in the Data's name. A key that belongs to one producer cannot sign for another [P-5.2].

## Freshness {#freshness}

A cached answer must stop being served at some point. The producer decides when: each Data carries a `freshnessMs`, capped by the `ttlMs` the manifest declares for the tool [P-8.2].

::figure[freshness] A Data's age adds up across every cache it has passed through. It is fresh while that age is below the smaller of freshnessMs and the manifest's ttlMs.

A Data that sits in one cache and is then served to another does not get a fresh start. Each node adds the time the Data spent in its store to `ageMs` when it serves it, exactly like the HTTP `Age` header (RFC 9111). At node N the Data is fresh while [P-8.1]:

```
ageMs + (now − receivedAt) < min(freshnessMs, ttlMs)
```

`ageMs` is the one field of a Data that is not signed, because every hop has to update it. So this first part of freshness, the age counted hop by hop, holds between honest nodes only: it does not catch a node that understates the age.

The second part uses what is signed. Every node also compares the signed `producedAt` with its own clock. A Data is outside its **signed lifetime** when either line holds [P-8.6]:

```
now − producedAt ≥ min(freshnessMs, ttlMs) + clockToleranceMs    (expired)
producedAt − now > clockToleranceMs                              (dated in the future)
```

`clockToleranceMs` is a local option of each node, 60 seconds by default. It covers the difference between the node's clock and the producer's, plus the time in transit. A forwarder does not store a Data that is outside its signed lifetime, and answers `EXPIRED` to an Interest that asked for fresh Data. A consumer refuses such a Data as well, and asks again once with a plain call [P-8.7].

The two parts do different jobs. The age counted hop by hop needs no agreement between clocks, and it is what an honest cache uses to stop serving on time. The signed lifetime needs clocks that agree within the tolerance, and it bounds what a dishonest node on the path can pass off as fresh: never more than the freshness plus the tolerance. The [Security](/docs/security#limits) page says what remains inside that bound and what a wrong clock does.

Errors are never cached. A result with `isError: true` is signed with `freshnessMs = 0` [P-5.3], and timeouts and upstream failures are not stored either: there is no negative caching in v1 [P-7.2].

## Scope {#scope}

Some read-only results are the same for everyone (a public page). Others depend on who is asking (my notes). The name does not say who is asking, so the Data has to. Each tool's policy declares a **scope**, and the scope is part of what the producer signs.

::figure[scope] The edge keeps private answers in a partition per authorization context. Forwarders beyond the edge store public Data only.

- **`public`** Data may be stored in any Content Store and served to anyone.
- **`private`** Data may be stored only at the first forwarder, the edge, and only in a partition keyed by the consumer's **authorization context** [P-8.3].

The `authContext` is derived at the edge from the consumer's credential by a one-way function, an HMAC with a secret only the edge knows [P-8.4]. It is never the credential itself, it is never part of a name, and it is not passed beyond the first hop. A value that a sender writes into the `authContext` field of an Interest is ignored on every face: the edge always derives its own. The credential travels on to the producer hop by hop, as an HTTP `Authorization` header would.

The PIT follows the same partition. Two users' Interests for the same private name share a name but not a PIT entry, so one user's answer is never delivered to the other while both are waiting. A private Interest without an authorization context is never aggregated and never answered from a cache.

One last check closes a gap: if a Data arrives signed as `private` while the manifest says the tool is `public`, the forwarder treats it as invalid instead of handing it to everyone who was waiting [P-8.5].

> [!NOTE]
> "`private` never leaks" is one of the project's fixed rules. There is a test for it in the star and in the tree topology, and the sandbox has a button that tries to break it.

## When a call is not IDEM {#passthrough}

IDEM is opt-in per tool and conservative per call. In all of these cases the call goes through as an ordinary MCP `tools/call`, with no name, no aggregation and no cache, and the forwarder emits `bypass`:

| Case | Rule |
|---|---|
| The manifest does not mark the tool cacheable (for example `send_email`) | [P-4.2] |
| The arguments do not validate, or normalization made them invalid | [P-3.1] |
| The tool's schema uses a keyword outside the v1 subset | [P-3.6] |
| The result is a multi-round-trip interim result (`input_required`) | [P-5.4] |
| The PIT is full | [P-7.3] |

Nothing is lost when IDEM steps aside: the call behaves exactly as it would without a forwarder in the way. Next: how these pieces are packaged, in [Architecture](/docs/architecture).
