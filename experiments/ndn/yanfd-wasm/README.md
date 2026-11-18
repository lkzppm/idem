# YaNFD in the browser (proof of concept, 2026-11-18)

NDNd's forwarder (YaNFD, `github.com/named-data/ndnd`, MIT) compiled to WebAssembly (`GOOS=js GOARCH=wasm`)
and driven from JavaScript with real NDN TLV packets made by NDNts. Nothing here is a simulation of NFD's
rules: it is the forwarder's own Go code, with its own PIT, Content Store, FIB and strategies.

- `js-transport.go` — a face transport that hands NDNLPv2 frames to and from JavaScript. It goes in
  `fw/face/` of an ndnd checkout (it needs the package's unexported `transportBase`).
- `main.go` — goes in `fw/cmd/wasmfw/`. It starts the forwarder without socket listeners (YaNFD's own
  `Start()` exits when no listener comes up, which is always the case in a browser) and exposes
  `yanfd.addFace(onFrame) → faceId`, `yanfd.send(faceId, bytes)` and `yanfd.route(prefix, faceId)`.
- `single.mjs` — one forwarder, one producer face, four consumer faces.
- `chain.mjs` — three instances (edge1, edge2 → regional), compiled once and instantiated per forwarder.

## Build and run

```sh
git clone https://github.com/named-data/ndnd && cd ndnd   # tested at 4593618 (2026-11-09)
cp <here>/js-transport.go fw/face/ && mkdir -p fw/cmd/wasmfw && cp <here>/main.go fw/cmd/wasmfw/
GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o yanfd.wasm ./fw/cmd/wasmfw   # Go 1.27.4
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" .
# from a folder whose node_modules has @ndn/packet and @ndn/tlv (0.0.20260427):
node single.mjs ./yanfd.wasm ./wasm_exec.js
node chain.mjs ./yanfd.wasm ./wasm_exec.js
```

## Results (Node 26.7.0, Apple silicon)

- `yanfd.wasm`: 9,679,217 bytes, 2,642,036 gzipped.
- `single.mjs`: PASS. Two identical Interests sent together reached the producer once (PIT aggregation)
  and both consumers got the Data; a repeat after the answer was served from the Content Store (the
  producer saw no new Interest); a different name went upstream (2 in total).
- `chain.mjs`: PASS. An agent on edge1 and then one on edge2 asked the same name; the producer saw one
  Interest; the regional forwarder's Content Store answered edge2.

## Limits found so far

- YaNFD keeps global state ("only one instance should be created"): one WebAssembly instance per
  forwarder (separate memory), or one Web Worker each.
- It runs on wall-clock time (Go timers): Interest lifetimes and freshness are real seconds, so a run is
  not on the sandbox's seeded virtual clock and cannot be sped up.
- It does not know IDEM: it forwards and caches by name only, verifies nothing, and has no notion of
  `private` (ADR-026 already keeps `private` off native NDN).
