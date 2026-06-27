import { describe, expect, it } from "vitest";

import { base64ToBytes, bytesToBase64, bytesToPgHex, pgHexToBytes } from "./bytes";

const sample = new Uint8Array([0x00, 0x0a, 0x1b, 0xff, 0x10, 0x80, 0x7f]);

describe("pg bytea hex codec", () => {
  it("round-trips through the \\x hex literal", () => {
    const hex = bytesToPgHex(sample);
    expect(hex).toBe("\\x000a1bff10807f");
    expect([...pgHexToBytes(hex)]).toEqual([...sample]);
  });

  it("tolerates a missing \\x prefix and whitespace", () => {
    expect([...pgHexToBytes("  000a1bff  ")]).toEqual([0x00, 0x0a, 0x1b, 0xff]);
  });

  it("handles the empty array", () => {
    expect(bytesToPgHex(new Uint8Array())).toBe("\\x");
    expect(pgHexToBytes("\\x").length).toBe(0);
    expect(pgHexToBytes("").length).toBe(0);
  });
});

describe("base64 codec", () => {
  it("round-trips arbitrary bytes", () => {
    expect([...base64ToBytes(bytesToBase64(sample))]).toEqual([...sample]);
  });

  it("round-trips a large array (exercises chunking)", () => {
    const big = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    expect([...base64ToBytes(bytesToBase64(big))]).toEqual([...big]);
  });
});
