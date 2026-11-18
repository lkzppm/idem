import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("csv", () => {
  it("writes a header, full-precision numbers and empty cells for missing or non-finite values", () => {
    const text = toCsv(
      ["a", "b", "c"],
      [
        { a: 1, b: 0.1 + 0.2, c: "x" },
        { a: Number.NaN, c: true },
      ],
    );
    expect(text).toBe("a,b,c\n1,0.30000000000000004,x\n,,true\n");
  });

  it("quotes commas, quotes and line breaks, and reads them back", () => {
    const rows = [
      { k: 'say "hi"', v: "a,b" },
      { k: "two\nlines", v: "plain" },
    ];
    const text = toCsv(["k", "v"], rows);
    expect(text).toBe('k,v\n"say ""hi""","a,b"\n"two\nlines",plain\n');
    expect(parseCsv(text)).toEqual(rows);
  });

  it("parses CRLF input, a missing final newline and empty input", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});
