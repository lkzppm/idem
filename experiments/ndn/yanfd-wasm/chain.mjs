// Three YaNFD-on-WASM instances in one JS process: edge1, edge2 → regional → producer.
import { readFileSync } from "node:fs";
import { Data, digestSigning, Interest, Name } from "@ndn/packet";
import { Decoder, Encoder } from "@ndn/tlv";

const [wasmPath, execPath] = process.argv.slice(2);
await import(execPath);
const bytes = readFileSync(wasmPath);
const module = await WebAssembly.compile(bytes); // compiled once, instantiated per forwarder
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function forwarder() {
  const go = new globalThis.Go();
  const ready = new Promise((r) => (globalThis.onYanfdReady = r));
  const instance = await WebAssembly.instantiate(module, go.importObject);
  go.run(instance);
  await ready;
  const api = globalThis.yanfd;
  delete globalThis.yanfd;
  return api;
}
const l3 = (frame) => {
  const t = new Decoder(frame).read();
  if (t.type !== 0x64) return frame;
  const d = new Decoder(t.value);
  while (!d.eof) {
    const f = d.read();
    if (f.type === 0x50) return f.value;
  }
};
const kind = (b) => new Decoder(b).read().type;

// A link between two forwarders: one face on each, frames handed across (unwrapped to the L3 packet).
function link(a, b) {
  let fa, fb;
  fa = a.addFace((frame) => b.send(fb, l3(frame)));
  fb = b.addFace((frame) => a.send(fa, l3(frame)));
  return [fa, fb];
}
const [e1, e2, reg] = [await forwarder(), await forwarder(), await forwarder()];
const [e1up] = link(e1, reg);
const [e2up] = link(e2, reg);
e1.route("/idem", e1up);
e2.route("/idem", e2up);

let upstream = 0;
const P = reg.addFace(async (frame) => {
  const b = l3(frame);
  if (kind(b) !== 0x05) return;
  const I = new Decoder(b).decode(Interest);
  upstream++;
  await sleep(100);
  const data = new Data(I.name, Data.FreshnessPeriod(10_000), new TextEncoder().encode("from producer"));
  await digestSigning.sign(data);
  reg.send(P, Encoder.encode(data));
});
reg.route("/idem", P);

const got = [];
const consumerOn = (fwd, label) => {
  const id = fwd.addFace((frame) => {
    const b = l3(frame);
    if (kind(b) === 0x06) got.push(label);
  });
  return (n) => fwd.send(id, Encoder.encode(new Interest(n, Interest.MustBeFresh)));
};
const a = consumerOn(e1, "agent on edge1"),
  b = consumerOn(e2, "agent on edge2");
await sleep(50);
const n = new Name("/idem/v1/demo.idem.dev/search_corpus/s/q1");
a(n);
await sleep(500);
b(n);
await sleep(500);
console.log(JSON.stringify({ answered: got, producerInterests: upstream }));
console.log(upstream === 1 && got.length === 2 ? "PASS: regional CS served the second edge" : "FAIL");
