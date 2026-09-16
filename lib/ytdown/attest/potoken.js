import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Browser } from './cdp.js';
import { log } from '../util/logger.js';

/**
 * PO token minting.
 *
 * YouTube gates sustained media delivery behind an attestation token produced
 * by Google's BotGuard VM. The VM can be *executed* anywhere — it runs happily
 * in node:vm and even returns a plausible looking snapshot — but the server
 * silently refuses to issue an integrity token unless the snapshot was taken
 * inside a genuine browser realm with a committed same-origin document. A bare
 * node:vm snapshot yields `[null, ttl, null, fallbackToken]`: no integrity
 * token, no error. So minting is delegated to a locally installed Chrome driven
 * over CDP — which needs no third-party package, since Node 22 has WebSocket.
 *
 * The resulting integrity token is good for ~12 hours and can mint unlimited
 * bindings, so it is cached on disk and reused across runs and videos.
 */

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const CACHE_FILE = path.join(os.tmpdir(), 'ytw-potoken-cache.json');

// A real, committed document on the youtube.com origin. about:blank does NOT
// work — attestation rejects snapshots taken outside a genuine same-origin
// realm — and a text/plain response cannot issue cross-origin fetches, so this
// needs to be an actual HTML page.
const ATTEST_URL = 'https://www.youtube.com/embed/jNQXAC9IVRw';

/** Runs the whole BotGuard flow inside the page and returns the minted token. */
const MINT_SCRIPT = (requestKey, contentBinding) => `
(async () => {
  const REQUEST_KEY = ${JSON.stringify(requestKey)};
  const BINDING = ${JSON.stringify(contentBinding)};
  const API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';

  const rpc = async (name, payload) => {
    const res = await fetch('https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/' + name, {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': API_KEY,
        'x-user-agent': 'grpc-web-javascript/0.1',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
    return res.json();
  };

  const descramble = (value) => {
    const norm = value.replace(/-/g, '+').replace(/_/g, '/').replace(/\\./g, '=');
    const bin = atob(norm);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) + 97) & 0xff;
    return new TextDecoder().decode(out);
  };

  const b64ToU8 = (value) => {
    const norm = value.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(norm);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const u8ToB64Url = (bytes) => {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_');
  };

  // 1. Challenge.
  const created = await rpc('Create', [REQUEST_KEY]);
  const scrambled = created.find((v) => typeof v === 'string' && v.length > 200);
  if (!scrambled) throw new Error('challenge payload missing');
  const challenge = JSON.parse(descramble(scrambled));
  const wrappedScript = challenge[1];
  const program = challenge[4];
  const globalName = challenge[5];
  const interpreterJs = wrappedScript.find((v) => typeof v === 'string' && v.length > 100);
  if (!interpreterJs) throw new Error('interpreter missing');

  // 2. Load the VM. Trusted Types blocks bare eval on youtube.com origins.
  let evalScript = (src) => (0, eval)(src);
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      const policy = window.trustedTypes.createPolicy('ytw-bg-' + Date.now(), {
        createHTML: (s) => s, createScript: (s) => s, createScriptURL: (s) => s,
      });
      evalScript = (src) => (0, eval)(policy.createScript(src));
    } catch (e) { /* fall back to plain eval */ }
  }
  evalScript(interpreterJs);

  const vm = globalThis[globalName];
  if (!vm || typeof vm.a !== 'function') throw new Error('botguard vm did not initialise');

  // 3. Snapshot. The minter factory is pushed into webPoSignalOutput.
  const webPoSignalOutput = [];
  let asyncSnapshot = null;
  const vmSetup = (fn) => { asyncSnapshot = fn; };
  const noop = () => {};
  const loggers = [noop, noop, noop, noop, noop];

  const res = await vm.a(program, vmSetup, true, undefined, noop, [[], []], undefined, false, loggers);
  const syncSnapshot = Array.isArray(res) ? res[0] : null;

  const takeSnapshot = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('snapshot timed out')), 20000);
    const args = [undefined, undefined, webPoSignalOutput, undefined];
    try {
      if (typeof asyncSnapshot === 'function') {
        asyncSnapshot((out) => { clearTimeout(timer); resolve(out); }, args);
      } else if (typeof syncSnapshot === 'function') {
        const out = syncSnapshot(args);
        clearTimeout(timer);
        resolve(out);
      } else {
        clearTimeout(timer);
        reject(new Error('no snapshot function'));
      }
    } catch (e) { clearTimeout(timer); reject(e); }
  });

  const botguardResponse = await takeSnapshot();
  if (typeof botguardResponse !== 'string' || botguardResponse.startsWith('E:')) {
    throw new Error('snapshot failed: ' + String(botguardResponse).slice(0, 80));
  }

  // 4. Exchange for an integrity token.
  const it = await rpc('GenerateIT', [REQUEST_KEY, botguardResponse]);
  const integrityToken = it[0];
  const ttl = it[1];
  if (typeof integrityToken !== 'string') {
    throw new Error('no integrity token issued (attestation rejected)');
  }

  // 5. Mint, bound to the caller's identifier.
  const getMinter = webPoSignalOutput[0];
  if (typeof getMinter !== 'function') throw new Error('minter factory was never published');
  const mint = await getMinter(b64ToU8(integrityToken));
  if (typeof mint !== 'function') throw new Error('minter factory returned no callback');
  const minted = await mint(new TextEncoder().encode(BINDING));
  if (!minted) throw new Error('minting produced nothing');

  return {
    poToken: u8ToB64Url(minted),
    integrityToken,
    ttl: typeof ttl === 'number' ? ttl : 43200,
  };
})()
`;

async function readCache() {
  try {
    const raw = JSON.parse(await fsp.readFile(CACHE_FILE, 'utf8'));
    if (raw.expiresAt > Date.now()) return raw;
  } catch {
    /* no usable cache */
  }
  return null;
}

async function writeCache(entry) {
  await fsp.writeFile(CACHE_FILE, JSON.stringify(entry), 'utf8').catch(() => {});
}

/**
 * Establish an attested session.
 *
 * Rather than minting a token for a visitorData we generated separately, we let
 * the browser page tell us the visitorData of ITS session and bind the token to
 * that. Attestation ties the token, the identity and the streaming session
 * together; mixing identities from two different sessions leaves the server
 * reporting ATTESTATION_PENDING forever while it serves only a small unattested
 * burst.
 *
 * Returns `{ poToken, visitorData }`; both must then be used for every
 * InnerTube and SABR request in the session.
 */
export async function createAttestedSession({ headless = true, force = false } = {}) {
  if (!force) {
    const cached = await readCache();
    if (cached?.visitorData) {
      log.debug('reusing cached attested session');
      return { poToken: cached.poToken, visitorData: cached.visitorData, cached: true };
    }
  }

  let browser;
  try {
    browser = await Browser.launch({ headless });
  } catch (err) {
    log.debug(`browser launch failed: ${err.message}`);
    return { poToken: null, visitorData: null, error: err.message };
  }

  try {
    const page = await browser.newPage(ATTEST_URL);
    await page.waitForOrigin('https://www.youtube.com');

    // Read the identity this page is actually using.
    const visitorData = await page.evaluate(`
      (() => {
        try {
          if (window.ytcfg && window.ytcfg.get) {
            const ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
            if (ctx && ctx.client && ctx.client.visitorData) return ctx.client.visitorData;
            const vd = window.ytcfg.get('VISITOR_DATA');
            if (vd) return vd;
          }
        } catch (e) {}
        const m = document.documentElement.innerHTML.match(/"visitorData":"([^"]+)"/);
        return m ? m[1].replace(/\\\\u003d/g, '=').replace(/\\\\u0026/g, '&') : null;
      })()
    `);

    if (!visitorData) throw new Error('could not read visitorData from the attesting page');

    const result = await page.evaluate(MINT_SCRIPT(REQUEST_KEY, visitorData), { timeout: 90_000 });
    if (!result?.poToken) throw new Error('minting returned no token');

    log.debug(`attested session ready (token ${result.poToken.length} chars, ttl ${result.ttl}s)`);
    await writeCache({
      binding: visitorData,
      visitorData,
      poToken: result.poToken,
      expiresAt: Date.now() + Math.max(60, (result.ttl ?? 43200) - 300) * 1000,
    });

    return { poToken: result.poToken, visitorData, cached: false };
  } catch (err) {
    log.debug(`attestation failed: ${err.message}`);
    return { poToken: null, visitorData: null, error: err.message };
  } finally {
    await browser.close();
  }
}

/**
 * Establish an attested session on the watch page of a specific video.
 *
 * Attestation ties together the token, the visitor identity and the streaming
 * session. Minting on a generic page and then calling /player from a separately
 * bootstrapped Node session produces two identities, and the server answers
 * ATTESTATION_REQUIRED once the short unattested allowance runs out. Doing
 * everything on the video's own watch page keeps one identity throughout, and
 * lets us take the player response the browser itself was issued.
 *
 * Returns the token, the visitor id, and the streaming parameters that were
 * issued to that same session.
 */
export async function createWatchSession(videoId, { headless = true } = {}) {
  let browser;
  try {
    browser = await Browser.launch({ headless });
  } catch (err) {
    log.debug(`browser launch failed: ${err.message}`);
    return { error: err.message };
  }

  try {
    const page = await browser.newPage(`https://www.youtube.com/watch?v=${videoId}`);
    await page.waitForOrigin('https://www.youtube.com');

    // Let the page settle so ytcfg and the player response are populated.
    await page.evaluate('new Promise((r) => setTimeout(r, 3000))');

    const visitorData = await page.evaluate(`
      (() => {
        try {
          if (window.ytcfg && window.ytcfg.get) {
            const ctx = window.ytcfg.get('INNERTUBE_CONTEXT');
            if (ctx?.client?.visitorData) return ctx.client.visitorData;
            const vd = window.ytcfg.get('VISITOR_DATA');
            if (vd) return vd;
          }
        } catch (e) {}
        return null;
      })()
    `);
    if (!visitorData) throw new Error('watch page exposed no visitorData');

    const minted = await page.evaluate(MINT_SCRIPT(REQUEST_KEY, visitorData), { timeout: 90_000 });
    if (!minted?.poToken) throw new Error('minting returned no token');

    // Take the streaming parameters this attested session was issued.
    const playback = JSON.parse(
      await page.evaluate(`
        (() => {
          const pr = window.ytInitialPlayerResponse || {};
          const sd = pr.streamingData || {};
          return JSON.stringify({
            serverAbrStreamingUrl: sd.serverAbrStreamingUrl || null,
            ustreamerConfig: pr.playerConfig?.mediaCommonConfig?.mediaUstreamerRequestConfig?.videoPlaybackUstreamerConfig || null,
            clientVersion: (window.ytcfg && window.ytcfg.get) ? window.ytcfg.get('INNERTUBE_CLIENT_VERSION') : null,
            durationSeconds: Number(pr.videoDetails?.lengthSeconds || 0),
            title: pr.videoDetails?.title || null,
            author: pr.videoDetails?.author || null,
            status: pr.playabilityStatus?.status || null,
            formats: (sd.adaptiveFormats || []),
          });
        })()
      `),
    );

    log.debug(`watch session ready (token ${minted.poToken.length} chars)`);

    return {
      poToken: minted.poToken,
      visitorData,
      ...playback,
    };
  } catch (err) {
    log.debug(`watch session failed: ${err.message}`);
    return { error: err.message };
  } finally {
    await browser.close();
  }
}

/**
 * Obtain a GVS PO token bound to `contentBinding` (a visitorData string,
 * byte-for-byte as sent in the InnerTube context).
 */
export async function mintPoToken(contentBinding, { headless = true, force = false } = {}) {
  if (!force) {
    const cached = await readCache();
    if (cached?.binding === contentBinding) {
      log.debug('reusing cached po token');
      return { poToken: cached.poToken, cached: true };
    }
  }

  let browser;
  try {
    browser = await Browser.launch({ headless });
  } catch (err) {
    log.debug(`browser launch failed: ${err.message}`);
    return { poToken: null, error: err.message };
  }

  try {
    const page = await browser.newPage(ATTEST_URL);
    await page.waitForOrigin('https://www.youtube.com');

    const result = await page.evaluate(MINT_SCRIPT(REQUEST_KEY, contentBinding), {
      timeout: 90_000,
    });

    if (!result?.poToken) throw new Error('minting returned no token');

    log.debug(`minted po token (${result.poToken.length} chars, ttl ${result.ttl}s)`);
    await writeCache({
      binding: contentBinding,
      poToken: result.poToken,
      expiresAt: Date.now() + Math.max(60, (result.ttl ?? 43200) - 300) * 1000,
    });

    return { poToken: result.poToken, cached: false };
  } catch (err) {
    log.debug(`po token minting failed: ${err.message}`);
    return { poToken: null, error: err.message };
  } finally {
    await browser.close();
  }
}
