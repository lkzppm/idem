---
"@idem/ndn": patch
---

`NdnConsumer.call` reports why a native Data was refused as [P-9.3] and [P-9.4] say: `UNTRUSTED_KEY`
when a signature is by a key the trust store does not hold for the producer, `NOT_CACHEABLE` for a
validly signed `private` Data, `BAD_SIGNATURE` otherwise. It used to report `BAD_SIGNATURE` for all of
them. Found running the binding against NFD 24.07 (`pnpm exp:ndn`).
