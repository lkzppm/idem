#!/usr/bin/env bash
# Build YaNFD (ndnd's forwarder) for the browser: a pinned ndnd commit plus this folder's JS face
# bridge, compiled with GOOS=js GOARCH=wasm. Writes the sandbox's copy to apps/web/public/ndn/:
#   yanfd.wasm, wasm_exec.js (from the same Go toolchain) and build.json (commit, Go version, digests).
#
#   experiments/ndn/yanfd-wasm/build.sh            # needs git and Go (tested with 1.27.4)
#   NDND_DIR=/path/to/ndnd build.sh                # reuse a checkout instead of cloning
set -euo pipefail

NDND_COMMIT=4593618
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$ROOT/apps/web/public/ndn"
WORK="${NDND_DIR:-${TMPDIR:-/tmp}/idem-ndnd-$NDND_COMMIT}"

if [ ! -d "$WORK/.git" ]; then
  git clone --quiet https://github.com/named-data/ndnd "$WORK"
fi
git -C "$WORK" fetch --quiet origin
git -C "$WORK" checkout --quiet --force "$NDND_COMMIT"
git -C "$WORK" clean --quiet -fdx fw/cmd/wasmfw fw/face/js-transport.go || true

cp "$HERE/js-transport.go" "$WORK/fw/face/js-transport.go"
mkdir -p "$WORK/fw/cmd/wasmfw"
cp "$HERE/main.go" "$WORK/fw/cmd/wasmfw/main.go"

mkdir -p "$OUT"
(cd "$WORK" && GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$OUT/yanfd.wasm" ./fw/cmd/wasmfw)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$OUT/wasm_exec.js"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
full="$(git -C "$WORK" rev-parse HEAD)"
bridge="$(cat "$HERE/js-transport.go" "$HERE/main.go" | shasum -a 256 | cut -d' ' -f1)"
cat > "$OUT/build.json" <<EOF
{
  "what": "YaNFD (named-data/ndnd fw) compiled to WebAssembly with the IDEM JS face bridge",
  "license": "MIT (ndnd and the bridge); wasm_exec.js is BSD-3-Clause (the Go project)",
  "ndnd": "$full",
  "go": "$(go env GOVERSION)",
  "bridgeSha256": "$bridge",
  "wasmSha256": "$(sha "$OUT/yanfd.wasm")",
  "wasmBytes": $(wc -c < "$OUT/yanfd.wasm" | tr -d ' '),
  "wasmGzipBytes": $(gzip -9c "$OUT/yanfd.wasm" | wc -c | tr -d ' '),
  "wasmExecSha256": "$(sha "$OUT/wasm_exec.js")",
  "builtBy": "experiments/ndn/yanfd-wasm/build.sh"
}
EOF
echo "built $OUT/yanfd.wasm ($(wc -c < "$OUT/yanfd.wasm" | tr -d ' ') bytes)"
