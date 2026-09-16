import { Buffer } from 'node:buffer';

import { log, formatBytes } from '../util/logger.js';

/**
 * Progressive download from a plain media URL.
 *
 * The desktop WEB surface is SABR-only, but the mobile web surface — still a
 * browser client, still youtube.com — is sometimes served ordinary media URLs.
 * Those need the `n` parameter transformed exactly as SABR URLs do, after which
 * they answer ranged GETs with real bytes and no attestation of any kind.
 *
 * That makes this the only path that downloads a video of any length with no
 * browser involved at all.
 */

/**
 * Largest byte range the CDN will serve on an adaptive media URL.
 *
 * Measured: ranges up to 256 KB answer 206, and 1 MB or more is refused with a
 * bare 403 regardless of signing.
 */
const MAX_RANGE_BYTES = 256 * 1024;

/**
 * How far into an adaptive file one URL will serve.
 *
 * Bisected at 895 KB on a 9.73 MB audio track — about 9% — and a range past that
 * point is refused even as the first request on a freshly issued URL, so renewing
 * does not help. Adaptive formats therefore cannot be assembled this way.
 *
 * Muxed formats are different: they carry `ratebypass=yes`, report a real
 * content-length, and stream end to end. That is what `streamWhole` is for.
 */
const ADAPTIVE_REACH_BYTES = 895 * 1024;

export class ProgressiveDownload {
  /**
   * `refreshUrl` is called to obtain a new media URL for the same format when the
   * current one is exhausted.
   */
  constructor({ http, player, chunkSize = MAX_RANGE_BYTES, concurrency = 4, refreshUrl = null } = {}) {
    this.http = http;
    this.player = player;
    this.chunkSize = Math.min(chunkSize, MAX_RANGE_BYTES);
    this.concurrency = concurrency;
    this.refreshUrl = refreshUrl;
  }

  /**
   * Read a whole media URL in one streamed response, resuming if the connection
   * stops short.
   *
   * This is the path muxed formats take. They are not subject to the adaptive
   * reach limit, so the entire file arrives — verified end to end on a 10:35
   * video: 27.20 MB of 27.20 MB, 634.58s of audio and video, clean decode.
   */
  async streamWhole(format, { onProgress = null, maxResumes = 40 } = {}) {
    const url = this.resolveUrl(format);
    if (!url) throw new Error(`itag ${format.itag} carries no usable url`);
    const parts = [];
    let total = 0;

    const first = await this.http.request(url, {
      headers: { accept: '*/*' },
      expect: [200, 206],
      retries: 2,
    });
    const declared = Number(first.headers['content-length'] ?? 0);

    for await (const chunk of first.stream) {
      parts.push(chunk);
      total += chunk.length;
      onProgress?.({ bytes: total, total: declared });
    }

    // Connections do drop on long transfers; pick up where they left off.
    for (let attempt = 0; declared && total < declared && attempt < maxResumes; attempt += 1) {
      const res = await this.http.request(url, {
        headers: { range: `bytes=${total}-`, accept: '*/*' },
        expect: [200, 206, 403, 416],
        retries: 1,
      });

      if (res.status !== 200 && res.status !== 206) {
        res.stream.resume();
        break;
      }

      let got = 0;
      for await (const chunk of res.stream) {
        parts.push(chunk);
        total += chunk.length;
        got += chunk.length;
        onProgress?.({ bytes: total, total: declared });
      }
      if (!got) break;
    }

    const data = Buffer.concat(parts);
    if (declared && data.length !== declared) {
      throw new Error(
        `itag ${format.itag} came back short: ${formatBytes(data.length)} of ${formatBytes(declared)}`,
      );
    }

    log.debug(`itag ${format.itag}: streamed ${formatBytes(data.length)} whole`);
    return data;
  }

  /** Whether a format can be fetched whole from its URL. */
  static isStreamable(format) {
    // Muxed formats carry ratebypass and are not reach-limited.
    return Boolean((format?.url || format?.signatureCipher) && format.muxed);
  }

  /**
   * The URL for a format, whether it arrived plainly or locked behind a
   * `signatureCipher`. Some videos are served with `url` withheld and
   * `s`/`sp`/`url` shipped instead; the signature has to go through the player's
   * transform and be reattached under the name `sp` gives, or the CDN refuses.
   */
  resolveUrl(format) {
    if (format?.url) return this.prepareUrl(format.url);
    if (!format?.signatureCipher) return null;

    const parts = new URLSearchParams(format.signatureCipher);
    const base = parts.get('url');
    if (!base) return null;

    const signature = parts.get('s');
    if (!signature) return this.prepareUrl(base);

    let url;
    try {
      url = new URL(base);
    } catch {
      return null;
    }

    const deciphered = this.player?.decipherSignature(signature) ?? signature;
    url.searchParams.set(parts.get('sp') || 'signature', deciphered);
    return this.prepareUrl(url.toString());
  }

  /** Apply the throttling-deterrent transform; without it the CDN answers 403. */
  prepareUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl;
    }

    const n = url.searchParams.get('n');
    if (n && this.player) {
      const fixed = this.player.transformN(n);
      if (fixed && fixed !== n) url.searchParams.set('n', fixed);
    }
    return url.toString();
  }

  /**
   * Total size, taken from the CDN rather than from the player response.
   *
   * `contentLength` in the metadata does not always match what the server will
   * actually serve, and a range that runs past the real end is refused outright,
   * so the authoritative figure has to come from a ranged probe.
   */
  async probeSize(url, hint) {
    const measured = await this.http
      .probeSize(url, { headers: { accept: '*/*' } })
      .catch(() => 0);

    if (measured) {
      if (hint && Number(hint) !== measured) {
        log.debug(`size differs from metadata: server ${measured}, metadata ${hint}`);
      }
      return measured;
    }
    return Number(hint ?? 0);
  }

  /**
   * Download a whole format.
   *
   * Each URL serves only about a megabyte before refusing permanently, so the
   * transfer is sequential and the URL is renewed whenever its budget runs out.
   * A refused range is retried once on a fresh URL before it is treated as fatal.
   */
  async download(format, { onProgress = null } = {}) {
    let url = this.resolveUrl(format);
    if (!url) throw new Error(`itag ${format.itag} carries no usable url`);
    const total = await this.probeSize(url, format.contentLength);
    if (!total) throw new Error(`could not determine the size of itag ${format.itag}`);

    const parts = [];
    let position = 0;
    let spent = 0;
    let renewals = 0;

    while (position < total) {
      const end = Math.min(position + this.chunkSize - 1, total - 1);

      // Renew before the reach limit is hit rather than after a failure.
      if (spent >= ADAPTIVE_REACH_BYTES) {
        url = await this.#renew(format, url);
        renewals += 1;
        spent = 0;
      }

      let chunk = await this.#tryRange(url, position, end);

      if (!chunk) {
        // The budget estimate was off; renew and retry this range once.
        url = await this.#renew(format, url);
        renewals += 1;
        spent = 0;
        chunk = await this.#tryRange(url, position, end);
        if (!chunk) {
          throw new Error(
            `itag ${format.itag}: range ${position}-${end} refused even on a fresh url`,
          );
        }
      }

      parts.push(chunk);
      position += chunk.length;
      spent += chunk.length;
      onProgress?.({ bytes: position, total, renewals });
    }

    const data = Buffer.concat(parts);
    if (data.length !== total) {
      throw new Error(
        `itag ${format.itag} came back short: ${formatBytes(data.length)} of ${formatBytes(total)}`,
      );
    }

    log.debug(
      `itag ${format.itag}: ${formatBytes(data.length)} in ${parts.length} ranges, ${renewals} url renewals`,
    );
    return data;
  }

  /** Ask for a fresh URL for this format, keeping the old one as a fallback. */
  async #renew(format, currentUrl) {
    if (!this.refreshUrl) return currentUrl;
    try {
      // refreshUrl hands back a ready URL — already deciphered and
      // n-transformed. Running prepareUrl over it again would transform `n` a
      // second time and the CDN would answer 403.
      const fresh = await this.refreshUrl(format);
      if (fresh) {
        log.debug(`renewed url for itag ${format.itag}`);
        return fresh;
      }
    } catch (err) {
      log.debug(`url renewal failed: ${err.message}`);
    }
    return currentUrl;
  }

  /** One ranged GET. Returns null when the server refuses or truncates. */
  async #tryRange(url, start, end) {
    try {
      const res = await this.http.request(url, {
        headers: { range: `bytes=${start}-${end}`, accept: '*/*' },
        expect: [200, 206, 403],
        retries: 1,
      });

      if (res.status === 403) {
        res.stream.resume();
        return null;
      }

      const chunks = [];
      for await (const chunk of res.stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      // A range that comes back shorter than asked for would silently corrupt the
      // output, so treat it as a failure and let the caller renew and retry.
      const expected = end - start + 1;
      if (buffer.length !== expected) {
        log.debug(`range ${start}-${end} returned ${buffer.length} of ${expected} bytes`);
        return null;
      }

      return buffer;
    } catch (err) {
      log.debug(`range ${start}-${end} failed: ${err.message}`);
      return null;
    }
  }
}
