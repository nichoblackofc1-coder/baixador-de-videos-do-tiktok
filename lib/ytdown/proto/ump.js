import { Buffer } from 'node:buffer';

/**
 * UMP (Universal Media Playback) framing.
 *
 * A UMP stream is a sequence of parts. Each part is:
 *   [varint partType][varint partSize][partSize bytes payload]
 *
 * The varint here is NOT protobuf varint. It is a big-endian-ish scheme where
 * the number of leading 1 bits in the first byte selects the total byte count:
 *
 *   0xxxxxxx                            -> 1 byte, 7 bit value
 *   10xxxxxx yyyyyyyy                   -> 2 bytes, 6 low bits + 8 shifted
 *   110xxxxx yyyyyyyy zzzzzzzz          -> 3 bytes
 *   1110xxxx ...                        -> 4 bytes
 *   1111xxxx ...                        -> 5 bytes (first byte's low bits unused)
 *
 * The continuation bytes are little-endian relative to the first byte's bits.
 */

export function varintSize(firstByte) {
  if (firstByte < 0x80) return 1;
  if (firstByte < 0xc0) return 2;
  if (firstByte < 0xe0) return 3;
  if (firstByte < 0xf0) return 4;
  return 5;
}

/** Decode a UMP varint at `offset`. Returns `{ value, size }`. */
export function readVarint(buf, offset) {
  const first = buf[offset];
  const size = varintSize(first);
  if (offset + size > buf.length) throw new RangeError('ump varint overruns buffer');

  let value;
  switch (size) {
    case 1:
      value = first;
      break;
    case 2:
      value = (first & 0x3f) | (buf[offset + 1] << 6);
      break;
    case 3:
      value = (first & 0x1f) | (buf[offset + 1] << 5) | (buf[offset + 2] << 13);
      break;
    case 4:
      value =
        (first & 0x0f) | (buf[offset + 1] << 4) | (buf[offset + 2] << 12) | (buf[offset + 3] << 20);
      break;
    default:
      // 5 byte form ignores the low nibble of the first byte entirely.
      value = buf.readUInt32LE(offset + 1);
      break;
  }
  return { value: value >>> 0, size };
}

export function writeVarint(value) {
  if (value < 0x80) return Buffer.from([value]);
  if (value < 0x4000) return Buffer.from([0x80 | (value & 0x3f), (value >> 6) & 0xff]);
  if (value < 0x200000) {
    return Buffer.from([0xc0 | (value & 0x1f), (value >> 5) & 0xff, (value >> 13) & 0xff]);
  }
  if (value < 0x10000000) {
    return Buffer.from([
      0xe0 | (value & 0x0f),
      (value >> 4) & 0xff,
      (value >> 12) & 0xff,
      (value >> 20) & 0xff,
    ]);
  }
  const b = Buffer.allocUnsafe(5);
  b[0] = 0xf0;
  b.writeUInt32LE(value >>> 0, 1);
  return b;
}

export const PART = {
  ONESIE_HEADER: 10,
  ONESIE_DATA: 11,
  ONESIE_ENCRYPTED_MEDIA: 12,
  MEDIA_HEADER: 20,
  MEDIA: 21,
  MEDIA_END: 22,
  LIVE_METADATA: 31,
  HOSTNAME_CHANGE_HINT: 32,
  LIVE_METADATA_PROMISE: 33,
  LIVE_METADATA_PROMISE_CANCELLATION: 34,
  NEXT_REQUEST_POLICY: 35,
  USTREAMER_VIDEO_AND_FORMAT_DATA: 36,
  FORMAT_SELECTION_CONFIG: 37,
  USTREAMER_SELECTED_MEDIA_STREAM: 38,
  FORMAT_INITIALIZATION_METADATA: 42,
  SABR_REDIRECT: 43,
  SABR_ERROR: 44,
  SABR_SEEK: 45,
  RELOAD_PLAYER_RESPONSE: 46,
  PLAYBACK_START_POLICY: 47,
  ALLOWED_CACHED_FORMATS: 48,
  START_BW_SAMPLING_HINT: 49,
  PAUSE_BW_SAMPLING_HINT: 50,
  SELECTABLE_FORMATS: 51,
  REQUEST_IDENTIFIER: 52,
  REQUEST_CANCELLATION_POLICY: 53,
  ONESIE_PREFETCH_REJECTION: 54,
  TIMELINE_CONTEXT: 55,
  REQUEST_PIPELINING: 56,
  SABR_CONTEXT_UPDATE: 57,
  STREAM_PROTECTION_STATUS: 58,
  SABR_CONTEXT_SENDING_POLICY: 59,
  LAWNMOWER_POLICY: 60,
  SABR_ACK: 61,
  END_OF_TRACK: 62,
  CACHE_LOAD_POLICY: 63,
  LAWNMOWER_MESSAGING_POLICY: 64,
  PREWARM_CONNECTION: 65,
  PLAYBACK_DEBUG_INFO: 66,
  SNACKBAR_MESSAGE: 67,
};

export const PART_NAMES = Object.fromEntries(
  Object.entries(PART).map(([name, id]) => [id, name]),
);

/**
 * Incremental UMP part splitter. Feed it chunks as they arrive off the wire;
 * it emits complete parts and keeps any trailing partial part buffered.
 */
export class UmpDemuxer {
  #buffer = Buffer.alloc(0);

  push(chunk) {
    this.#buffer =
      this.#buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.#buffer, chunk]);
    return this.#drain();
  }

  #drain() {
    const parts = [];
    let offset = 0;

    while (offset < this.#buffer.length) {
      let type;
      let size;
      try {
        const t = readVarint(this.#buffer, offset);
        const s = readVarint(this.#buffer, offset + t.size);
        type = t;
        size = s;
      } catch {
        break; // not enough bytes for the header yet
      }

      const headerLength = type.size + size.size;
      const total = headerLength + size.value;
      if (offset + total > this.#buffer.length) break; // payload incomplete

      parts.push({
        type: type.value,
        name: PART_NAMES[type.value] ?? `UNKNOWN_${type.value}`,
        payload: this.#buffer.subarray(offset + headerLength, offset + total),
      });
      offset += total;
    }

    if (offset > 0) this.#buffer = this.#buffer.subarray(offset);
    return parts;
  }

  get pending() {
    return this.#buffer.length;
  }
}

/** One-shot convenience wrapper for a fully buffered UMP response. */
export function parseUmp(buffer) {
  const demuxer = new UmpDemuxer();
  return demuxer.push(buffer);
}

/**
 * MEDIA and MEDIA_END payloads are prefixed with the header id they belong to.
 * The prefix is a UMP varint, not a single byte: assuming one byte silently
 * misroutes media into the wrong track once a session issues id >= 128.
 */
export function splitHeaderId(payload) {
  const { value, size } = readVarint(payload, 0);
  return { headerId: value, data: payload.subarray(size) };
}
