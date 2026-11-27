# 01 — IDEM v1 protocol (normative)

MUST/SHOULD/MAY per RFC 2119/8174. Each rule has an id `[P-x.y]` that tests cite.

## 1. Terminology

| Term | Definition |
|---|---|
| **Consumer** | Whoever requests data: an agent, or the MCP client it uses |
| **Producer** | IDEM-aware MCP server: runs the tool, names and **signs** the result |
| **Forwarder** | Intermediate node (gateway). Keeps a **PIT**, **CS** and **FIB**. Never runs tools |
| **Interest** | Request for a name, carrying the canonicalized arguments |
| **Data** | Named response signed by the producer |
| **Manifest** | Producer's signed document: public keys and per-tool cache policy |
| **PIT** | Pending Interest Table: names requested but not yet answered, with the list of waiters |
| **CS** | Content Store: Data cache keyed by name |
| **FIB** | Forwarding Information Base: producer prefix → next hop |
| **authContext** | Opaque identifier of the consumer's authorization context (e.g. hash of its token) |

Communication model: **pull, receiver-driven**. One Interest yields at most one Data per hop
(*flow balance*), and Data returns along the reverse path of the Interest.

## 2. Names

### 2.1 Grammar

```
name          = "/idem/v1/" producer "/" tool "/" schema-digest "/" args-digest
producer      = component        ; overlay: producer host (e.g. "demo.idem.dev")
                                  ; native: routable NDN prefix, encoded as components
tool          = component        ; MCP tool name, percent-encoded (RFC 3986, unreserved)
schema-digest = b64u(SHA-256(JCS(tool-identity)))[0:22]
args-digest   = b64u(SHA-256(JCS(canonical-args)))         ; 43 characters
tool-identity = { "name", "inputSchema", "outputSchema"?, "policyVersion" }
b64u          = base64url without padding (RFC 4648 §5)
JCS           = JSON Canonicalization Scheme (RFC 8785)
```

Example: `/idem/v1/demo.idem.dev/fetch_page/3q2-7wEAAQ0abcDEF12xy/Xk9...(43 chars)`

### 2.2 Rules

- **[P-2.1]** The name MUST be a function **only** of (producer, tool-identity, canonical-args). Two
  requests with the same three values MUST produce the same name at every node.
- **[P-2.2]** `schema-digest` changes when the schema or `policyVersion` changes. The tool
  `description` MUST NOT be part of `tool-identity` (text can change without changing semantics; if
  semantics change, the producer bumps `policyVersion`).
- **[P-2.3]** The name MUST NOT contain arguments in clear text, only their digest.
- **[P-2.4]** Names starting with `/idem/v1/<producer>/_` are reserved (manifest, keys).

## 3. Argument canonicalization

Pipeline applied **identically** by consumer, forwarder and producer:

1. **Validate** arguments against `inputSchema`. On failure the request is **not IDEM**: it proceeds as
   a plain MCP call (passthrough) **[P-3.1]**.
2. **Apply defaults** declared in the schema **[P-3.2]**.
3. **Apply normalizers** declared by the producer in the manifest, per field (JSON Pointer):

| Normalizer | Effect |
|---|---|
| `trim` | strip surrounding whitespace |
| `lowercase` | Unicode default lowercase mapping, locale-independent (ECMAScript `toLowerCase`, Python `str.lower`); see ADR-011 |
| `nfc` | Unicode NFC normalization |
| `url` | WHATWG parse; lowercase scheme and host; drop default port and fragment |
| `url:sortQuery` | `url` + stable sort of query parameters by name, re-serialized as `application/x-www-form-urlencoded` (an empty query drops the `?`) |
| `set` | array treated as a set: dedupe and sort by the JCS serialization of each item (UTF-16 code-unit order) |

   - **[P-3.3]** Forwarders and consumers MUST apply **only** the normalizers in the manifest. Inferring
     normalization (e.g. treating a string as a URL without a declaration) is forbidden: merging
     different requests under one name would deliver the wrong answer.
   - Pointers are RFC 6901 JSON Pointers, applied **deepest first** (more reference tokens first; ties by
     code-unit order of the pointer), so element normalizers run before a `set` on their parent.
     Pointers that do not resolve (absent optional fields) are skipped. A string normalizer on a
     non-string, or `set` on a non-array, is a manifest error (`BAD_POLICY`); an unparseable URL makes
     the call non-IDEM (`INVALID_ARGS` → passthrough).
   - The result is **validated again**; if normalization made it invalid, the call is not IDEM
     (passthrough). This guarantees canonical args are always valid, hence [P-3.5].
4. **Serialize** with JCS (RFC 8785) **[P-3.4]**. Object properties whose value is absent/`undefined`
   are omitted; NaN, ±Infinity and lone surrogates are not JSON and make the call non-IDEM.

- **[P-3.5]** The implementation MUST include property tests: for valid args `a`,
  `canon(canon(a)) == canon(a)` (idempotence), and permuting object keys does not change the name.
- **[P-3.6]** Implementations MUST support exactly the JSON Schema subset of Appendix A. A producer MUST
  NOT mark a tool cacheable if its `inputSchema` uses any other keyword; a consumer or forwarder that
  meets such a schema MUST treat the tool as not cacheable. (Everyone agrees on validity, so everyone
  agrees on names.)

## 4. Interest

```ts
interface Interest {
  name: string;               // §2
  args: unknown;              // canonical-args (already normalized object)
  mustBeFresh: boolean;       // default true
  lifetimeMs: number;         // default 10_000
  nonce: string;              // 64 random bits, b64u
  hopLimit: number;           // default 8
  authContext?: string;       // never set by a sender; ignored on receipt [P-8.4]
}
```

- **[P-4.1]** The consumer MUST compute the name locally from the manifest and the arguments.
- **[P-4.2]** An Interest for a non-cacheable tool MUST NOT be issued: the call proceeds as plain MCP.
- **[P-4.3]** Every forwarder MUST recompute `args-digest` from `args` and drop the Interest if it does
  not match the name (error `DIGEST_MISMATCH`).
- **[P-4.4]** A forwarder MUST decrement `hopLimit` and drop at 0 (an Interest arriving with
  `hopLimit = 0` is answered `HOP_LIMIT`; one arriving with `h > 0` is forwarded with `h − 1`). It MUST
  drop an Interest whose `(name, nonce)` is already in the PIT from a different face (loop); the same
  nonce from the same face is a duplicate and is silently dropped.

### 4.1 Hop-by-hop fields (not part of the Interest or Data objects)

Each hop correlates answers to requests. In the HTTP overlay the HTTP exchange does it. In the
engine (`@idem/core`), packets carry the Interest's `nonce` back on the Data or Nack of that hop; a
forwarder forwards upstream with the nonce of the Interest that created the PIT entry and answers each
downstream with that downstream's own nonce. Data and Nacks are accepted **only** from the face the
Interest was forwarded to, for the same name; anything else is dropped as unsolicited.

The end user's credential (`Authorization: Bearer` in the overlay) travels hop by hop to the producer
like an HTTP header. It is never part of a name or a cache key; the edge derives `authContext` from it
(§8).

## 5. Data

```ts
interface Data {
  name: string;
  content: CallToolResult;    // MCP result without its top-level _meta (ephemeral: traces, dev.idem/*)
  meta: {
    contentDigest: string;    // b64u(SHA-256(JCS(content)))
    producedAt: number;       // epoch ms, producer clock
    freshnessMs: number;      // >= 0
    scope: "public" | "private";
    policyVersion: number;
  };
  signature: {
    alg: "Ed25519";
    keyLocator: string;       // "/idem/v1/<producer>/_key/<keyId>"
    value: string;            // b64u(Ed25519(JCS({ name, ...meta })))
  };
  ageMs?: number;             // NOT signed; accumulated per hop, like the HTTP Age header
}
```

- **[P-5.1]** The producer MUST compute the name **itself** from the received arguments and never copy
  it from the Interest. If it differs from the Interest name, respond `DIGEST_MISMATCH`.
- **[P-5.2]** Signed bytes = `JCS({ name, contentDigest, producedAt, freshnessMs, scope, policyVersion })`.
  The `keyLocator` MUST name the same producer as the Data name; a verifier MUST reject a Data whose
  key belongs to another producer (`UNTRUSTED_KEY`). `keyId` is the RFC 7638 JWK thumbprint of the
  public key, base64url, truncated to 16 characters.
- **[P-5.3]** A result with `isError: true` MUST have `freshnessMs = 0` and MUST NOT be cached.
- **[P-5.4]** Multi-round-trip interim results (`resultType: "input_required"`) and requests carrying
  `inputResponses`/`requestState` MUST NOT use IDEM, consistent with MCP's own cache rule [MCP-CACHE].
- **[P-5.5]** The consumer MUST verify the signature and `contentDigest` before handing content to the
  agent. On failure → `BAD_SIGNATURE`, and the consumer retries once as a **plain call** (§9.1,
  `POST /idem/v1/call`), which no PIT aggregates and no CS answers: at the producer itself when the
  consumer can reach it, otherwise through its edge. The retried result MUST carry Data signed for the
  same name and pass the same verification; if it does not, the call fails with `BAD_SIGNATURE` and no
  content is handed to the agent (ADR-024).

## 6. Manifest

```ts
interface Manifest {
  producer: string;
  version: number;                       // bumped on every change; key rotation bumps it
  keys: { keyId: string; publicKeyJwk: JsonWebKey; notAfter?: number }[];
  tools: {
    tool: string;
    schemaDigest: string;
    cacheable: boolean;
    ttlMs: number;
    scope: "public" | "private";
    normalizers: Record<string /* JSON Pointer */, Normalizer[]>;
    policyVersion: number;
  }[];
  signature: { alg: "Ed25519"; keyId: string; value: string };  // over JCS(manifest without signature)
}
```

Distribution: `GET https://<producer>/.well-known/idem.json` (overlay), `_meta["dev.idem/manifest"]` in
`server/discover`, and as named Data `/idem/v1/<producer>/_manifest/<version>` (native).

- **[P-6.1]** A call is cacheable only if **all** hold: (a) the manifest marks the tool
  `cacheable: true`; (b) the tool has `readOnlyHint: true` (defense in depth); (c) the manifest's
  `schemaDigest` matches the one derived from `tools/list`; (d) §5.3 and §5.4 do not apply.
- **[P-6.2]** Trust in v1: *trust on first use* with optional key **pinning** via configuration. The
  manifest MUST be verified with a key it lists **and** that is currently trusted (pinned, or listed by
  the currently accepted manifest), except on first contact. A key dropped by a rotation can no longer
  sign manifests. Every listed `keyId` MUST equal the thumbprint of its JWK.
- **[P-6.3]** A node MUST reject a manifest whose `version` is lower than the accepted one (rollback).

## 7. Forwarder behavior

```
on Interest I from face F:
  tool not cacheable (manifest), or            → error NOT_CACHEABLE; event "bypass"
    I.name.schemaDigest ≠ the manifest's         (reason "not_cacheable")
  digest(I.args) ≠ I.name.argsDigest           → error DIGEST_MISMATCH; event "drop"
  hopLimit == 0 or loop (name, nonce)          → drop; event "drop"
  CS has D for I.name (scope ok), and D is     → reply D to F; event "cs_hit"
    fresh [P-8.1] and not expired [P-8.6],
    or I.mustBeFresh is false
  PIT has an entry for I.name                  → add F (with I.mustBeFresh) to entry;
                                                 event "pit_aggregate"
  otherwise                                    → create PIT entry; FIB(producer) → next hop;
                                                 send I; event "upstream_out"

on Data D from upstream:
  verify signature and contentDigest           → fail: drop, error to waiters; "verify_fail"
  signed scope private, manifest public        → drop, BAD_SIGNATURE to waiters [P-8.5]
  D expired at this node [P-8.6]               → not stored; EXPIRED to every waiter that
                                                 asked for fresh Data, D to the others;
                                                 event "drop" (reason "expired")
  D stale by its ageMs [P-8.1]                 → EXPIRED to every waiter that asked for fresh
                                                 Data, D to the others; event "drop"
                                                 (reason "stale")
  if cacheable and scope allows                → store in CS; event "cs_insert"
  deliver D to every other face in the entry   → event "pit_satisfy"(n faces)
  remove PIT entry

on Data D for a passthrough Interest [P-7.3]   → the same two checks, then relay D or EXPIRED

on PIT entry lifetime expiry                   → TIMEOUT error to all; event "pit_expire"

on plain call C from face F (not IDEM)         → FIB(producer) → next hop; send C with no PIT or CS
                                                 state; relay the result to F; event "bypass"
```

A forwarder never turns an Interest into a plain call. A consumer that follows [P-4.2] does not send
an Interest for a non-cacheable tool, so one that arrives is answered `NOT_CACHEABLE` (§10), which
also covers a consumer holding an older manifest than the forwarder. The sender MAY then repeat the
request as a plain call. Plain calls (non-cacheable tools, arguments outside the schema [P-3.1], the
retry of [P-5.5]) are what the forwarder passes through (ADR-024).

- **[P-7.1]** A forwarder MUST verify the signature before inserting into the CS. Verification may be
  disabled **only** by an experiment flag (to measure its cost), never in production.
- **[P-7.2]** Errors (TIMEOUT, upstream 5xx, `isError`) MUST NOT be cached (no negative caching in v1).
- **[P-7.3]** The PIT MUST bound its entries and faces per entry (DoS protection); when exceeded →
  passthrough (forwarded without PIT state, not aggregated, not cached; event `bypass`, reason `pit_full`).
  The passthrough keeps the Interest's `mustBeFresh` and the tool's `ttlMs`, and its answer gets the
  checks of [P-8.6] as if it had a PIT entry of its own.
- **[P-7.4]** The CS MUST respect a byte budget. Replacement policy is configurable (`lru` default;
  `lfu` and `fifo` for experiments).

## 8. Freshness and scope

- **[P-8.1]** Data is fresh at node N while `ageMs + (now_N − receivedAt_N) < freshnessMs`. When serving
  from the CS, N updates `ageMs` (semantics of the HTTP `Age` header, RFC 9111). Age is counted per
  hop from receipt, on each node's own clock, so this rule needs no clock agreement between nodes.
  `ageMs` is unsigned: on its own the rule binds honest nodes only. What a dishonest node can make a
  receiver accept is bounded by the signed `producedAt` instead [P-8.6], up to the clock tolerance
  (§11, stale replay). An Interest with `mustBeFresh: true` is answered from a CS entry only if the
  entry is fresh by this rule and [P-8.2] and not expired by [P-8.6]; an Interest with
  `mustBeFresh: false` may be answered from any entry, fresh or not.
- **[P-8.2]** A Data's `freshnessMs` MUST be ≤ the manifest `ttlMs` for that tool. Forwarders and
  consumers MUST use `min(freshnessMs, ttlMs)` as the effective freshness.
- **[P-8.3]** `scope: "public"`: may go to any CS. `scope: "private"`: only to a CS **partitioned by
  `authContext`**, and only at the first forwarder (edge). Forwarders beyond the edge MUST NOT store
  `private` Data.
  The PIT is partitioned the same way: `private` Interests are aggregated **only** with Interests of
  the same `authContext`. A `private` Interest without `authContext` (anonymous, or beyond the edge) is
  never aggregated and never answered from a CS.
- **[P-8.4]** The edge MUST derive `authContext` itself, non-reversibly, from the credential that
  arrived with the Interest and a secret of its own (e.g. HMAC of the token with the edge secret), and
  MUST ignore any `authContext` present in a received Interest, on any face: a value the sender could
  choose would let it read another context's partition. Without a credential, or on a face that does
  not lead to consumers, there is no `authContext`. It MUST NOT be propagated beyond the first hop. The
  field stays in the Interest (§4) so that the wire format is unchanged; senders leave it unset.
- **[P-8.5]** A Data whose signed `scope` is `private` while the manifest says `public` MUST NOT be
  delivered to an aggregated PIT entry nor cached: the forwarder treats it as invalid (`BAD_SIGNATURE`
  to waiters, who retry as in [P-5.5]).
- **[P-8.6]** *Signed lifetime.* At node N, the apparent age of a Data is `now_N − producedAt`. IDEM
  takes this from the `apparent_age` of RFC 9111 §4.2.3 [RFC9111], with the signed `producedAt` in
  place of the unsigned `Date`, and departs from it in one point: the age is not clamped at 0. RFC 9111
  can clamp because its caches are trusted; with a signed timestamp, a clamp would let a Data dated in
  the future live for its freshness plus the offset. The Data is **outside its signed lifetime** at N
  when it is *expired*, `apparentAge ≥ min(freshnessMs, ttlMs) + clockToleranceMs`, or *dated in the
  future*, `producedAt − now_N > clockToleranceMs`. `clockToleranceMs` is a local option of each node,
  default 60 000 ms; it covers clock skew between N and the producer plus transit time. Inside the
  window a Data is accepted whatever its apparent age. In this section "expired" means outside the
  signed lifetime, on either side. A forwarder MUST
  treat Data from upstream that is expired as invalid: it MUST NOT store it, and MUST answer every
  downstream whose Interest had `mustBeFresh: true` with `EXPIRED` instead of the Data; a downstream
  whose Interest had `mustBeFresh: false` MAY receive it. The PIT keeps the flag per downstream, so
  Interests with different flags still share one entry. A forwarder MUST NOT answer an Interest with
  `mustBeFresh: true` from a CS entry that is expired, whatever its `ageMs` says.
  The invariant these rules keep: a downstream that asked for fresh Data receives only Data that is
  fresh by [P-8.1]/[P-8.2] and within its signed lifetime, whatever the flags of the other Interests
  in the entry, and also through a passthrough [P-7.3]. For Data from upstream, fresh by [P-8.1] means
  that its `ageMs`, if present, is below `min(freshnessMs, ttlMs)`; a Data without `ageMs` comes from
  the producer, not from a cache, and is not stale on arrival. A forwarder MUST answer such a
  downstream `EXPIRED` instead of a Data that is stale by its `ageMs`, as for an expired one, and
  deliver the Data to the others. Being within its signed lifetime, that Data MAY be stored; it is
  never a fresh hit, since its age already reaches its freshness.
- **[P-8.7]** *Consumer lifetime check.* After [P-5.5], a consumer whose Interest had
  `mustBeFresh: true` MUST NOT hand an expired Data [P-8.6], judged by its own clock, to the agent,
  nor a Data stale by its `ageMs` [P-8.1] (the rule of [P-8.6] for Data from upstream). It retries once as a plain call, the retry of [P-5.5], which it also makes when a forwarder answered
  `EXPIRED`. The retried result MUST carry Data signed for the same name, verify, and not be expired.
  If it verifies but is expired (on either side), the call fails with the local error `CLOCK_SKEW`
  and no content is handed to the agent; its message carries `producedAt`, the local time and which
  side of the window was missed. Data the producer has just made that already looks expired, or dated
  further in the future than the tolerance, means this node's clock and the producer's disagree by more
  than the window allows, or a party on the retry's path replays as well; the two cannot be told
  apart, so the call fails closed. A consumer that asked with `mustBeFresh: false` skips the check. A
  native-only consumer (§9.2) has no plain call and fails closed with `EXPIRED`, as it does for
  `BAD_SIGNATURE` [P-9.3].

## 9. Transport bindings

### 9.1 HTTP overlay (over MCP 2026-07-28)

- **Consumer → edge:** two ways in, and both end as a consumer request to the edge's engine (§7).
  An IDEM-aware consumer speaks IDEM over HTTP (the endpoints below): it names the call itself
  [P-4.1] and verifies the answer [P-5.5]. An unmodified MCP client speaks plain MCP (Streamable HTTP,
  stateless) to the edge's MCP endpoint (below), and the edge is the consumer on its behalf, so
  existing agents need no code change.
- **Edge → producer:** MCP `tools/call` with `_meta["dev.idem/interest"] = { name, nonce, hopLimit }`.
  The producer returns the normal `CallToolResult` and attaches
  `_meta["dev.idem/data"] = { name, meta, signature }`. Clients unaware of IDEM ignore `_meta`, so the
  binding is backward compatible.
- **Forwarder ↔ forwarder:** `POST /idem/v1/interest` with an `Interest` body (JSON); response is a
  `Data` (JSON) or an error `{ code, message }`. HTTP/2 by default.
- **IDEM over HTTP, endpoints** (implemented in `@idem/gateway`):

  | Who | Route | Body → response |
  |---|---|---|
  | producer | `GET /.well-known/idem.json` | signed manifest |
  | producer | `GET /idem/v1/tools` | tool list (`tools/list` shape) |
  | producer, forwarder | `POST /idem/v1/interest` | Interest → Data, or `{ code, message }` |
  | producer, forwarder | `POST /idem/v1/call` | `{ producer, tool, args }` → `CallToolResult` (passthrough) |
  | forwarder | `GET /idem/v1/manifest/<producer>` | the manifest this node trusts |
  | forwarder | `GET /idem/v1/tools/<producer>` | the producer's tool list (proxied) |

  Headers: `Authorization: Bearer <credential>` (end user, §4.1); `idem-forwarder: <id>` on requests
  sent by a forwarder (absent ⇒ the sender is a consumer and this node is its edge); `idem-trace` on
  responses (JSON list of `{ node, events }` per hop, diagnostic only, never trusted). Status codes:
  400 `DIGEST_MISMATCH`, 422 `NOT_CACHEABLE`,
  502 `BAD_SIGNATURE`/`EXPIRED`/`UNTRUSTED_KEY`/`UPSTREAM_ERROR`, 504 `TIMEOUT`, 508 `HOP_LIMIT`/`LOOP`. A producer MAY expose this endpoint set in addition to MCP;
  edges SHOULD prefer it when available (ADR-014).
- **MCP endpoint of the edge:** the edge MAY expose a plain MCP (Streamable HTTP) endpoint listing the
  producer's tools; each `tools/call` enters the forwarder engine as a consumer request (implemented in
  `@idem/mcp`, `createMcpEdge`). The endpoint **terminates MCP**: an MCP server (the SDK) parses and
  routes each request, and re-exposes the producer's tools, and only its tools. For the client it
  names the call [P-4.1], verifies the Data [P-5.5] and returns the verified content, with
  `_meta["dev.idem/data"]` attached so an IDEM-aware client can verify again. It does not route on the
  `Mcp-Method` / `Mcp-Name` headers of 2026-07-28 [MCP-CHANGELOG]; a proxy that forwards MCP bytes
  untouched and decides from those headers is not part of v1 (ADR-024).
- **Legacy producer (no IDEM):** an operator MAY run a *proxy-producer* in front of an MCP server that
  does not speak IDEM (the *origin*), next to the edge or in the same process. The proxy is an IDEM
  producer in its own right (§5, §6): it calls the origin over plain MCP, names the results and signs
  them with its own key. Trust then shifts to the proxy, and every Data says so in its name and
  `keyLocator`. Implemented in `@idem/mcp` (`createProxyProducer`, ADR-038).
  - **[P-9.5]** A proxy-producer MUST use its own producer name and its own key, so its names are
    `/idem/v1/<proxy>/…` and its `keyLocator` is `/idem/v1/<proxy>/_key/<keyId>`. It MUST NOT sign
    under the origin's name. A consumer that trusts only the origin's name or key therefore does not
    accept proxy-signed Data as the origin's: [P-5.2] rejects it (`UNTRUSTED_KEY`, or
    `BAD_SIGNATURE` when the name or key locator is rewritten). Each tool in the proxy's tool list
    carries `_meta["dev.idem/origin"] = { origin, readOnlyHint }`: the origin endpoint, and who stands
    behind the listed `readOnlyHint` (`"origin"`, `"operator"` or `"absent"`). Like the tool list
    itself, this record is unsigned and informational. The Manifest and Data objects are unchanged.
  - **[P-9.6]** The cache policy is the operator's, per tool. A tool without one is not cacheable:
    each call to it is relayed to the origin and returned unsigned. For [P-6.1](b) the proxy MUST NOT
    offer as cacheable a tool that the origin's `tools/list` marks `readOnlyHint: false`, and it MUST
    NOT offer one that has no `readOnlyHint` unless the operator asserts it explicitly
    (`operatorAssertsReadOnly`); its own tool list then shows `readOnlyHint: true` with
    `"operator"` in the origin record.
  - **[P-9.7]** The credential of an origin call follows the operator's declared policy, never the
    tool's current state. For a tool the operator declared cacheable with scope `public`, the proxy
    MUST NOT forward the end user's credential to the origin, whether the tool is offered as
    cacheable, held after a schema change [P-9.8] or refused after a refresh: it calls with its own
    configured credential or none, so a shared answer cannot depend on who asked and an origin cannot
    obtain user credentials by changing its tool list. For a tool declared `private` it forwards the
    end user's credential (`Authorization: Bearer`) and signs the Data `private` (§8). For a tool the
    operator did not declare, or declared not cacheable, the operator made no promise: the proxy
    relays the call with the end user's credential, as a transparent proxy would, and never signs it.
  - **[P-9.8]** After each origin call whose result it would sign, the proxy MUST compare the origin's
    current `tools/list` entry for that tool (input schema, output schema, `readOnlyHint`) with the one
    its manifest was built from. On a difference it MUST NOT sign that result: the Interest is
    answered `NOT_CACHEABLE`, and a plain call gets the origin's result unsigned. Every changed tool
    then stays not cacheable, under a new manifest version, until the proxy re-reads the origin's
    tool list (a refresh), which bumps the version again; the new `schema-digest` gives new names
    [P-2.2], and an Interest for an old name is never answered. Data signed before the change stays
    servable until its freshness ends, as for any producer that changes a tool.
  - Origin failures and `isError` results become error results with `freshnessMs = 0`, never cached
    ([P-5.3], [P-7.2]). An origin result with `resultType: "input_required"` is not named [P-5.4];
    v1 does not relay the rounds of a multi-round-trip call, so a plain call gets an error result.

### 9.2 Native NDN (NDNts)

Implemented in `@idem/ndn` (ADR-026). The binding maps the objects of §4 and §5 onto NDN packet
format v0.3; naming, signing and verification are `@idem/core`'s, unchanged.

- **Names.** Each `/`-separated part of an IDEM name is one GenericNameComponent holding its UTF-8
  bytes; reserved names (§2.2, e.g. key locators) map the same way. `args-digest` stays an explicit
  component, and NDN appends its own ParametersSha256DigestComponent, computed over
  ApplicationParameters. The IDEM name of a native packet is its NDN name without that last
  component.
- **NDN Interest.** Name = IDEM name + ParametersSha256DigestComponent; ApplicationParameters =
  `JCS(canonical args)`, the exact bytes `args-digest` hashes; `MustBeFresh`, `InterestLifetime` and
  `HopLimit` mapped from §4; CanBePrefix unset. NDN's 32-bit Nonce replaces the IDEM nonce (the
  first four bytes of it when present); loop detection is NFD's, so every Interest sent, a
  retransmission included, carries a fresh nonce (NFD drops a name and nonce pair it has seen).
  The consumer always sets MustBeFresh (§4 default): NFD answers an Interest without it from a
  stale CS entry, so the TTL would no longer bound what the consumer gets.
  - **[P-9.1]** A native Interest MUST NOT be signed and its ApplicationParameters MUST be exactly
    `JCS(canonical args)`. Then the ParametersSha256DigestComponent is a function of the canonical
    args only, and two calls share a native name iff they share an IDEM name [P-2.1].
  - **[P-9.2]** A native producer MUST check that ApplicationParameters hash to the name's
    `args-digest` (the [P-4.3] check, on bytes) before [P-5.1]; failures are answered as below.
    `authContext` is never encoded [P-8.4].
- **NDN Data.** Same Name as the Interest; ContentType BLOB; `FreshnessPeriod = freshnessMs`;
  Content = `JCS({ content, meta, signature })` (the §5 Data without `name`, which the NDN name
  carries, and without the unsigned `ageMs`); NDN Ed25519 signature by the producer's key with
  KeyLocator = the IDEM key locator `/idem/v1/<producer>/_key/<keyId>` mapped as above.
  - **[P-9.3]** A native consumer MUST verify both signatures before handing content to the agent:
    the NDN signature, by a key the trust store holds for the producer of the name (the same key
    the IDEM `keyLocator` names, [P-5.2]), and the IDEM signature and `contentDigest` exactly as in
    [P-5.5]. A Data that fails either check is not delivered (`BAD_SIGNATURE` / `UNTRUSTED_KEY`).
    The plain-call retry of [P-5.5] needs the overlay; a native-only consumer fails closed.
  - Loss is recovered by the consumer: an Interest left unanswered for its InterestLifetime MAY be
    expressed again for the same name with a fresh Nonce (NFD drops a name + Nonce pair it has
    seen). `NdnConsumer` does so `retransmissions` times (default 0).
  - A Data larger than 8800 bytes (NFD's packet limit) is not segmented in v1: the producer answers
    `UPSTREAM_ERROR`.
- **Errors.** An application-level Nack: a Data with the Interest's name, ContentType NACK,
  `FreshnessPeriod = 0`, Content = `JCS({ code, message })` (§10), signed like any Data.
- **Scope.** NFD's PIT and CS are keyed by name alone and have no authorization context.
  - **[P-9.4]** `private` tools MUST NOT use the native binding: a consumer MUST NOT express a
    native Interest for one, a producer MUST answer one with a `NOT_CACHEABLE` Nack without running
    the tool, and a consumer MUST reject a native Data whose signed scope is `private`. Private
    calls stay on the overlay (§8, [P-8.3]).
- **Manifest and tools.** The producer also answers `/idem/v1/<producer>/_manifest/<version>` (the
  signed manifest, §6) and `/idem/v1/<producer>/_tools/<version>` (the `tools/list` shape) to
  Interests with CanBePrefix, so a native consumer can bootstrap trust ([P-6.2]) with no overlay.
- PIT, CS and aggregation are **NFD's own**; the binding adds none. Routing: static routes
  (`nfdc route add`) or NLSR in Mini-NDN. The native binding measures IDEM over a real ICN network
  (spec 05, E4).

## 10. Errors

| Code | When |
|---|---|
| `DIGEST_MISMATCH` | name does not match the arguments |
| `BAD_SIGNATURE` | invalid signature or contentDigest |
| `EXPIRED` | Data outside its signed lifetime at a forwarder (expired, or dated further in the future than the tolerance), or stale by its `ageMs`, for an Interest that asked for fresh Data; the message says which [P-8.6]; a consumer retries as in [P-8.7] |
| `UNTRUSTED_KEY` | key not in a trusted manifest |
| `NOT_CACHEABLE` | Interest for a tool the manifest does not mark cacheable, or whose `schema-digest` is not the manifest's: it should have been a plain call [P-4.2] (§7) |
| `TIMEOUT` | PIT entry expired |
| `HOP_LIMIT` / `LOOP` | dropped by hop limit or loop detection |
| `UPSTREAM_ERROR` | producer or next hop failed, or no route |

Local errors (raised by implementations, never sent on the wire): `BAD_NAME`, `BAD_JSON`,
`BAD_ENCODING`, `INVALID_ARGS` (→ passthrough), `UNSUPPORTED_SCHEMA` (→ not cacheable), `BAD_POLICY`,
`BAD_MANIFEST`, `CRYPTO_UNSUPPORTED`, `CLOCK_SKEW` (the verified retry of [P-8.7] is still outside
its signed lifetime, on either side).
When a local error must cross a hop it maps to `NOT_CACHEABLE` (argument/schema/name problems) or
`UPSTREAM_ERROR` (anything else).

## 11. Security and privacy considerations

- **Cache poisoning:** mitigated by signature verification at forwarder and consumer (P-5.5, P-7.1).
  The consumer's retry is verified as well, so stripping the signature from a retried result does
  not downgrade the call to an unverified one (P-5.5).
- **Stale replay:** hop-relative freshness (P-8.1) rests on the unsigned `ageMs`, so on its own it
  binds honest nodes only. A party on the path of an Interest (a forwarder, or an attacker on a link
  without TLS) can answer it with a **genuine Data that is past its freshness**: one it recorded
  earlier, or one whose `ageMs` it understates. The signed lifetime (P-8.6) bounds what that buys:
  once the Data is expired, a forwarder that receives it does not cache it and does not deliver it to
  an Interest that asked for fresh Data (`EXPIRED`), no CS serves it as fresh, and a consumer refuses
  it and retries (P-8.7). What remains is **bounded
  staleness**: a replay younger than `min(freshnessMs, ttlMs) + clockToleranceMs` is accepted, and a
  forwarder may keep and serve it until that bound, never later. The tolerance is therefore the most
  a path can stretch a Data's life; next to a short TTL it is large, and a deployment chooses it with
  that in mind. The rule needs the producer's and each verifier's clocks to agree within the
  tolerance. A node whose clock runs ahead by more than the freshness plus the tolerance fails closed:
  its forwarder answers `EXPIRED`, and its consumer, after the plain-call retry, `CLOCK_SKEW`. A node
  whose clock runs behind accepts Data for longer by up to the tolerance; behind by more, it sees fresh
  Data dated in its future and fails closed the same way. A Data the producer signed with a far-future
  `producedAt` (a clock glitch) is refused everywhere until that date comes within the tolerance, so an
  on-path party cannot keep replaying it. What the on-path party
  cannot do at all: change the content, answer under another name, or sign for the producer; and Data
  is accepted only from the face its Interest went to (§4.1), so an off-path party cannot inject one.
  TLS per hop in the overlay leaves only the forwarders themselves on the path. E5 measures both the
  claim and the bound (05-evaluation, ADR-034).
- **Cross-user leakage:** MCP's `cacheScope` is not access control [MCP-CACHE]; here scope is signed
  by the producer, the `private` CS is partitioned (P-8.3), and the partition key is derived by the
  edge, never taken from the Interest (P-8.4).
- **Timing side channel:** a fast hit reveals that someone already requested that name. Logged as a
  risk (Q3); optional mitigation (random delay for `private`) is out of v1.
- **Arguments in clear:** the Interest carries arguments to the producer. In the overlay, TLS per hop.
  The name exposes only the digest.
- **PIT DoS:** bounds (P-7.3).
- **Key compromise:** rotation via a new manifest version; `notAfter` per key.

## 12. Versioning

The `/idem/v1` prefix versions the wire format. Any incompatible change to §2, §4, §5 or §6 requires
`/idem/v2` and an ADR.

## Appendix A. JSON Schema subset (IDEM v1) [P-3.6]

Annotations (ignored for validation): `$schema`, `$id`, `$comment`, `title`, `description`, `default`
(used by §3 step 2), `examples`, `deprecated`, `readOnly`, `writeOnly`, `format` (not asserted).

Validation keywords: `type` (string or array; `integer` = whole number), `enum`, `const` (equality by
JCS), `properties`, `required`, `additionalProperties`, `minProperties`, `maxProperties`, `items`,
`prefixItems`, `minItems`, `maxItems`, `uniqueItems` (by JCS), `minLength`, `maxLength` (code points),
`pattern` (ECMA-262, `u` flag), `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
`multipleOf`, `anyOf`, `allOf`, `oneOf`, `not`. Boolean schemas are allowed.

Defaults are applied from `properties`, `items` and `prefixItems` only, never through combinators.
Not supported in v1 (tool not cacheable): `$ref`, `$defs`, `if`/`then`/`else`, `dependentSchemas`,
`patternProperties`, `unevaluated*`, `contains`, and any other keyword.
