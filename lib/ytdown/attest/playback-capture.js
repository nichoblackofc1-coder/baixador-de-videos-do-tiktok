import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';

import { Browser } from './cdp.js';
import { UmpDemuxer, PART, splitHeaderId } from '../proto/ump.js';
import { decodeMediaHeader, decodeFormatInitializationMetadata, formatKey } from '../proto/sabr.js';
import { log, formatBytes } from '../util/logger.js';

/**
 * Playback capture.
 *
 * Driving the SABR loop ourselves — even from inside an attested page — stops
 * after about a minute of media. A page playing normally does not: the same
 * browser, left to run its own player, streams a full-length video end to end.
 *
 * So instead of asking for the media, we let the player fetch it and keep a copy.
 * The page's `fetch` is wrapped before any of its own script runs, every
 * videoplayback response is mirrored, and the UMP stream is demuxed here into
 * the same per-track segment map the direct downloader produces.
 *
 * Playback is run at an elevated rate so a ten minute video takes well under a
 * minute of wall time.
 */
export class PlaybackCapture {
  #browser = null;
  #page = null;

  constructor({ videoId, headless = false, rate = 16 } = {}) {
    this.videoId = videoId;
    this.headless = headless;
    // Browsers reject rates above 16; anything higher throws NotSupportedError.
    this.rate = Math.min(Math.max(rate, 1), 16);
    this.tracks = new Map();
  }

  async open() {
    this.#browser = await Browser.launch({ headless: this.headless });
    this.#page = await this.#browser.newPage('about:blank');
    await this.#page.send('Page.enable', {});

    // Wrap fetch before page scripts exist, and stage responses as base64 for
    // collection. Buffering in the page keeps CDP round trips off the hot path.
    await this.#page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__ytwChunks = [];
          window.__ytwDone = 0;
          const toB64 = (bytes) => {
            let bin = '';
            const step = 0x8000;
            for (let i = 0; i < bytes.length; i += step) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
            }
            return btoa(bin);
          };
          const origFetch = window.fetch;
          window.fetch = async function (input, init) {
            const url = String(typeof input === 'string' ? input : (input && input.url) || '');
            const res = await origFetch.apply(this, arguments);
            if (url.includes('videoplayback')) {
              try {
                const clone = res.clone();
                clone.arrayBuffer().then((buf) => {
                  window.__ytwChunks.push(toB64(new Uint8Array(buf)));
                  window.__ytwDone += 1;
                }).catch(() => {});
              } catch (e) {}
            }
            return res;
          };
        })();
      `,
    });

    await this.#page.send('Page.navigate', {
      url: `https://www.youtube.com/watch?v=${this.videoId}`,
    });
    await this.#page.waitForOrigin('https://www.youtube.com');
    await delay(3500);

    const meta = JSON.parse(
      await this.#page.evaluate(`
        (() => {
          const pr = window.ytInitialPlayerResponse || {};
          const sd = pr.streamingData || {};
          return JSON.stringify({
            status: pr.playabilityStatus?.status || null,
            reason: pr.playabilityStatus?.reason || null,
            title: pr.videoDetails?.title || null,
            author: pr.videoDetails?.author || null,
            durationSeconds: Number(pr.videoDetails?.lengthSeconds || 0),
            publishDate: pr.microformat?.playerMicroformatRenderer?.publishDate || null,
            adaptiveFormats: sd.adaptiveFormats || [],
          });
        })()
      `),
    );

    if (meta.status && meta.status !== 'OK') {
      throw new Error(`video is not playable (${meta.status}${meta.reason ? `: ${meta.reason}` : ''})`);
    }

    this.meta = meta;
    return meta;
  }

  /**
   * Pin the player to one video and audio rendition so the capture is not a
   * mixture of qualities. Uses the player API the page already exposes.
   */
  async selectQuality(height) {
    const label = `${height}p`;
    await this.#page
      .evaluate(`
        (() => {
          const p = document.getElementById('movie_player');
          if (!p || !p.setPlaybackQualityRange) return 'unavailable';
          const map = { 144: 'tiny', 240: 'small', 360: 'medium', 480: 'large',
                        720: 'hd720', 1080: 'hd1080', 1440: 'hd1440', 2160: 'hd2160' };
          const q = map[${height}] || 'hd1080';
          try { p.setPlaybackQualityRange(q, q); } catch (e) {}
          return 'set';
        })()
      `)
      .catch(() => null);
    log.debug(`requested playback quality ${label}`);
  }

  /** Play the video through, draining captured responses as they accumulate. */
  async capture({ onProgress = null, timeoutMs = 600_000 } = {}) {
    await this.#page.evaluate(`
      (async () => {
        const v = document.querySelector('video');
        if (!v) return 'no video';
        v.muted = true;
        v.playbackRate = ${this.rate};
        try { await v.play(); } catch (e) {}
        return 'playing';
      })()
    `);

    const deadline = Date.now() + timeoutMs;
    let stalledRounds = 0;
    let lastProgress = 0;

    while (Date.now() < deadline) {
      await this.#drain();

      const state = JSON.parse(
        await this.#page.evaluate(`
          (() => {
            const v = document.querySelector('video');
            if (!v) return JSON.stringify({ gone: true });
            const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
            return JSON.stringify({
              t: v.currentTime, end, dur: v.duration || 0, ended: v.ended, paused: v.paused,
            });
          })()
        `),
      );

      if (state.gone) break;

      const bytes = [...this.tracks.values()].reduce((n, t) => n + t.bytes, 0);
      const durationMs = (state.dur || this.meta.durationSeconds) * 1000;

      onProgress?.({
        playheadMs: state.t * 1000,
        bufferedMs: state.end * 1000,
        durationMs,
        bytes,
      });

      // Completion is judged on captured media, not on the media element: an
      // audio-only pull leaves the video element idle, so watching it alone
      // would never terminate.
      const captured = Math.max(0, ...[...this.tracks.values()].map((t) => {
        let total = 0;
        for (let i = 1; ; i += 1) {
          const seg = t.segments.get(i);
          if (!seg) break;
          total += seg.durationMs;
        }
        return total;
      }));

      if (durationMs && captured >= durationMs - 1500) {
        await this.#drain();
        log.debug('captured the full duration');
        break;
      }

      if (state.ended || (state.dur && state.end >= state.dur - 1)) {
        await this.#drain();
        log.debug('playback reached the end of the video');
        break;
      }

      // Progress means either the buffer or the captured media moved.
      const progress = Math.max(state.end * 1000, captured);
      if (progress - lastProgress < 250) {
        stalledRounds += 1;
        if (stalledRounds >= 10) {
          log.debug(`capture stopped advancing at ${Math.round(progress / 1000)}s`);
          break;
        }
      } else {
        stalledRounds = 0;
      }
      lastProgress = Math.max(lastProgress, progress);

      // Keep the playhead moving; background tabs and ads can pause it.
      await this.#page
        .evaluate(`
          (() => {
            const v = document.querySelector('video');
            if (v) { v.playbackRate = ${this.rate}; if (v.paused) v.play().catch(() => {}); }
            const btn = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
            if (btn) btn.click();
            return 'ok';
          })()
        `)
        .catch(() => {});

      // Wait on the Node side: an evaluate-based sleep occupies the page's task
      // queue and stalls if the player is busy decoding.
      await delay(1200);
    }

    await this.#drain();
    return this.#results();
  }

  /**
   * Pull staged responses out of the page and feed them through the demuxer.
   *
   * Responses are taken a few at a time: a high-bitrate stream can queue tens of
   * megabytes between polls, and moving that across CDP as one base64 string is
   * slow enough to look like a hang.
   */
  async #drain({ batch = 8 } = {}) {
    for (;;) {
      const raw = await this.#page
        .evaluate(`
          (() => {
            const all = window.__ytwChunks || [];
            const take = all.splice(0, ${batch});
            window.__ytwChunks = all;
            return JSON.stringify({ items: take, remaining: all.length });
          })()
        `)
        .catch(() => '{"items":[],"remaining":0}');

      const { items, remaining } = JSON.parse(raw);
      for (const b64 of items) this.#ingest(Buffer.from(b64, 'base64'));
      if (!remaining || items.length === 0) break;
    }
  }

  #ingest(buffer) {
    const demuxer = new UmpDemuxer();
    const pending = new Map();

    for (const part of demuxer.push(buffer)) {
      switch (part.type) {
        case PART.FORMAT_INITIALIZATION_METADATA: {
          const meta = decodeFormatInitializationMetadata(part.payload);
          if (!meta.formatId) break;
          const key = formatKey(meta.formatId);
          const track = this.tracks.get(key) ?? {
            formatId: meta.formatId,
            mimeType: meta.mimeType,
            segments: new Map(),
            totalSegments: null,
            bytes: 0,
          };
          track.mimeType ??= meta.mimeType;
          track.totalSegments ??= meta.endSegmentNumber;
          this.tracks.set(key, track);
          break;
        }

        case PART.MEDIA_HEADER: {
          const header = decodeMediaHeader(part.payload);
          const key = formatKey(header.formatId);
          const track = this.tracks.get(key) ?? {
            formatId: header.formatId,
            mimeType: null,
            segments: new Map(),
            totalSegments: null,
            bytes: 0,
          };
          this.tracks.set(key, track);
          const index = header.isInitSeg ? 0 : (header.sequenceNumber ?? 1);
          if (track.segments.has(index)) break;
          pending.set(header.headerId, { key, index, header, chunks: [], got: 0 });
          break;
        }

        case PART.MEDIA: {
          const { headerId, data } = splitHeaderId(part.payload);
          const entry = pending.get(headerId);
          if (!entry) break;
          entry.chunks.push(Buffer.from(data));
          entry.got += data.length;
          break;
        }

        case PART.MEDIA_END: {
          const { headerId } = splitHeaderId(part.payload);
          const entry = pending.get(headerId);
          if (!entry) break;
          pending.delete(headerId);
          if (entry.header.contentLength != null && entry.got !== entry.header.contentLength) break;
          const track = this.tracks.get(entry.key);
          const data = Buffer.concat(entry.chunks);
          track.segments.set(entry.index, {
            data,
            durationMs: entry.header.durationMs ?? 0,
            startMs: entry.header.startMs ?? 0,
          });
          track.bytes += data.length;
          break;
        }

        default:
          break;
      }
    }
  }

  #results() {
    const out = [];
    for (const track of this.tracks.values()) {
      if (track.segments.size === 0) continue;

      const parts = [];
      if (track.segments.has(0)) parts.push(track.segments.get(0).data);
      let durationMs = 0;
      let contiguous = 0;
      for (let i = 1; ; i += 1) {
        const seg = track.segments.get(i);
        if (!seg) break;
        parts.push(seg.data);
        durationMs += seg.durationMs;
        contiguous = i;
      }

      const missing = [];
      if (track.totalSegments) {
        for (let i = contiguous + 1; i <= track.totalSegments; i += 1) missing.push(i);
      }

      out.push({
        formatId: track.formatId,
        mimeType: track.mimeType,
        kind: track.mimeType?.includes('video') ? 'video' : 'audio',
        data: Buffer.concat(parts),
        bytes: parts.reduce((n, p) => n + p.length, 0),
        durationMs,
        segments: contiguous + (track.segments.has(0) ? 1 : 0),
        missing,
      });
    }
    return out;
  }

  async close() {
    await this.#browser?.close();
    this.#browser = null;
    this.#page = null;
  }
}
