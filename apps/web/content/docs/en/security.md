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

*The defence:* the scope is declared in the manifest and signed inside each Data. `private` Data is stored only at the edge, in a Content Store partition keyed by the authorization context, and the PIT is partitioned the same way [P-8.3]. The authorization context is derived by the edge with a keyed one-way function and never travels beyond the first hop [P-8.4]. A Data signed `private` for a tool the manifest calls `public` is rejected instead of being delivered to a shared entry [P-8.5]. In MCP, by contrast, `cacheScope` is a label that servers are told not to rely on for access control [MCP-CACHE].

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
- **Experiment E5.** An adversarial suite repeats those attempts and adds others, and reports how many were rejected. See [Evaluation](/docs/evaluation#e5).

## What version 1 leaves open {#limits}

These are known and stated, not overlooked.

- **Timing.** A fast answer reveals that someone already asked for that name. It is recorded as a risk (question Q3 in the [decisions](/docs/decisions)); a mitigation such as a random delay for `private` names is out of v1.
- **Arguments are visible to the path.** The Interest carries the arguments, because the producer needs them. In the HTTP overlay each hop is protected by TLS, but every forwarder on the path reads them. The name exposes only a digest.
- **Private content is not encrypted.** The edge that caches a `private` Data can read it. Encrypting private content so that shared caches could hold it is future work (Q2).
- **First contact.** Trust on first use means the first manifest seen for a producer is believed. A deployment that cannot accept that pins the producer's key by configuration.
- **Stale replay.** Freshness is counted hop by hop: `ageMs` has to be updated at every hop, so it is outside the signature, and no rule compares the signed `producedAt` with a receiver's clock [P-8.1]. A party on the path of an Interest, a forwarder or an attacker on a link without TLS, can therefore answer with a genuine Data that is past its freshness: one it recorded earlier, or one whose age it understates. The signature is valid, so the answer is accepted, and a forwarder caches it as new for one more freshness period. It cannot change the content, answer under another name, or inject anything from off the path. The safety experiment measures this and reports it as accepted. The rule that would close it, bounding a Data's life by `producedAt` with a tolerance for clock skew, needs clocks that agree between the producer and every verifier; it is recorded and deferred (ADR-025 and question Q6 in the [decisions](/docs/decisions)).
- **A gateway that signs for a legacy server.** The protocol allows an edge to sign on behalf of a producer that does not speak IDEM. Trust then moves to the gateway, and the Data must say so in its key locator. This mode is not implemented.
- **The demo key.** When the demo deployment has no key configured, its producer signs with a key derived from a public seed, so that every function instance signs alike. Anyone can forge Data for that key. It demonstrates the mechanism and protects nothing.
