import { describe, expect, it } from "vitest";
import { pcmWav } from "./wav.js";

describe("pcmWav", () => {
  it("writes a 16 kHz mono 16-bit WAV header and the samples", () => {
    const v = new DataView(pcmWav(new Float32Array([0, 1, -1]), 16000));
    const tag = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(at + i)));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(6);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(v.getInt16(48, true)).toBe(-0x7fff);
  });
});
