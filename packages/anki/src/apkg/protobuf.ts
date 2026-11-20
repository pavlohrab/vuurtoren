/**
 * A small Protocol Buffers reader: enough to read the few fields Vuurtoren needs from the
 * note type, template, deck and deck-options blobs and the media list of an Anki package.
 */

/** Every field of one message, by field number, in the order they appear. */
export type ProtoFields = Map<number, (bigint | Uint8Array | number)[]>;

/** Decode one message. Varints are bigint, length-delimited fields bytes, fixed32 a float. */
export function decodeProto(buf: Uint8Array): ProtoFields {
  const out: ProtoFields = new Map();
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 0;
  const varint = (): bigint => {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (i >= buf.length) throw new Error("Truncated protobuf varint");
      const b = buf[i++]!;
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
      shift += 7n;
    }
  };
  while (i < buf.length) {
    const tag = Number(varint());
    const field = tag >>> 3;
    const wire = tag & 7;
    let value: bigint | Uint8Array | number;
    if (wire === 0) value = varint();
    else if (wire === 2) {
      const len = Number(varint());
      if (i + len > buf.length) throw new Error("Truncated protobuf field");
      value = buf.subarray(i, i + len);
      i += len;
    } else if (wire === 5) {
      value = view.getFloat32(i, true);
      i += 4;
    } else if (wire === 1) {
      value = view.getFloat64(i, true);
      i += 8;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    const list = out.get(field);
    if (list) list.push(value);
    else out.set(field, [value]);
  }
  return out;
}

const decoder = new TextDecoder();

export function protoString(f: ProtoFields, n: number): string {
  const v = f.get(n)?.at(-1);
  return v instanceof Uint8Array ? decoder.decode(v) : "";
}

export function protoInt(f: ProtoFields, n: number): number {
  const v = f.get(n)?.at(-1);
  return typeof v === "bigint" ? Number(BigInt.asIntN(64, v)) : 0;
}

export function protoFloat(f: ProtoFields, n: number): number | undefined {
  const v = f.get(n)?.at(-1);
  return typeof v === "number" ? v : undefined;
}

export function protoMessage(f: ProtoFields, n: number): ProtoFields | undefined {
  const v = f.get(n)?.at(-1);
  return v instanceof Uint8Array ? decodeProto(v) : undefined;
}

/** A repeated float field, packed or not. */
export function protoFloats(f: ProtoFields, n: number): number[] {
  const out: number[] = [];
  for (const v of f.get(n) ?? []) {
    if (typeof v === "number") out.push(v);
    else if (v instanceof Uint8Array) {
      const view = new DataView(v.buffer, v.byteOffset, v.byteLength);
      for (let i = 0; i + 4 <= v.length; i += 4) out.push(view.getFloat32(i, true));
    }
  }
  return out;
}

/** Every occurrence of a repeated message field. */
export function protoMessages(f: ProtoFields, n: number): ProtoFields[] {
  return (f.get(n) ?? []).flatMap((v) => (v instanceof Uint8Array ? [decodeProto(v)] : []));
}
