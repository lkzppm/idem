import { describe, expect, it } from "vitest";
import { b64uDecode, b64uEncode, utf8, utf8Length } from "./encoding";
import { isIdemError } from "./errors";
import { jcs } from "./jcs";

function fromHex(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

describe("JCS (RFC 8785) [P-3.4]", () => {
  it("serializes the RFC 8785 §3.2.2 sample", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(jcs(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("sorts properties by UTF-16 code units (RFC 8785 §3.2.3 sample)", () => {
    const input = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      דּ: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      ö: "Latin Small Letter O With Diaeresis",
    };
    // Check the serialized order (Object.keys would list integer-like keys such as "1" first).
    const out = jcs(input);
    const positions = ["\r", "1", "\u0080", "\u00f6", "\u20ac", "\ud83d\ude00", "\ufb33"].map((k) =>
      out.indexOf(JSON.stringify(k)),
    );
    expect(positions.every((v, i) => v >= 0 && (i === 0 || v > (positions[i - 1] as number)))).toBe(true);
  });

  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("serializes IEEE 754 %s as %s (RFC 8785 Appendix B)", (hex, expected) => {
    expect(jcs(fromHex(hex))).toBe(expected);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a lone surrogate", "\ud800"],
    ["a bigint", 1n],
    ["a function", () => 1],
    ["a Date", new Date(0)],
  ])("rejects %s with BAD_JSON", (_label, v) => {
    expect(() => jcs(v)).toThrow(expect.objectContaining({ code: "BAD_JSON" }));
  });

  it("rejects cycles and keeps shared (acyclic) references", () => {
    const shared = { a: 1 };
    expect(jcs({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    try {
      jcs(cyc);
      expect.unreachable();
    } catch (e) {
      expect(isIdemError(e, "BAD_JSON")).toBe(true);
    }
  });

  it("omits undefined properties like JSON.stringify", () => {
    expect(jcs({ b: 1, a: undefined })).toBe('{"b":1}');
  });
});

describe("encoding", () => {
  it("round-trips base64url without padding", () => {
    for (let n = 0; n < 40; n++) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + n) & 0xff);
      const s = b64uEncode(bytes);
      expect(s).not.toMatch(/[+/=]/);
      expect([...b64uDecode(s)]).toEqual([...bytes]);
    }
    expect(b64uEncode(utf8("hello?>"))).toBe("aGVsbG8_Pg");
  });

  it("computes UTF-8 length without allocating", () => {
    for (const s of ["", "abc", "é", "€", "😀", "a😀é€"]) expect(utf8Length(s)).toBe(utf8(s).length);
  });
});
