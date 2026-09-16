import { Buffer } from 'node:buffer';

import { Browser } from './cdp.js';
import { log, formatBytes } from '../util/logger.js';

/**
 * Browser-backed media transport.
 *
 * A signed-out Node session can start a SABR stream but the server withdraws it
 * after roughly a minute: STREAM_PROTECTION_STATUS flips to ATTESTATION_REQUIRED
 * and no further MEDIA parts arrive. That ceiling is not something the request
 * body controls — it survives a correct playback position, a fresh streaming
 * grant, every PO token binding we can mint, and even the exact token a real
 * browser was observed using. What the server is actually gating on is the
 * execution context.
 *
 * So the media fetch runs where it is accepted: inside a real, attested
 * youtube.com page. The page issues the SABR POSTs, and the response bytes come
 * back over CDP for Node to demux and assemble. Everything else in this project
 * (protocol, parsing, muxing) stays in Node.
 */

/** Runs one SABR POST inside the page and returns the response as base64. */
const FETCH_SCRIPT = (url, bodyB64) => `
(async () => {
  const b64ToU8 = (s) => {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const u8ToB64 = (bytes) => {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  };

  const res = await fetch(${JSON.stringify(url)}, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-protobuf',
      accept: 'application/vnd.yt-ump',
    },
    body: b64ToU8(${JSON.stringify(bodyB64)}),
    credentials: 'include',
    mode: 'cors',
  });

  const buf = new Uint8Array(await res.arrayBuffer());
  return JSON.stringify({ status: res.status, data: u8ToB64(buf) });
})()
`;

export class BrowserTransport {
  #browser = null;
  #page = null;

  constructor({ videoId, headless = true } = {}) {
    this.videoId = videoId;
    this.headless = headless;
  }

  /** Open the video's watch page so the session is attested for this video. */
  async open() {
    this.#browser = await Browser.launch({ headless: this.headless });
    this.#page = await this.#browser.newPage(
      `https://www.youtube.com/watch?v=${this.videoId}`,
    );
    await this.#page.waitForOrigin('https://www.youtube.com');

    // Let the player negotiate its session before we borrow it.
    await this.#page.evaluate('new Promise((r) => setTimeout(r, 3500))');

    const meta = JSON.parse(
      await this.#page.evaluate(`
        (() => {
          const pr = window.ytInitialPlayerResponse || {};
          const sd = pr.streamingData || {};
          return JSON.stringify({
            status: pr.playabilityStatus?.status || null,
            reason: pr.playabilityStatus?.reason || null,
            serverAbrStreamingUrl: sd.serverAbrStreamingUrl || null,
            ustreamerConfig: pr.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig || null,
            clientVersion: (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CLIENT_VERSION') : null,
            visitorData: (window.ytcfg && window.ytcfg.get) ? (window.ytcfg.get('INNERTUBE_CONTEXT')?.client?.visitorData || null) : null,
            durationSeconds: Number(pr.videoDetails?.lengthSeconds || 0),
            title: pr.videoDetails?.title || null,
            author: pr.videoDetails?.author || null,
            publishDate: pr.microformat?.playerMicroformatRenderer?.publishDate || null,
            adaptiveFormats: sd.adaptiveFormats || [],
          });
        })()
      `),
    );

    if (!meta.serverAbrStreamingUrl) {
      throw new Error(
        `the watch page exposed no streaming url (playability: ${meta.status ?? 'unknown'}${meta.reason ? ` — ${meta.reason}` : ''})`,
      );
    }

    // Stop the player so it does not compete for bandwidth with our own pulls.
    await this.#page
      .evaluate(`(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.muted = true; } return 'paused'; })()`)
      .catch(() => {});

    log.debug(`browser transport ready for ${this.videoId}`);
    return meta;
  }

  /** POST a SABR request from inside the page. */
  async post(url, body) {
    const raw = await this.#page.evaluate(
      FETCH_SCRIPT(url, Buffer.from(body).toString('base64')),
      { timeout: 120_000 },
    );
    const { status, data } = JSON.parse(raw);
    const buffer = Buffer.from(data, 'base64');
    log.debug(`browser post -> ${status} ${formatBytes(buffer.length)}`);
    return { status, buffer };
  }

  async close() {
    await this.#browser?.close();
    this.#browser = null;
    this.#page = null;
  }
}
