A cache that anyone on the path can fill is a liability unless every answer can be checked. IDEM's security rests on one move: **trust is in the data, not in the path**. This page lists what can be attempted against it, the rule that stops each attempt, and what version 1 knowingly leaves open. The binding text is [protocol §11](/docs/protocol#s11) and the rules it cites.

## Who is trusted for what {#model}

| Party | Trusted to | Not trusted to |
|---|---|---|
| **Producer** | run the tool, say what is cacheable, sign its answers | speak for another producer |
| **Forwarder** | forward, aggregate and cache | alter an answer, decide what is cacheable, see another user's private result |
| **Consumer** | ask, and verify what it gets | be someone else: its authorization context is derived at the edge, not declared by it |
| **The path** (links, other tenants) | nothing | anything |

A forwarder is an untrusted helper. If it misbehaves, the worst it can do to a consumer that verifies is fail to answer.

## Attacks and the rule behind each defence {#attacks}

### Poisoning a cache {#poisoning}

*The attempt:* get a wrong answer stored in a Content Store, so that later consumers receive it.

*The defence:* a Data is signed over its name and a digest of its content. A forwarder verifies the signature and the content digest **before** inserting into the CS [P-7.1], so a forged or altered Data never becomes a cache entry. Verification can be turned off only by an experiment flag that exists to measure its cost. A Data that nobody asked for is not even considered: it is accepted only from the face the Interest was sent to, for the same name ([protocol §4.1](/docs/protocol#s4-1)).

### Tampering with an answer in flight {#tampering}

*The attempt:* change the content of a Data between the producer and the consumer, or between two forwarders.

*The defence:* the consumer verifies the signature and the content digest before the agent sees the result [P-5.5]. A mismatch is `BAD_SIGNATURE`, and the consumer asks again with a plain call that no cache answers. That second answer has to carry a signature for the same name and pass the same check; if it does not, the call fails and the agent gets an error, never the unverified content. The same check at each forwarder means a tampered Data is stopped at the first honest hop, and everyone who was waiting on that PIT entry gets an error and retries.

### Replaying an old answer {#replay}

*The attempt:* a party on the path of an Interest, a forwarder or an attacker on a link without TLS, answers with a genuine Data that is past its freshness: one it recorded earlier, or one whose age it understates. The signature is valid, because the Data is the producer's own.

*The defence:* two rules, because the age a Data carries cannot be signed. Hop by hop, each node counts the age from the moment it received the Data and adds it to `ageMs`, which changes at every hop and is therefore outside the signature. An honest cache never serves a copy past its freshness [P-8.1], but that rule binds honest nodes only. The second rule uses what is signed: every node compares `producedAt` with its own clock. A Data is outside its **signed lifetime** when it is older than its freshness plus a clock tolerance, or dated further in the future than the tolerance. The tolerance is a local option of each node, `clockToleranceMs`, 60 seconds by default [P-8.6]. A forwarder does not cache such a Data and answers `EXPIRED` to every waiter that asked for fresh Data. A consumer refuses it as well, judged by its own clock, and asks again once with a plain call that no cache answers [P-8.7]. This bounds the replay and does not remove it: see [below](#limits).

### Forging a name {#forgery}

*The attempt:* send an Interest whose name says one thing and whose arguments say another, hoping the answer to the arguments gets cached under the name.

*The defence:* every forwarder recomputes the args digest from the arguments and drops the Interest if it does not match the name, with `DIGEST_MISMATCH` [P-4.3]. The producer goes further: it never copies the name from the Interest, it computes the name itself from the arguments it received [P-5.1].

### Signing with someone else's key {#keys}

*The attempt:* sign a Data for producer A with a key that belongs to producer B, or with a key nobody vouched for.

*The defence:* the Data's `keyLocator` must name the same producer as the Data's name, and the key must be one that producer's trusted manifest lists and that has not expired. Otherwise the result is `UNTRUSTED_KEY` [P-5.2].

### Replacing the manifest {#manifest}

*The attempt:* present a manifest that marks a dangerous tool cacheable, lists the attacker's key, or revives an old policy.

*The defence:* a manifest is accepted only if it is signed by a key it lists **and** that key is already trusted for the producer, pinned or listed by the manifest currently accepted [P-6.2]. Every listed key id must be the thumbprint of its key. A manifest with a lower version than the accepted one is rejected [P-6.3]. The exception is first contact, discussed [below](#limits).

### Reading another user's result {#leakage}

*The attempt:* user B asks for a name whose answer was cached for user A, and receives A's data. Or B's Interest arrives while A's is pending, and B is added to A's PIT entry.

*The defence:* the scope is declared in the manifest and signed inside each Data. `private` Data is stored only at the edge, in a Content Store partition keyed by the authorization context, and the PIT is partitioned the same way [P-8.3]. The edge derives the authorization context itself, with a keyed one-way function over the credential that arrived with the request and a secret of its own. It ignores any `authContext` written into an Interest it receives, on every face, so a consumer that knows another user's value cannot use it to read that user's partition. The value never travels beyond the first hop [P-8.4]. A Data signed `private` for a tool the manifest calls `public` is rejected instead of being delivered to a shared entry [P-8.5]. In MCP, by contrast, `cacheScope` is a label that servers are told not to rely on for access control [MCP-CACHE].

### Caching what should not be cached {#hints}

*The attempt:* a server, or something impersonating its tool list, marks a tool with `readOnlyHint: true` so that a state-changing call is answered from a cache.

*The defence:* MCP annotations are untrusted and are never sufficient. A call is cacheable only if the producer's **signed** manifest says so, and the annotation agrees, and the schema digest in the manifest matches the tool list the consumer sees [P-6.1].

### Merging two different questions {#merging}

*The attempt:* craft arguments that a helpful normalization would collapse onto another request's name.

*The defence:* nobody normalizes on their own initiative. Only the normalizers the producer declared in its signed manifest are applied [P-3.3], and every implementation validates against the same fixed JSON Schema subset, so all nodes agree on which arguments are valid and therefore on names [P-3.6].

### Exhausting a forwarder {#dos}

*The attempt:* flood a forwarder with Interests for distinct names so that its tables grow without bound, or make an Interest circle forever.

*The defence:* the PIT bounds its entries and the faces per entry; beyond that an Interest is forwarded without state [P-7.3]. The Content Store has a byte budget [P-7.4]. Every Interest carries a hop limit that each forwarder decrements, and a nonce that exposes loops [P-4.4]. Errors are never cached, so a failure cannot be amplified into a cached failure [P-7.2].

## How the defences are checked {#checked}

- **Tests.** The protocol's MUST rules have tests that cite the rule's id in their names. The `private` isolation test runs in the star and in the tree topology and must not be removed or skipped.
- **The sandbox.** Its attack controls tamper with a Data in flight, send an Interest with a forged args digest, and ask for another user's private result. Each attempt has to be visibly rejected. See [Using the sandbox](/docs/sandbox#attacks).
- **Experiment E5.** An adversarial suite repeats those attempts and adds others, and reports how many were rejected. Each variant is labelled in advance with what the protocol says of it: a claim that must hold, a documented limit, or a known leak. See [Evaluation](/docs/evaluation#e5).
- **The same attacks against a cache that is trusted.** E5 also runs three of the attacks against the evaluation's baseline B5, a shared response cache at the gateway with no signatures, the way the products that cache tool results ship one today: a stored result rewritten in the cache, a result rewritten between the producer and the gateway, and a per-user tool listed as cacheable in a cache keyed by tool and arguments. The same judge decides each trial on ground truth. These rows are not claims about IDEM. Each is shown next to the IDEM variant that faces the same attack, and the outcome is on the [benchmarks](/benchmarks) page.

## What version 1 leaves open {#limits}

These are known and stated, not overlooked.

- **Timing.** A fast answer reveals that someone already asked for that name. It is recorded as a risk (question Q3 in the [decisions](/docs/decisions)); a mitigation such as a random delay for `private` names is out of v1.
- **Arguments are visible to the path.** The Interest carries the arguments, because the producer needs them. In the HTTP overlay each hop is protected by TLS, but every forwarder on the path reads them. The name exposes only a digest.
- **Private content is not encrypted.** The edge that caches a `private` Data can read it. Encrypting private content so that shared caches could hold it is future work (Q2).
- **First contact.** Trust on first use means the first manifest seen for a producer is believed. A deployment that cannot accept that pins the producer's key by configuration.
- **Bounded staleness.** The signed lifetime bounds a replay; it does not remove it. A genuine Data younger than its freshness plus the clock tolerance is accepted, and a forwarder may keep and serve it until that bound, never later [P-8.6]. The tolerance is therefore the most a party on the path can stretch a Data's life. Next to a short TTL the default of 60 seconds is large, and a deployment chooses the value with that in mind. The party still cannot change the content, answer under another name, or inject anything from off the path. The safety experiment measures both sides: a replay outside the lifetime, which must be refused, and a replay inside the tolerance, which it reports as accepted by design (ADR-034 in the [decisions](/docs/decisions)).
- **Clocks have to agree.** The signed lifetime needs the producer's clock and each verifier's clock to agree within the tolerance. A node whose clock is ahead by more than the freshness plus the tolerance sees even a newly signed answer as expired. A node whose clock is behind by more than the tolerance sees it as dated in the future. Both fail closed: a forwarder answers `EXPIRED`, and a consumer whose plain-call retry verifies but is still outside its lifetime fails the call with the local error `CLOCK_SKEW`. The message of that error carries `producedAt`, the local time and which side of the window was missed. A wrong clock and a replay on the path of the retry cannot be told apart, so in both cases no content reaches the agent [P-8.7]. A clock that is behind by less than the tolerance accepts a Data for that much longer.
- **A proxy that signs for a legacy server.** An operator can put a proxy-producer in front of an MCP server that does not speak IDEM, the origin. It is implemented in `@idem/mcp` as `createProxyProducer` (ADR-038). The proxy is a producer with its own name and its own key, and it never signs under the origin's name [P-9.5]. Trust moves to the proxy, and every Data says so in its name and key locator. A consumer that verifies proxy-signed Data learns that the holder of the proxy's key vouches that this content answered this call, with this freshness and scope, and that no node between the proxy and the consumer changed it. It does not learn that the origin produced the content, nor that the origin's tool is really read-only: the proxy could have invented either. The cache policy is the operator's, per tool. A tool the origin marks `readOnlyHint: false` cannot be offered as cacheable, and a tool with no hint only when the operator asserts it explicitly [P-9.6]. A `public` tool is never called with the end user's credential [P-9.7]. When the origin changes a tool, the proxy stops signing that tool until it re-reads the origin's tool list [P-9.8]. One gap is known: forwarders and consumers read a manifest once, so after such a change an edge that has not been restarted answers `NOT_CACHEABLE` or `DIGEST_MISMATCH` for that tool.
- **The demo key.** When the demo deployment has no key configured, its producer signs with a key derived from a public seed, so that every function instance signs alike. Anyone can forge Data for that key. It demonstrates the mechanism and protects nothing.
