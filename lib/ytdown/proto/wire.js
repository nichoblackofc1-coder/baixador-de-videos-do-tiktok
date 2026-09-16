import { Buffer } from 'node:buffer';

export const WIRE = {
  VARINT: 0,
  FIXED64: 1,
  LENGTH: 2,
  START_GROUP: 3,
  END_GROUP: 4,
  FIXED32: 5,
};

/** Sequential reader over a protobuf-encoded buffer. */
export class Reader {
  constructor(buffer, start = 0, end = buffer.length) {
    this.buf = buffer;
    this.pos = start;
    this.end = end;
  }

  get eof() {
    return this.pos >= this.end;
  }

  varint() {
    let result = 0n;
    let shift = 0n;
    while (this.pos < this.end) {
      const byte = this.buf[this.pos];
      this.pos += 1;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7n;
      if (shift > 70n) throw new Error('varint too long');
    }
    throw new Error('unexpected end of buffer reading varint');
  }

  varintNumber() {
    const v = this.varint();
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }

  fixed32() {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  float() {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }

  fixed64() {
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  double() {
    const v = this.buf.readDoubleLE(this.pos);
    this.pos += 8;
    return v;
  }

  bytes() {
    const len = Number(this.varint());
    if (this.pos + len > this.end) throw new Error('length-delimited field overruns buffer');
    const slice = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }

  skip(wireType) {
    switch (wireType) {
      case WIRE.VARINT:
        this.varint();
        break;
      case WIRE.FIXED64:
        this.pos += 8;
        break;
      case WIRE.LENGTH:
        this.bytes();
        break;
      case WIRE.FIXED32:
        this.pos += 4;
        break;
      default:
        throw new Error(`cannot skip wire type ${wireType}`);
    }
  }

  /** Yields `{ field, wire }` for each tag; caller consumes the value. */
  *tags() {
    while (!this.eof) {
      const key = Number(this.varint());
      yield { field: key >>> 3, wire: key & 7 };
    }
  }
}

/** Incremental protobuf writer. Fields must be appended in any order. */
export class Writer {
  #chunks = [];

  #push(buf) {
    this.#chunks.push(buf);
    return this;
  }

  static encodeVarint(value) {
    let v = typeof value === 'bigint' ? value : BigInt(Math.trunc(value));
    if (v < 0n) v = BigInt.asUintN(64, v);
    const out = [];
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      out.push(byte);
    } while (v > 0n);
    return Buffer.from(out);
  }

  tag(field, wire) {
    return this.#push(Writer.encodeVarint((field << 3) | wire));
  }

  uint(field, value) {
    if (value == null) return this;
    this.tag(field, WIRE.VARINT);
    return this.#push(Writer.encodeVarint(value));
  }

  bool(field, value) {
    if (value == null) return this;
    return this.uint(field, value ? 1 : 0);
  }

  sint(field, value) {
    if (value == null) return this;
    const v = BigInt(Math.trunc(value));
    return this.uint(field, (v << 1n) ^ (v >> 63n));
  }

  fixed32(field, value) {
    if (value == null) return this;
    this.tag(field, WIRE.FIXED32);
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(value >>> 0, 0);
    return this.#push(b);
  }

  float(field, value) {
    if (value == null) return this;
    this.tag(field, WIRE.FIXED32);
    const b = Buffer.allocUnsafe(4);
    b.writeFloatLE(value, 0);
    return this.#push(b);
  }

  double(field, value) {
    if (value == null) return this;
    this.tag(field, WIRE.FIXED64);
    const b = Buffer.allocUnsafe(8);
    b.writeDoubleLE(value, 0);
    return this.#push(b);
  }

  bytes(field, value) {
    if (value == null) return this;
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.tag(field, WIRE.LENGTH);
    this.#push(Writer.encodeVarint(buf.length));
    return this.#push(buf);
  }

  string(field, value) {
    if (value == null) return this;
    return this.bytes(field, Buffer.from(String(value), 'utf8'));
  }

  /** Nest a submessage built by `fn`. Skipped when the submessage is empty. */
  message(field, fn) {
    const sub = new Writer();
    fn(sub);
    const buf = sub.finish();
    return this.bytes(field, buf);
  }

  raw(buf) {
    return this.#push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  }

  finish() {
    return Buffer.concat(this.#chunks);
  }
}

/**
 * Structural decode with no schema: returns a map of field number to the list
 * of raw values seen. Used to reverse unknown messages.
 */
export function inspect(buffer, depth = 0, maxDepth = 6) {
  const reader = new Reader(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const out = {};

  const add = (field, value) => {
    (out[field] ??= []).push(value);
  };

  try {
    for (const { field, wire } of reader.tags()) {
      switch (wire) {
        case WIRE.VARINT:
          add(field, { type: 'varint', value: reader.varintNumber() });
          break;
        case WIRE.FIXED64: {
          const pos = reader.pos;
          const raw = reader.fixed64();
          const asDouble = Buffer.from(buffer).readDoubleLE(pos);
          add(field, { type: 'fixed64', value: raw, double: asDouble });
          break;
        }
        case WIRE.FIXED32: {
          const pos = reader.pos;
          const raw = reader.fixed32();
          const asFloat = Buffer.from(buffer).readFloatLE(pos);
          add(field, { type: 'fixed32', value: raw, float: asFloat });
          break;
        }
        case WIRE.LENGTH: {
          const slice = reader.bytes();
          const entry = { type: 'bytes', length: slice.length, hex: slice.subarray(0, 32).toString('hex') };
          const text = slice.toString('utf8');
          if (/^[\x20-\x7e]*$/.test(text) && slice.length > 0) entry.text = text;
          if (depth < maxDepth && slice.length > 1) {
            const nested = tryInspect(slice, depth + 1, maxDepth);
            if (nested) entry.nested = nested;
          }
          add(field, entry);
          break;
        }
        default:
          reader.skip(wire);
      }
    }
  } catch {
    out.__truncated = true;
  }

  return out;
}

function tryInspect(slice, depth, maxDepth) {
  try {
    const probe = new Reader(slice);
    let fields = 0;
    for (const { wire } of probe.tags()) {
      if (wire === 3 || wire === 4 || wire > 5) return null;
      probe.skip(wire);
      fields += 1;
    }
    if (fields === 0) return null;
    return inspect(slice, depth, maxDepth);
  } catch {
    return null;
  }
}
