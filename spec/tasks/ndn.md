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

## Next

- [ ] Connect to a real NFD (`@ndn/node-transport` UDP/Unix face in Node, `@ndn/ws-transport` in the browser)
- [ ] Runnable native producer and consumer (CLI) for Mini-NDN; star and tree topologies, netem
- [ ] E4: overlay vs native under loss (spec 05); figures from `experiments/results/**` only
- [ ] Segmentation (`@ndn/segmented-object`) if any workload result exceeds 8800 bytes
- [ ] The plain-call retry of [P-5.5] for a native consumer that also has an overlay path
