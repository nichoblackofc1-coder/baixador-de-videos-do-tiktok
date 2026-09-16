import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';

import { Browser } from './cdp.js';
import { Reader, WIRE } from '../proto/wire.js';
import { log } from '../util/logger.js';

/**
 * Session export and reuse.
 *
 * A SABR session opened from plain Node is cut off after about a minute:
 * STREAM_PROTECTION_STATUS never rises above 2 and then drops to 3. A session
 * opened by a real browser that has actually played past that point is
 * different — replaying one of its requests from Node returns status **1 (OK)**,
 * which no locally minted token ever achieved.
 *
 * So the credential that matters is obtainable, just not mintable: it has to be
 * observed from a session that the service already decided to trust. This module
 * captures one, and caches it so subsequent downloads need no browser at all.
 *
 * The export contains everything the Node downloader needs — including a
 * streaming URL that already carries the player's transformed `n`.
 */

const CACHE_FILE = path.join(os.tmpdir(), 'ytw-session-cache.json');

/**
 * How long an exported session is trusted.
 *
 * The streaming URL carries `expire` inside its signed parameter set, so the real
 * lifetime comes from there; this is only the floor used when that is missing.
 */
const SESSION_TTL_MS = 5 * 60 * 1000;

/**
 * Whether a session is still usable, judged from the URL's own signature.
 *
 * `sparams` shows that `expire`, `ip` and `id` are all signed, so a session is
 * bound to one video, one address, and a deadline — none of which can be edited.
 * That is why sessions are refreshed rather than shipped as constants.
 */
export function sessionExpiry(session) {
  try {
    const expire = Number(new URL(session.streamingUrl).searchParams.get('expire'));
    if (Number.isFinite(expire) && expire > 0) return expire * 1000;
  } catch {
    /* fall through to the conservative floor */
  }
  return (session.capturedAt ?? 0) + SESSION_TTL_MS;
}

export function sessionIsFresh(session, marginMs = 60_000) {
  if (!session?.streamingUrl) return false;
  return sessionExpiry(session) - marginMs > Date.now();
}

/** Shell redirection on Windows prefixes a UTF-8 BOM, which JSON.parse rejects. */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readStreamerContext(bodyB64) {
  const reader = new Reader(Buffer.from(bodyB64, 'base64'));
  for (const { field, wire } of reader.tags()) {
    if (field === 19 && wire === WIRE.LENGTH) return new Reader(reader.bytes());
    reader.skip(wire);
  }
  return null;
}

/**
 * Open the watch page, let the player stream past the point where an ordinary
 * session is cut off, and export the credential it earned.
 */
export async function exportSession(videoId, { headless = false, minBufferedSeconds = 120, timeoutMs = 120_000 } = {}) {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const browser = await Browser.launch({ headless, startUrl: watchUrl });
  const deadline = Date.now() + timeoutMs;

  try {
    const page = await browser.newPage(watchUrl);
    await page.send('Network.enable', { maxPostDataSize: 2_000_000 });

    const requests = [];
    browser.onEvent = (event) => {
      if (event.method !== 'Network.requestWillBeSent') return;
      const req = event.params?.request;
      if (!req?.url?.includes('videoplayback') || !req.postData) return;
      requests.push({
        url: req.url,
        body: Buffer.from(req.postData, 'binary').toString('base64'),
      });
    };

    await page.waitForOrigin('https://www.youtube.com');
    await sleep(3500);

    await page.evaluate(`
      (async () => {
        const v = document.querySelector('video');
        if (!v) return 'no video';
        v.muted = true;
        v.playbackRate = 16;
        try { await v.play(); } catch (e) {}
        return 'playing';
      })()
    `);

    // Play until the session has proven itself past the cut-off point, or the
    // budget runs out — a page that never gets going should not hang the caller.
    for (let i = 0; i < 60 && Date.now() < deadline; i += 1) {
      await sleep(2000);
      const state = JSON.parse(
        await page
          .evaluate(`
            (() => {
              const v = document.querySelector('video');
              if (!v) return JSON.stringify({ gone: true });
              const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
              return JSON.stringify({ end, dur: v.duration || 0 });
            })()
          `)
          .catch(() => '{"gone":true}'),
      );

      if (state.gone) break;
      if (state.end >= minBufferedSeconds) break;
      if (state.dur && state.end >= state.dur - 1) break;
    }

    const meta = JSON.parse(
      await page.evaluate(`
        JSON.stringify({
          ustreamerConfig: window.ytInitialPlayerResponse?.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig || null,
          clientVersion: (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CLIENT_VERSION') : null,
          visitorData: (window.ytcfg && window.ytcfg.get) ? (window.ytcfg.get('INNERTUBE_CONTEXT')?.client?.visitorData || null) : null,
          durationSeconds: Number(window.ytInitialPlayerResponse?.videoDetails?.lengthSeconds || 0),
          title: window.ytInitialPlayerResponse?.videoDetails?.title || null,
          author: window.ytInitialPlayerResponse?.videoDetails?.author || null,
          publishDate: window.ytInitialPlayerResponse?.microformat?.playerMicroformatRenderer?.publishDate || null,
          adaptiveFormats: window.ytInitialPlayerResponse?.streamingData?.adaptiveFormats || [],
        })
      `),
    );

    const last = requests[requests.length - 1];
    if (!last) throw new Error('the page issued no media requests');

    let poToken = null;
    let playbackCookie = null;
    const ctx = readStreamerContext(last.body);
    if (ctx) {
      for (const { field, wire } of ctx.tags()) {
        if (field === 2 && wire === WIRE.LENGTH) poToken = Buffer.from(ctx.bytes());
        else if (field === 3 && wire === WIRE.LENGTH) playbackCookie = Buffer.from(ctx.bytes());
        else ctx.skip(wire);
      }
    }

    const session = {
      videoId,
      ...meta,
      // Carries the player's transformed `n`, so replaying it needs no player script.
      streamingUrl: last.url,
      poTokenB64: poToken?.toString('base64') ?? null,
      playbackCookieB64: playbackCookie?.toString('base64') ?? null,
      capturedAt: Date.now(),
    };

    log.debug(
      `exported session for ${videoId}: token ${poToken?.length ?? 0}B, cookie ${playbackCookie?.length ?? 0}B, ${requests.length} requests observed`,
    );

    await writeCache(session);
    return session;
  } finally {
    await browser.close();
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeCache(session) {
  try {
    const existing = await readCacheFile();
    existing[session.videoId] = session;
    await fsp.writeFile(CACHE_FILE, JSON.stringify(existing), 'utf8');
  } catch {
    /* caching is best effort */
  }
}

async function readCacheFile() {
  try {
    return JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Return a cached session for this video if one is still usable. */
export async function loadSession(videoId) {
  const cache = await readCacheFile();
  const session = cache[videoId];
  if (!session) return null;
  if (!sessionIsFresh(session)) {
    log.debug(`cached session for ${videoId} has expired`);
    return null;
  }
  return session;
}

/**
 * Adopt a session supplied from outside this process, so no browser is launched
 * at all.
 *
 * `YTW_SESSION` may be a path to a JSON file or the JSON itself, in the shape
 * `exportSession` produces. This is the escape hatch for headless servers and for
 * anyone who would rather mint credentials elsewhere and hand them in.
 */
export async function loadExternalSession(videoId) {
  const raw = process.env.YTW_SESSION;
  if (!raw) return null;

  let parsed;
  try {
    const text = raw.trimStart().startsWith('{') ? raw : await fsp.readFile(raw, 'utf8');
    // Shell redirection on Windows commonly prefixes a UTF-8 BOM, which
    // JSON.parse rejects.
    parsed = JSON.parse(stripBom(text));
  } catch (err) {
    log.warn(`ignoring YTW_SESSION: ${err.message}`);
    return null;
  }

  // Accept either a single session or a map keyed by video id.
  const session = parsed.streamingUrl ? parsed : parsed[videoId];
  if (!session?.streamingUrl) {
    log.warn(`YTW_SESSION carries no session for ${videoId}`);
    return null;
  }

  /*
   * A session's streaming URL signs `expire`, `ip` and `id`, so it is valid for
   * one video, from one address, until a deadline. Say which of those failed
   * rather than letting the download stop at 60s with no explanation.
   */
  if (!sessionIsFresh(session)) {
    const expired = new Date(sessionExpiry(session)).toISOString();
    log.warn(`the session in YTW_SESSION expired at ${expired}; export a fresh one`);
    return null;
  }

  try {
    const boundIp = new URL(session.streamingUrl).searchParams.get('ip');
    if (boundIp) log.debug(`session is bound to ip ${decodeURIComponent(boundIp)}`);
  } catch {
    /* informational only */
  }

  log.debug('using a session supplied via YTW_SESSION');
  return session;
}
