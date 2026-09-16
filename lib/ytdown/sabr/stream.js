import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { UmpDemuxer, PART, splitHeaderId } from '../proto/ump.js';
import {
  encodeVideoPlaybackAbrRequest,
  decodeMediaHeader,
  decodeFormatInitializationMetadata,
  decodeNextRequestPolicy,
  decodeSabrRedirect,
  decodeSabrError,
  decodeStreamProtectionStatus,
  decodeSabrContextUpdate,
  decodeSabrContextSendingPolicy,
  decodeReloadPlayerResponse,
  coldStartPoToken,
  formatKey,
  PROTECTION_STATUS,
  TRACK_TYPES,
  saturatedRange,
} from '../proto/sabr.js';
import { log, formatBytes } from '../util/logger.js';

const CPN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * How far to nudge the reported position when a round returns no media. The
 * server serves a window ahead of that position, so a small step is what
 * unsticks a stream whose readahead window has been exhausted.
 */
const IDLE_ADVANCE_MS = 5_000;

export function generateCpn() {
  let out = '';
  for (const b of crypto.randomBytes(16)) out += CPN_ALPHABET[b & 63];
  return out;
}

export class SabrError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'SabrError';
    this.detail = detail;
  }
}

/**
 * One media track being reassembled out of the UMP stream.
 *
 * Segments arrive as fragmented MP4 / WebM and only need concatenating in
 * sequence order — the init segment occupies slot 0, media segments start at 1.
 */
class TrackState {
  constructor(formatId, mimeType) {
    this.formatId = formatId;
    this.mimeType = mimeType ?? null;
    this.segments = new Map();
    this.totalSegments = null;
    this.durationMs = null;
    this.initialized = false;
    this.bytes = 0;
  }

  get key() {
    return formatKey(this.formatId);
  }

  get downloadedDurationMs() {
    let total = 0;
    for (const [index, seg] of this.segments) {
      if (index === 0) continue;
      total += seg.durationMs ?? 0;
    }
    return total;
  }

  get contiguousDurationMs() {
    let total = 0;
    for (let i = 1; ; i += 1) {
      const seg = this.segments.get(i);
      if (!seg) break;
      total += seg.durationMs ?? 0;
    }
    return total;
  }

  get complete() {
    if (this.totalSegments == null) return false;
    for (let i = 1; i <= this.totalSegments; i += 1) {
      if (!this.segments.has(i)) return false;
    }
    return this.segments.has(0);
  }

  /**
   * Concatenate the init segment plus every segment up to the first gap.
   *
   * Writing segments from beyond a gap would produce a file whose timeline jumps,
   * so a truncated-but-continuous result is preferred.
   */
  assemble() {
    const parts = [];
    if (this.segments.has(0)) parts.push(this.segments.get(0).data);
    for (let i = 1; ; i += 1) {
      const seg = this.segments.get(i);
      if (!seg) break;
      parts.push(seg.data);
    }
    return Buffer.concat(parts);
  }
}

/**
 * Drives a SABR session: POSTs VideoPlaybackAbrRequest, consumes the UMP part
 * stream, and loops until every track is complete.
 */
export class SabrStream {
  constructor({
    http,
    player,
    streamingUrl,
    ustreamerConfig,
    clientVersion,
    videoId,
    durationMs,
    audioFormat = null,
    videoFormat = null,
    availableAudioFormats = null,
    availableVideoFormats = null,
    poToken = null,
    playbackCookie = null,
    transport = null,
    onProgress = null,
  }) {
    this.http = http;
    this.player = player;
    this.transport = transport;
    this.streamingUrl = streamingUrl;
    this.ustreamerConfig = ustreamerConfig;
    this.clientVersion = clientVersion;
    this.videoId = videoId;
    this.durationMs = durationMs;
    this.audioFormat = audioFormat;
    this.videoFormat = videoFormat;
    this.availableAudioFormats = availableAudioFormats;
    this.availableVideoFormats = availableVideoFormats;
    this.poToken = poToken ?? coldStartPoToken(crypto.randomBytes(8));
    this.onProgress = onProgress;

    this.cpn = generateCpn();
    this.requestNumber = 0;
    this.startedAt = Date.now();
    // Continuing an exported session means starting from its cookie rather than
    // waiting for the server to issue a fresh one.
    this.playbackCookie = playbackCookie;
    this.sabrContexts = new Map();
    this.activeContextTypes = new Set();
    this.tracks = new Map();
    this.playerTimeMs = 0;
    this.protectionStatus = null;
    this.stoppedReason = null;
    this.reloadToken = null;
  }

  get enabledTrackTypes() {
    if (this.audioFormat && this.videoFormat) return TRACK_TYPES.VIDEO_AND_AUDIO;
    return this.audioFormat ? TRACK_TYPES.AUDIO_ONLY : TRACK_TYPES.VIDEO_ONLY;
  }

  /** Build the request URL: pass every signed param through untouched, transform `n`, bump `rn`. */
  #buildUrl() {
    const url = new URL(this.streamingUrl);

    // An untransformed throttling-deterrent parameter is rejected outright with
    // a bare 403 on SABR endpoints, so this is load bearing. A url exported from
    // a live session already carries a transformed value and needs no player.
    const n = url.searchParams.get('n');
    if (n && this.player) {
      const fixed = this.player.transformN(n);
      if (fixed && fixed !== n) url.searchParams.set('n', fixed);
    }

    this.requestNumber += 1;
    url.searchParams.set('rn', String(this.requestNumber));
    // An exported url already identifies its own playback session; overwriting
    // cpn would present it as a different client.
    if (!url.searchParams.has('cpn')) url.searchParams.set('cpn', this.cpn);
    url.searchParams.set('cver', this.clientVersion);
    url.searchParams.set('alr', 'yes');
    return url.toString();
  }

  /**
   * Tell the server what we already hold.
   *
   * The server keeps no per-client progress state: it decides what to send
   * next purely from these ranges, so they must describe the FULL accumulated
   * buffer, not the delta since the last request. Reporting only the delta
   * makes the second request look like a fresh session that has somehow
   * already advanced its clock, and the server stops sending anything.
   *
   * A gap that is not reported is a gap that never gets filled, so each
   * contiguous run of sequence numbers is emitted as its own range.
   */
  #buildBufferedRanges() {
    const ranges = [];

    for (const track of this.tracks.values()) {
      if (!track.initialized) continue;

      const indices = [...track.segments.keys()]
        .filter((i) => i !== 0) // slot 0 is the init segment, not a time range
        .sort((a, b) => a - b);
      if (indices.length === 0) continue;

      let run = null;
      for (const index of indices) {
        const seg = track.segments.get(index);
        if (run && index === run.endSegmentIndex + 1) {
          run.endSegmentIndex = index;
          run.durationMs += seg.durationMs ?? 0;
          continue;
        }
        if (run) ranges.push(run);
        run = {
          formatId: track.formatId,
          startTimeMs: seg.startMs ?? 0,
          durationMs: seg.durationMs ?? 0,
          startSegmentIndex: index,
          endSegmentIndex: index,
        };
      }
      if (run) ranges.push(run);
    }

    return ranges;
  }

  #buildBody(bufferedRanges) {
    // xtags disambiguates itags that appear more than once (DRC / alternate
    // mixes). Omitting it yields sabr.no_audio_selected.
    const toFormatId = (f) => ({
      itag: f.itag,
      lastModified: f.lastModified,
      xtags: f.xtags ?? null,
    });

    /*
     * The player advertises a ladder and lets the server choose, and the server
     * genuinely does switch mid-stream — a capture of a full-length session
     * shows it starting on itag 396 and moving to 397 at segment 5, after which
     * 396 has no further segments at all. Pinning a single rendition therefore
     * caps the download at the switch point: we would keep asking for segments
     * that this session will never produce.
     *
     * So the ladder is advertised, filtered to renditions that are acceptable
     * substitutes, and whatever the server settles on is what gets assembled.
     */
    const acceptableVideo = (this.availableVideoFormats ?? []).filter(
      (f) => (f.height ?? 0) <= (this.videoFormat?.height ?? Infinity),
    );
    const acceptableAudio = (this.availableAudioFormats ?? []).filter(
      (f) => (f.audioChannels ?? 2) <= (this.audioFormat?.audioChannels ?? 2),
    );

    const audioIds = this.audioFormat
      ? (acceptableAudio.length ? acceptableAudio : [this.audioFormat]).map(toFormatId)
      : [];

    const videoIds = this.videoFormat
      ? (acceptableVideo.length ? acceptableVideo : [this.videoFormat]).map(toFormatId)
      : [];

    // Only claim a format is initialized once its init segment is in hand. If
    // a retry happens before that, the server will not resend it and the track
    // ends up permanently unplayable.
    const selectedFormatIds = [...this.tracks.values()]
      .filter((t) => t.initialized && t.segments.has(0))
      .map((t) => t.formatId);

    return encodeVideoPlaybackAbrRequest({
      clientAbrState: {
        playerTimeMs: this.playerTimeMs,
        elapsedWallTimeMs: Date.now() - this.startedAt,
        enabledTrackTypes: this.enabledTrackTypes,
        playerWidth: 1920,
        playerHeight: 1080,
        maxHeight: this.videoFormat?.height ?? 1080,
      },
      selectedFormatIds,
      audioFormatIds: audioIds,
      videoFormatIds: videoIds,
      ustreamerConfig: this.ustreamerConfig,
      clientVersion: this.clientVersion,
      poToken: this.poToken,
      playbackCookie: this.playbackCookie,
      sabrContexts: [...this.activeContextTypes]
        .map((type) => this.sabrContexts.get(type))
        .filter(Boolean)
        .map((c) => ({ type: c.type, value: c.value })),
      unsentSabrContexts: [...this.sabrContexts.keys()].filter(
        (t) => !this.activeContextTypes.has(t),
      ),
      bufferedRanges,
    });
  }

  async #post(body) {
    const url = this.#buildUrl();

    // When a transport is supplied the POST is issued from inside an attested
    // browser page; otherwise it goes straight out over plain HTTP.
    if (this.transport) {
      const { status, buffer } = await this.transport.post(url, body);
      if (status !== 200) {
        throw new SabrError(`transport returned HTTP ${status}`, { status });
      }
      return { status, stream: Readable.from([buffer]) };
    }

    return this.http.request(url, {
      method: 'POST',
      body,
      headers: {
        'content-type': 'application/x-protobuf',
        accept: 'application/vnd.yt-ump',
        // Incremental UMP parsing breaks if the transport re-frames the body.
        'accept-encoding': 'identity',
        origin: 'https://www.youtube.com',
        referer: 'https://www.youtube.com/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
      },
      expect: [200],
      retries: 3,
    });
  }

  /** Consume one response's part stream, mutating track state. */
  async #consume(res) {
    const demuxer = new UmpDemuxer();
    // headerId is per-response and recycled, so this map must not outlive it.
    const pending = new Map();
    let sawMedia = false;
    let redirected = null;
    let backoffMs = 0;

    const handle = (part) => {
      switch (part.type) {
        case PART.FORMAT_INITIALIZATION_METADATA: {
          const meta = decodeFormatInitializationMetadata(part.payload);
          if (!meta.formatId) break;
          const key = formatKey(meta.formatId);
          let track = this.tracks.get(key);
          if (!track) {
            track = new TrackState(meta.formatId, meta.mimeType);
            this.tracks.set(key, track);
          }
          track.mimeType ??= meta.mimeType;
          track.totalSegments = meta.endSegmentNumber ?? track.totalSegments;
          if (meta.durationUnits && meta.durationTimescale) {
            track.durationMs = Math.trunc(meta.durationUnits / (meta.durationTimescale / 1000));
          }
          track.initialized = true;
          log.debug(
            `format init itag=${meta.formatId.itag} mime=${meta.mimeType} segments=${meta.endSegmentNumber}`,
          );
          break;
        }

        case PART.MEDIA_HEADER: {
          const header = decodeMediaHeader(part.payload);
          if (header.compressionAlgorithm) {
            throw new SabrError(
              `unsupported segment compression ${header.compressionAlgorithm}`,
              header,
            );
          }
          const key = formatKey(header.formatId);
          let track = this.tracks.get(key);
          if (!track) {
            track = new TrackState(header.formatId, null);
            this.tracks.set(key, track);
          }
          const index = header.isInitSeg ? 0 : (header.sequenceNumber ?? 1);
          if (track.segments.has(index)) break; // server re-sent; ignore
          pending.set(header.headerId, { track, index, header, chunks: [], received: 0 });
          break;
        }

        case PART.MEDIA: {
          sawMedia = true;
          const { headerId, data } = splitHeaderId(part.payload);
          const entry = pending.get(headerId);
          if (!entry) break;
          entry.chunks.push(Buffer.from(data));
          entry.received += data.length;
          break;
        }

        case PART.MEDIA_END: {
          const { headerId } = splitHeaderId(part.payload);
          const entry = pending.get(headerId);
          if (!entry) break;
          pending.delete(headerId);

          const expected = entry.header.contentLength;
          if (expected != null && entry.received !== expected) {
            log.warn(
              `discarding segment itag=${entry.header.itag} seq=${entry.index}: got ${entry.received} of ${expected} bytes`,
            );
            break;
          }

          const data = Buffer.concat(entry.chunks);
          entry.track.segments.set(entry.index, {
            data,
            durationMs: entry.header.durationMs ?? 0,
            startMs: entry.header.startMs ?? 0,
          });
          entry.track.bytes += data.length;
          break;
        }

        case PART.NEXT_REQUEST_POLICY: {
          const policy = decodeNextRequestPolicy(part.payload);
          if (policy.playbackCookie) this.playbackCookie = policy.playbackCookie;
          if (policy.backoffTimeMs) backoffMs = Math.max(backoffMs, policy.backoffTimeMs);
          break;
        }

        case PART.SABR_REDIRECT: {
          const { url } = decodeSabrRedirect(part.payload);
          if (url) redirected = url;
          break;
        }

        case PART.SABR_ERROR: {
          const err = decodeSabrError(part.payload);
          throw new SabrError(`server reported ${err.type ?? 'error'} (${err.code})`, err);
        }

        case PART.STREAM_PROTECTION_STATUS: {
          const { status } = decodeStreamProtectionStatus(part.payload);
          this.protectionStatus = status;
          // Status 2 accompanies healthy sessions and 3 means the server will
          // send no more media. Neither is worth aborting on mid-response: the
          // loop notices the absence of media and returns what it has.
          break;
        }

        case PART.SABR_CONTEXT_UPDATE: {
          const update = decodeSabrContextUpdate(part.payload);
          if (update.type == null || !update.value) break;
          const existing = this.sabrContexts.get(update.type);
          // writePolicy 2 = KEEP_EXISTING
          if (existing && update.writePolicy === 2) break;
          this.sabrContexts.set(update.type, update);
          if (update.sendByDefault) this.activeContextTypes.add(update.type);
          break;
        }

        case PART.SABR_CONTEXT_SENDING_POLICY: {
          const policy = decodeSabrContextSendingPolicy(part.payload);
          for (const t of policy.start) this.activeContextTypes.add(t);
          for (const t of policy.stop) this.activeContextTypes.delete(t);
          for (const t of policy.discard) {
            this.activeContextTypes.delete(t);
            this.sabrContexts.delete(t);
          }
          break;
        }

        case PART.RELOAD_PLAYER_RESPONSE: {
          this.reloadToken = decodeReloadPlayerResponse(part.payload).token;
          throw new SabrError('server asked the client to reload the player response', {
            token: this.reloadToken,
          });
        }

        default:
          break; // unknown part types are skipped by design
      }
    };

    for await (const chunk of res.stream) {
      for (const part of demuxer.push(chunk)) handle(part);
    }

    return { sawMedia, redirected, backoffMs };
  }

  /** Run the session to completion and return the assembled tracks. */
  async download({ maxRequests = 2000 } = {}) {
    let idleRounds = 0;

    for (let i = 0; i < maxRequests; i += 1) {
      const ranges = this.#buildBufferedRanges();
      const body = this.#buildBody(ranges);
      const res = await this.#post(body);
      const { sawMedia, redirected, backoffMs } = await this.#consume(res);

      if (redirected) {
        log.debug('following SABR redirect');
        this.streamingUrl = redirected;
      }

      // How far each kind is filled, across whatever renditions the server used.
      const kinds = [...this.#kinds()];
      const bufferedMs = kinds.length
        ? Math.min(...kinds.map((k) => this.#coverageMs(k)))
        : 0;

      /*
       * The server serves a readahead window ahead of the reported position, so
       * the position is what drives the download forward. Sitting behind the
       * buffered edge stalls once the window is full: the client looks like a
       * player that has stopped consuming. Reporting the leading edge — and
       * nudging past it when a round brings nothing — keeps the window sliding.
       */
      this.playerTimeMs = Math.max(this.playerTimeMs, bufferedMs);
      if (!sawMedia) this.playerTimeMs += IDLE_ADVANCE_MS;

      const totalBytes = [...this.tracks.values()].reduce((n, t) => n + t.bytes, 0);
      this.onProgress?.({
        playerTimeMs: this.playerTimeMs,
        bufferedMs,
        durationMs: this.durationMs,
        bytes: totalBytes,
        tracks: this.tracks.size,
      });

      const done = this.#allComplete();
      log.debug(
        `round ${this.requestNumber}: media=${sawMedia} prot=${this.protectionStatus} ` +
          `pos=${this.playerTimeMs}ms buffered=${bufferedMs}ms bytes=${totalBytes} done=${done}`,
      );
      if (done) {
        log.debug(`sabr complete after ${this.requestNumber} requests, ${formatBytes(totalBytes)}`);
        break;
      }

      if (!sawMedia && !redirected) {
        idleRounds += 1;

        /*
         * A rendition can simply run out: the server switches mid-stream, and
         * once it has moved on it will not serve further segments of the old
         * one. The player handles this by following the switch, so when a round
         * comes back empty we step to the next acceptable rendition and ask
         * again before concluding the stream is over.
         */
        if (idleRounds === 2 && this.#switchRendition()) {
          idleRounds = 0;
          continue;
        }

        if (idleRounds >= 6) {
          this.stoppedReason =
            this.protectionStatus === PROTECTION_STATUS.ATTESTATION_REQUIRED
              ? 'attestation required'
              : 'server stopped sending media';
          log.debug(`sabr halted: ${this.stoppedReason}`);
          break;
        }
      } else {
        idleRounds = 0;
      }

      if (backoffMs) await delay(Math.min(backoffMs, 5_000));
    }

    if (!this.#allComplete()) {
      log.warn('sabr session ended with incomplete tracks');
    }

    return this.#results();
  }

  /**
   * Total contiguous media held for one kind, across renditions.
   *
   * The server switches rendition mid-stream, so a single track covers only part
   * of the timeline. Coverage is measured over the union of every track of that
   * kind: segments are globally numbered, so a switch continues the sequence
   * rather than restarting it.
   */
  #coverageMs(kind) {
    const segments = new Map();
    for (const track of this.tracks.values()) {
      if (!track.initialized) continue;
      const trackKind = track.mimeType?.includes('video') ? 'video' : 'audio';
      if (trackKind !== kind) continue;
      for (const [index, seg] of track.segments) {
        if (index === 0) continue;
        if (!segments.has(index)) segments.set(index, seg);
      }
    }

    let total = 0;
    for (let i = 1; ; i += 1) {
      const seg = segments.get(i);
      if (!seg) break;
      total += seg.durationMs ?? 0;
    }
    return total;
  }

  #kinds() {
    const kinds = new Set();
    for (const track of this.tracks.values()) {
      if (!track.initialized) continue;
      kinds.add(track.mimeType?.includes('video') ? 'video' : 'audio');
    }
    return kinds;
  }

  #allComplete() {
    const kinds = this.#kinds();
    const wanted = (this.audioFormat ? 1 : 0) + (this.videoFormat ? 1 : 0);
    if (kinds.size < wanted) return false;
    if (!this.durationMs) return false;

    // Complete when every requested kind covers the whole timeline.
    for (const kind of kinds) {
      if (this.#coverageMs(kind) < this.durationMs - 2000) return false;
    }
    return true;
  }

  /**
   * Move to the next acceptable rendition of whichever kind has fallen behind.
   *
   * Returns true when a switch was made, so the caller can retry rather than
   * treating an exhausted rendition as the end of the stream.
   */
  #switchRendition() {
    const videoCoverage = this.videoFormat ? this.#coverageMs('video') : Infinity;
    const audioCoverage = this.audioFormat ? this.#coverageMs('audio') : Infinity;
    const kind = videoCoverage <= audioCoverage ? 'video' : 'audio';

    const current = kind === 'video' ? this.videoFormat : this.audioFormat;
    const pool = kind === 'video' ? this.availableVideoFormats : this.availableAudioFormats;
    if (!current || !pool?.length) return false;

    this.exhausted ??= new Set();
    this.exhausted.add(`${current.itag}:${current.xtags ?? ''}`);

    const candidates = pool
      .filter((f) => !this.exhausted.has(`${f.itag}:${f.xtags ?? ''}`))
      .filter((f) =>
        kind === 'video'
          ? (f.height ?? 0) <= (current.height ?? Infinity)
          : (f.audioChannels ?? 2) <= (current.audioChannels ?? 2),
      )
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

    const next = candidates[0];
    if (!next) return false;

    log.debug(`switching ${kind} rendition ${current.itag} -> ${next.itag}`);
    if (kind === 'video') this.videoFormat = next;
    else this.audioFormat = next;
    return true;
  }

  #results() {
    const wantAudio = Boolean(this.audioFormat);
    const wantVideo = Boolean(this.videoFormat);

    /*
     * Merge each kind across renditions. The server switches rendition
     * mid-stream and segment numbering continues across the switch, so the
     * timeline is the union of every track of that kind. Mixing codecs inside
     * one file would be unplayable, so the dominant rendition supplies the init
     * segment and any stray segments from a different codec are dropped.
     */
    const byKind = new Map();
    for (const track of this.tracks.values()) {
      if (!track.initialized || track.segments.size === 0) continue;
      const kind = track.mimeType?.includes('video') ? 'video' : 'audio';
      if (kind === 'audio' && !wantAudio) continue;
      if (kind === 'video' && !wantVideo) continue;
      const bucket = byKind.get(kind) ?? [];
      bucket.push(track);
      byKind.set(kind, bucket);
    }

    const out = [];
    for (const [kind, tracks] of byKind) {
      // Renditions of one codec family can be concatenated; pick the family
      // that carries the most media and use only those.
      const byCodec = new Map();
      for (const t of tracks) {
        const codec = (/codecs="([^".]+)/.exec(t.mimeType ?? '')?.[1] ?? 'unknown').toLowerCase();
        const bucket = byCodec.get(codec) ?? [];
        bucket.push(t);
        byCodec.set(codec, bucket);
      }

      let chosen = null;
      let chosenBytes = -1;
      for (const bucket of byCodec.values()) {
        const bytes = bucket.reduce((n, t) => n + t.bytes, 0);
        if (bytes > chosenBytes) {
          chosenBytes = bytes;
          chosen = bucket;
        }
      }
      if (!chosen?.length) continue;

      // Prefer the rendition that contributed most for the init segment.
      const primary = [...chosen].sort((a, b) => b.bytes - a.bytes)[0];
      const merged = new Map();
      for (const t of chosen) {
        for (const [index, seg] of t.segments) {
          if (index === 0) continue;
          if (!merged.has(index)) merged.set(index, seg);
        }
      }

      const parts = [];
      if (primary.segments.has(0)) parts.push(primary.segments.get(0).data);
      let durationMs = 0;
      let last = 0;
      for (let i = 1; ; i += 1) {
        const seg = merged.get(i);
        if (!seg) break;
        parts.push(seg.data);
        durationMs += seg.durationMs ?? 0;
        last = i;
      }

      const totalSegments = Math.max(0, ...chosen.map((t) => t.totalSegments ?? 0));
      const missing = [];
      for (let i = last + 1; i <= totalSegments; i += 1) missing.push(i);

      out.push({
        formatId: primary.formatId,
        mimeType: primary.mimeType,
        kind,
        data: Buffer.concat(parts),
        bytes: parts.reduce((n, p) => n + p.length, 0),
        durationMs,
        segments: last + (primary.segments.has(0) ? 1 : 0),
        missing,
      });
    }

    return out;
  }
}
