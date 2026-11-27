# Native NDN binding (`@idem/ndn`)

Protocol §9.2 and ADR-026. The package wraps `@idem/core` (naming, `Producer`, `buildInterest`,
`verifyData`) and NDNts; PIT, CS and aggregation are NFD's. Roadmap M6.

## Package (2026-11-18)

- [x] `packages/ndn` scaffold (tsdown, vitest, tsconfig); `@ndn/{packet,tlv,keychain,endpoint,fw}` pinned to
  0.0.20260427 (verified with `pnpm view`)
- [x] IDEM name ⇄ NDN name (`toNdnName`, `fromNdnName`, `ndnUri`)
- [x] Q1 decided (ADR-026): `args-digest` kept as a component, NDN's ParametersSha256DigestComponent after
  it; test that equivalent calls get identical names in both bindings (`name.test.ts`, `e2e.test.ts`)
- [x] Interest codec: AppParameters = JCS(canonical args), unsigned, no `authContext` [P-9.1], [P-9.2]
- [x] Data codec: Content = JCS `{ content, meta, signature }`, FreshnessPeriod, application Nacks, size limit
- [x] NDN Ed25519 signing/verification via the NDNts keychain with core's WebCrypto keys; `verifyNdnData`
  checks the NDN and the IDEM signature [P-9.3]
- [x] `serveNdn` (wraps core `Producer`; `_manifest` and `_tools`) and `NdnConsumer` (TOFU over NDN)
- [x] `private` never on NDN: consumer does not send, producer Nacks without running the tool, consumer
  rejects private Data [P-9.4]; tests in `codec.test.ts`, `verify.test.ts`, `e2e.test.ts`
- [x] In-process round trip over `@ndn/fw` (no aggregation, no CS there: that is NFD's)
- [x] TLV inspector (`tlvTree`, `toHex`) for the sandbox view
- [x] Browser bundle check: rolldown with browser conditions resolves only `*_browser.js` NDNts files and no
  `node:*` module
- [x] Spec 01 §9.2, spec 02, spec 03, docs API/architecture/introduction (en, pt) and the pt protocol
  translation (hash refreshed) updated

## Against a real NFD (2026-11-18)

- [x] NFD in Docker: `experiments/ndn/nfd/` (compose project `idem-nfd`: edge1, edge2 → regional;
  `ghcr.io/named-data/nfd:20261105` = NFD 24.07+git.23c53535, pinned by digest `sha256:d9ffc6fb…`;
  `nfd.conf` makes host TCP faces local so `/localhost/nfd/rib/register` works through Docker's NAT)
- [x] `@ndn/{node-transport,ws-transport,nfdmgmt,l3face}` 0.0.20260427 as dev dependencies (verified with
  `pnpm view`); producer registers its prefix with `enableNfdPrefixReg`, consumers use TCP, UDP or
  WebSocket faces
- [x] Harness `packages/ndn/scripts/nfd-check.ts` (+ `scripts/nfd/`), `pnpm exp:ndn` (starts and removes the
  forwarders) or `pnpm --filter @idem/ndn nfd:check`; config `experiments/ndn/nfd/config.json`
- [x] Opt-in test `packages/ndn/src/nfd.test.ts` (`IDEM_NFD=1`, skipped otherwise)
- [x] Run `experiments/results/ndn-nfd/20261118T052108Z-eb7ced2e`: 9/9 scenarios, 82/82 checks: round trip
  (name = IDEM name + PSDC computed by hand), 8 concurrent calls → 1 Interest upstream and 1 tool run, CS
  hit then MustBeFresh upstream after the TTL (and stale Data without MustBeFresh), equivalent spellings
  share PIT and CS, `private` (not sent; Nack without running; rejected when a rogue serves it, also
  from NFD's CS), three tampering variants rejected (`BAD_SIGNATURE` ×2, `UNTRUSTED_KEY`), 8800-byte
  Data over TCP and UDP and `UPSTREAM_ERROR` at 8801, regional CS serving a second edge, WebSocket face
- [x] Fixed: `NdnConsumer.call` reported every verification failure as `BAD_SIGNATURE`; now `UNTRUSTED_KEY`
  and `NOT_CACHEABLE` as [P-9.3]/[P-9.4] say (tests in `e2e.test.ts`). Spec 01 §9.2 notes fresh nonces and
  MustBeFresh (NFD behaviour, no rule changed); ADR-026 records the check; pt protocol translation and
  hash refreshed; spec 05 describes the check
- [x] Harness robustness: NFD's status datasets are cached for 1 s, so counter reads are spaced 1.1 s apart;
  hand-made Interests get fresh nonces (NFD's Dead Nonce List); management commands are retried; the run
  stops early when the Docker VM clock is more than 30 s off the host's (NFD then rejects the producer's
  signed prefix registration). Run `20261118T052519Z-eb7ced2e` is kept as it came out: S8 failed with
  NFD's 403 on `nfdc route add` while Docker Desktop's VM clock was being corrected (it was 15 min behind
  the host after a stall); the guard and the retry were added after it
- [ ] Known limit, not fixed: NFD caches altered Data, so every consumer of that name fails closed until
  the entry goes stale (S6). A native-only consumer has no way around it (no plain-call retry)

## Next

- [ ] Browser: connect the sandbox's `NdnConsumer` to NFD's WebSocket face (or to an in-page forwarder,
  see `experiments/ndn/yanfd-wasm/`); check Safari's mixed-content rules for `ws://localhost` from https
- [ ] Runnable native producer and consumer (CLI) for Mini-NDN; star and tree topologies, netem. Mini-NDN itself was not used: E4 ran on the Docker bench (`experiments/ndn/bench`, star and tree, `tc netem`)
- [x] E4: overlay vs native under loss (spec 05): full run `experiments/results/e4/20261118T141957Z-de2bcf73` (2026-11-18, 3 seeds)
- [ ] E4 with at least 10 seeds (about 2.5 h of Docker)
- [ ] RTT-based retransmission timer for `NdnConsumer` (today it re-expresses after a fixed InterestLifetime)
- [x] `NdnConsumer` applies the signed lifetime and fails closed with `EXPIRED`, since a native-only consumer has no plain call to retry on [P-8.7] (`e2e.test.ts`, 2026-11-27)
- [ ] Segmentation (`@ndn/segmented-object`) if any workload result exceeds 8800 bytes
- [ ] The plain-call retry of [P-5.5] for a native consumer that also has an overlay path
