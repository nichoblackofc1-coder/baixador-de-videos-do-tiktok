import { Buffer } from 'node:buffer';
import { Reader, Writer, WIRE } from './wire.js';

/**
 * SABR (Server-side Adaptive BitRate) message definitions.
 *
 * Field numbers were recovered by decoding a real Chrome POST to
 * serverAbrStreamingUrl captured off www.youtube.com, then cross-checked
 * against two independent reimplementations of the protocol. Anything marked
 * "observed" appeared verbatim in the captured request.
 */

/* ------------------------------------------------------------------ *
 * FormatId — { 1: itag, 2: lastModified, 3: xtags }
 * ------------------------------------------------------------------ */

export function encodeFormatId(writer, field, format) {
  return writer.message(field, (m) => {
    m.uint(1, format.itag);
    if (format.lastModified != null) m.uint(2, BigInt(format.lastModified));
    if (format.xtags) m.string(3, format.xtags);
  });
}

export function decodeFormatId(buf) {
  const r = new Reader(buf);
  const out = { itag: 0, lastModified: null, xtags: null };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.VARINT) out.itag = Number(r.varint());
    else if (field === 2 && wire === WIRE.VARINT) out.lastModified = r.varint().toString();
    else if (field === 3 && wire === WIRE.LENGTH) out.xtags = r.bytes().toString('utf8');
    else r.skip(wire);
  }
  return out;
}

/** Formats are identified by itag + xtags; lastModified is not part of identity. */
export function formatKey(id) {
  return `${id?.itag ?? 0}:${id?.xtags ?? ''}`;
}

/* ------------------------------------------------------------------ *
 * ClientAbrState (request field 1)
 * ------------------------------------------------------------------ */

export const TRACK_TYPES = {
  VIDEO_AND_AUDIO: 0,
  AUDIO_ONLY: 1,
  VIDEO_ONLY: 2,
};

/**
 * ClientAbrState (request field 1).
 *
 *   18 clientViewportWidth   19 clientViewportHeight
 *   21 stickyResolution      23 bandwidthEstimate (bytes/sec)
 *   28 playerTimeMs   <-- playback position; the ONLY field that carries it
 *   29 timeSinceLastSeek     34 visibility
 *   36 elapsedWallTimeMs     39 timeSinceLastActionMs
 *   46 drcEnabled            57 enabledTrackTypes
 *   58 preferVp9             59 av1QualityThreshold
 *   76 enableVoiceBoost
 *
 * Field 28 was originally implemented as 36, which is a wall clock rather than a
 * position. The failure mode is silent and looks nothing like a wire bug: the
 * server answers 200 with a valid UMP stream, delivers exactly one readahead
 * window (~20s) from position zero, then returns no MEDIA parts forever, because
 * `position + readahead - buffered` never becomes positive.
 *
 * Note `media_capabilities` (field 38) is deliberately NOT sent: on WEB clients
 * supplying it makes the server ignore the preferred format ids.
 */
export function encodeClientAbrState(writer, field, state) {
  return writer.message(field, (m) => {
    m.uint(18, state.playerWidth ?? 1920);
    m.uint(19, state.playerHeight ?? 1080);
    m.uint(21, 0);
    if (state.bandwidthEstimate) m.uint(23, Math.trunc(state.bandwidthEstimate));
    m.uint(28, Math.max(0, Math.trunc(state.playerTimeMs ?? 0)));
    m.uint(34, 0);
    if (state.elapsedWallTimeMs) m.uint(36, Math.trunc(state.elapsedWallTimeMs));
    m.uint(46, state.drcEnabled ? 1 : 0);
    m.uint(57, state.enabledTrackTypes ?? 0);
    m.uint(58, 0);
    if (state.maxHeight) m.uint(59, state.maxHeight);
    m.uint(76, 0);
  });
}

/* ------------------------------------------------------------------ *
 * BufferedRange (request field 3, repeated)
 * ------------------------------------------------------------------ */

/**
 * BufferedRange (request field 3, repeated).
 *
 * The captured browser loop sends exactly fields 1-5 and omits the optional
 * TimeRange at field 6, so we match that shape.
 */
export function encodeBufferedRange(writer, field, range) {
  return writer.message(field, (m) => {
    encodeFormatId(m, 1, range.formatId);
    m.uint(2, Math.trunc(range.startTimeMs ?? 0));
    m.uint(3, Math.trunc(range.durationMs ?? 0));
    m.uint(4, Math.trunc(range.startSegmentIndex ?? 1));
    m.uint(5, Math.trunc(range.endSegmentIndex ?? 1));
  });
}

/** A range wide enough that the server treats the track as fully buffered. */
export const SATURATED_RANGE_VALUE = 2147483647;

export function saturatedRange(formatId) {
  return {
    formatId,
    startTimeMs: 0,
    durationMs: SATURATED_RANGE_VALUE,
    startSegmentIndex: SATURATED_RANGE_VALUE,
    endSegmentIndex: SATURATED_RANGE_VALUE,
  };
}

/**
 * The browser's first SABR request carries a 10 byte "cold start" token in
 * StreamerContext field 2, before BotGuard has produced a real one. Decoding a
 * captured one shows it is simply `{ 4: <8 random bytes> }` — no attestation
 * material, so we can mint an equivalent locally.
 */
export function coldStartPoToken(randomBytes) {
  const w = new Writer();
  w.bytes(4, randomBytes);
  return w.finish();
}

/* ------------------------------------------------------------------ *
 * StreamerContext (request field 19)
 * ------------------------------------------------------------------ */

/**
 * ClientInfo: 1 locale, 16 clientName (WEB = 1), 17 clientVersion,
 * 18 osName, 19 osVersion.
 *
 * The captured request sends exactly these five and no visitorData — the
 * session identity travels in the signed URL, not the body.
 */
function encodeClientInfo(writer, field, info) {
  return writer.message(field, (m) => {
    m.string(1, info.locale ?? 'en_US');
    m.uint(16, 1);
    m.string(17, info.clientVersion ?? '');
    m.string(18, 'Windows');
    m.string(19, '10.0');
  });
}

function encodeStreamerContext(writer, field, ctx) {
  return writer.message(field, (m) => {
    encodeClientInfo(m, 1, ctx);
    if (ctx.poToken) m.bytes(2, ctx.poToken);
    if (ctx.playbackCookie) m.bytes(3, ctx.playbackCookie);
    for (const sc of ctx.sabrContexts ?? []) {
      m.message(5, (s) => {
        s.uint(1, sc.type);
        s.bytes(2, sc.value);
      });
    }
    for (const type of ctx.unsentSabrContexts ?? []) m.uint(6, type);
  });
}

/* ------------------------------------------------------------------ *
 * VideoPlaybackAbrRequest — the POST body
 *
 * Field numbers were read off a real Chrome buffering loop (8 consecutive
 * requests captured from www.youtube.com) and confirmed by replaying them:
 *
 *   1  ClientAbrState
 *   2  selectedFormatIds (repeated FormatId) — formats already initialized.
 *      Absent on the first request; present from the second onwards.
 *   3  bufferedRanges (repeated BufferedRange)
 *   5  videoPlaybackUstreamerConfig (raw bytes, base64-decoded)
 *   16 audioFormatIds (repeated FormatId)
 *   17 videoFormatIds (repeated FormatId)
 *   19 StreamerContext
 * ------------------------------------------------------------------ */

export function encodeVideoPlaybackAbrRequest(request) {
  const w = new Writer();

  encodeClientAbrState(w, 1, request.clientAbrState ?? {});

  // Declaring a format as initialized stops the server re-sending its init
  // segment, so this must stay empty until that segment has actually arrived.
  for (const f of request.selectedFormatIds ?? []) encodeFormatId(w, 2, f);
  for (const range of request.bufferedRanges ?? []) encodeBufferedRange(w, 3, range);

  if (request.ustreamerConfig) {
    const raw = Buffer.isBuffer(request.ustreamerConfig)
      ? request.ustreamerConfig
      : Buffer.from(request.ustreamerConfig, 'base64');
    w.bytes(5, raw);
  }

  for (const f of request.audioFormatIds ?? []) encodeFormatId(w, 16, f);
  for (const f of request.videoFormatIds ?? []) encodeFormatId(w, 17, f);

  encodeStreamerContext(w, 19, {
    locale: request.locale,
    visitorData: request.visitorData,
    clientVersion: request.clientVersion,
    poToken: request.poToken,
    playbackCookie: request.playbackCookie,
    sabrContexts: request.sabrContexts,
    unsentSabrContexts: request.unsentSabrContexts,
  });

  return w.finish();
}

/* ------------------------------------------------------------------ *
 * Response messages
 * ------------------------------------------------------------------ */

/**
 * MediaHeader (UMP part 20).
 *  1 headerId, 2 videoId, 3 itag, 4 lmt, 5 xtags, 6 startRange,
 *  7 compressionAlgorithm, 8 isInitSeg, 9 sequenceNumber, 10 bitrateBps,
 *  11 startMs, 12 durationMs, 13 formatId, 14 contentLength, 15 timeRange
 */
export function decodeMediaHeader(buf) {
  const r = new Reader(buf);
  const out = {
    headerId: 0,
    videoId: null,
    itag: 0,
    lastModified: null,
    xtags: null,
    startRange: 0,
    compressionAlgorithm: 0,
    isInitSeg: false,
    sequenceNumber: null,
    bitrateBps: null,
    startMs: 0,
    durationMs: null,
    formatId: null,
    contentLength: null,
    timeRange: null,
  };

  for (const { field, wire } of r.tags()) {
    switch (field) {
      case 1: out.headerId = Number(r.varint()); break;
      case 2: out.videoId = r.bytes().toString('utf8'); break;
      case 3: out.itag = Number(r.varint()); break;
      case 4: out.lastModified = r.varint().toString(); break;
      case 5: out.xtags = r.bytes().toString('utf8'); break;
      case 6: out.startRange = Number(r.varint()); break;
      case 7: out.compressionAlgorithm = Number(r.varint()); break;
      case 8: out.isInitSeg = Number(r.varint()) === 1; break;
      case 9: out.sequenceNumber = Number(r.varint()); break;
      case 10: out.bitrateBps = Number(r.varint()); break;
      case 11: out.startMs = Number(r.varint()); break;
      case 12: out.durationMs = Number(r.varint()); break;
      case 13: out.formatId = decodeFormatId(r.bytes()); break;
      case 14: out.contentLength = Number(r.varint()); break;
      case 15: out.timeRange = decodeTimeRange(r.bytes()); break;
      default: r.skip(wire);
    }
  }

  if (!out.formatId) {
    out.formatId = { itag: out.itag, lastModified: out.lastModified, xtags: out.xtags };
  }
  // durationMs is frequently omitted; derive it from the tick range instead.
  if (out.durationMs == null && out.timeRange?.timescale) {
    out.durationMs = Math.ceil((out.timeRange.duration / out.timeRange.timescale) * 1000);
  }
  out.durationMs ??= 0;

  return out;
}

function decodeTimeRange(buf) {
  const r = new Reader(buf);
  const out = { start: 0, duration: 0, timescale: 1000 };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.VARINT) out.start = Number(r.varint());
    else if (field === 2 && wire === WIRE.VARINT) out.duration = Number(r.varint());
    else if (field === 3 && wire === WIRE.VARINT) out.timescale = Number(r.varint());
    else r.skip(wire);
  }
  return out;
}

/** FormatInitializationMetadata (UMP part 42). */
export function decodeFormatInitializationMetadata(buf) {
  const r = new Reader(buf);
  const out = {
    videoId: null,
    formatId: null,
    endTimeMs: null,
    endSegmentNumber: null,
    mimeType: null,
    initRange: null,
    indexRange: null,
    durationUnits: null,
    durationTimescale: null,
  };
  for (const { field, wire } of r.tags()) {
    switch (field) {
      case 1: out.videoId = r.bytes().toString('utf8'); break;
      case 2: out.formatId = decodeFormatId(r.bytes()); break;
      case 3: out.endTimeMs = Number(r.varint()); break;
      case 4: out.endSegmentNumber = Number(r.varint()); break;
      case 5: out.mimeType = r.bytes().toString('utf8'); break;
      case 6: out.initRange = decodeRange(r.bytes()); break;
      case 7: out.indexRange = decodeRange(r.bytes()); break;
      case 9: out.durationUnits = Number(r.varint()); break;
      case 10: out.durationTimescale = Number(r.varint()); break;
      default: r.skip(wire);
    }
  }
  return out;
}

function decodeRange(buf) {
  const r = new Reader(buf);
  const out = { start: 0, end: 0 };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.VARINT) out.start = Number(r.varint());
    else if (field === 2 && wire === WIRE.VARINT) out.end = Number(r.varint());
    else if (field === 3 && wire === WIRE.VARINT) out.start = Number(r.varint());
    else if (field === 4 && wire === WIRE.VARINT) out.end = Number(r.varint());
    else r.skip(wire);
  }
  return out;
}

/** NextRequestPolicy (UMP part 35). playbackCookie must be echoed back verbatim. */
export function decodeNextRequestPolicy(buf) {
  const r = new Reader(buf);
  const out = {
    targetAudioReadaheadMs: null,
    targetVideoReadaheadMs: null,
    maxTimeSinceLastRequestMs: null,
    backoffTimeMs: null,
    playbackCookie: null,
    videoId: null,
  };
  for (const { field, wire } of r.tags()) {
    switch (field) {
      case 1: out.targetAudioReadaheadMs = Number(r.varint()); break;
      case 2: out.targetVideoReadaheadMs = Number(r.varint()); break;
      case 3: out.maxTimeSinceLastRequestMs = Number(r.varint()); break;
      case 4: out.backoffTimeMs = Number(r.varint()); break;
      case 7: out.playbackCookie = Buffer.from(r.bytes()); break;
      case 8: out.videoId = r.bytes().toString('utf8'); break;
      default: r.skip(wire);
    }
  }
  return out;
}

export function decodeSabrRedirect(buf) {
  const r = new Reader(buf);
  let url = null;
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.LENGTH) url = r.bytes().toString('utf8');
    else r.skip(wire);
  }
  return { url };
}

export function decodeSabrError(buf) {
  const r = new Reader(buf);
  const out = { type: null, code: null };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.LENGTH) out.type = r.bytes().toString('utf8');
    else if (field === 2 && wire === WIRE.VARINT) out.code = Number(r.varint());
    else r.skip(wire);
  }
  return out;
}

export const PROTECTION_STATUS = {
  OK: 1,
  ATTESTATION_PENDING: 2,
  ATTESTATION_REQUIRED: 3,
};

export function decodeStreamProtectionStatus(buf) {
  const r = new Reader(buf);
  const out = { status: null, maxRetries: null };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.VARINT) out.status = Number(r.varint());
    else if (field === 2 && wire === WIRE.VARINT) out.maxRetries = Number(r.varint());
    else r.skip(wire);
  }
  return out;
}

export function decodeSabrContextUpdate(buf) {
  const r = new Reader(buf);
  const out = { type: null, scope: null, value: null, sendByDefault: false, writePolicy: 0 };
  for (const { field, wire } of r.tags()) {
    switch (field) {
      case 1: out.type = Number(r.varint()); break;
      case 2: out.scope = Number(r.varint()); break;
      case 3: out.value = Buffer.from(r.bytes()); break;
      case 4: out.sendByDefault = Number(r.varint()) === 1; break;
      case 5: out.writePolicy = Number(r.varint()); break;
      default: r.skip(wire);
    }
  }
  return out;
}

export function decodeSabrContextSendingPolicy(buf) {
  const r = new Reader(buf);
  const out = { start: [], stop: [], discard: [] };
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.VARINT) out.start.push(Number(r.varint()));
    else if (field === 2 && wire === WIRE.VARINT) out.stop.push(Number(r.varint()));
    else if (field === 3 && wire === WIRE.VARINT) out.discard.push(Number(r.varint()));
    else r.skip(wire);
  }
  return out;
}

/** ReloadPlayerResponse (UMP part 46) — carries the token to re-issue /player. */
export function decodeReloadPlayerResponse(buf) {
  const r = new Reader(buf);
  let token = null;
  for (const { field, wire } of r.tags()) {
    if (field === 1 && wire === WIRE.LENGTH) {
      const inner = new Reader(r.bytes());
      for (const t of inner.tags()) {
        if (t.field === 1 && t.wire === WIRE.LENGTH) token = inner.bytes().toString('utf8');
        else inner.skip(t.wire);
      }
    } else r.skip(wire);
  }
  return { token };
}
