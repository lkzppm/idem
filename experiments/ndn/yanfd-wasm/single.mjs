// Proof of concept: YaNFD (ndnd's forwarder) compiled to WebAssembly, driven from JS with real NDN TLV packets.
import { readFileSync } from "node:fs";
import { Data, Interest, Name, digestSigning } from "@ndn/packet";
import { Decoder, Encoder } from "@ndn/tlv";

const [wasmPath, execPath] = process.argv.slice(2);
await import(execPath); // defines globalThis.Go
const go = new globalThis.Go();
const ready = new Promise((r) => (globalThis.onYanfdReady = r));
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), go.importObject);
go.run(instance);
await ready;
const fw = globalThis.yanfd;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Unwrap an NDNLPv2 frame (type 0x64) to its fragment (0x50), else the packet itself.
function l3(frame) {
  const d = new Decoder(frame);
  const t = d.read();
  if (t.type !== 0x64) return frame;
  const inner = new Decoder(t.value);
  while (!inner.eof) {
    const f = inner.read();
    if (f.type === 0x50) return f.value;
  }
  return undefined;
}
const decode = (bytes) => {
  const t = new Decoder(bytes).read();
  return t.type === 0x05 ? new Decoder(bytes).decode(Interest) : t.type === 0x06 ? new Decoder(bytes).decode(Data) : undefined;
};

// Producer face: counts the Interests that reach it and answers after 200 ms.
let upstream = 0;
const P = fw.addFace(async (frame) => {
  const pkt = decode(l3(frame));
  if (!(pkt instanceof Interest)) return;
  upstream++;
  await sleep(200);
  const data = new Data(pkt.name, Data.FreshnessPeriod(10_000), new TextEncoder().encode(`answer #${upstream}`));
  await digestSigning.sign(data);
  fw.send(P, Encoder.encode(data));
});
fw.route("/idem", P);

// Consumer faces: record the Data they receive.
const got = new Map();
const consumer = (label) => {
  const id = fw.addFace((frame) => {
    const pkt = decode(l3(frame));
    if (pkt instanceof Data) got.set(label, new TextDecoder().decode(pkt.content));
  });
  return (name) => fw.send(id, Encoder.encode(new Interest(name, Interest.MustBeFresh, Interest.Lifetime(4000))));
};
const c1 = consumer("c1"), c2 = consumer("c2"), c3 = consumer("c3"), c4 = consumer("c4");
await sleep(50);

const name = new Name("/idem/v1/demo.idem.dev/fetch_page/s1/a1");
c1(name); c2(name);            // two identical Interests at once (different nonces)
await sleep(600);
const afterBurst = upstream;
c3(name);                      // a repeat after the answer came back
await sleep(300);
const afterRepeat = upstream;
c4(new Name("/idem/v1/demo.idem.dev/fetch_page/s1/a2")); // a different call
await sleep(600);

const result = {
  aggregation: { upstreamInterests: afterBurst, consumersAnswered: [got.get("c1"), got.get("c2")] },
  contentStore: { upstreamAfterRepeat: afterRepeat, c3: got.get("c3") },
  differentName: { upstreamTotal: upstream, c4: got.get("c4") },
};
console.log(JSON.stringify(result, null, 2));
const pass = afterBurst === 1 && got.get("c1") && got.get("c2") && afterRepeat === 1 && got.get("c3") && upstream === 2 && got.get("c4");
console.log(pass ? "PASS: PIT aggregation and Content Store work in YaNFD-on-WASM" : "FAIL");
process.exit(pass ? 0 : 1);
