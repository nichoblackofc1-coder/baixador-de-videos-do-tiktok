import vm from 'node:vm';
import { ORIGIN } from '../config/constants.js';
import { createBrowserContext } from './sandbox.js';
import { log } from '../util/logger.js';

/**
 * base.js reverse engineering.
 *
 * Media URLs handed out by InnerTube carry a throttling-deterrent `n`
 * parameter. On SABR URLs an untransformed `n` is not merely throttled — the
 * CDN rejects the request with a bare HTTP 403. So transforming it is
 * mandatory, not an optimisation.
 *
 * Modern players (2026) no longer expose a standalone n function or the classic
 * `s`-decipher. Instead a single URL-builder function returns a URL-like object
 * and BOTH transforms are applied as a side effect when one of that object's
 * methods is invoked. Property names are indirected through an obfuscated
 * string table, so there is nothing stable to pattern-match inside the body.
 *
 * The stable structural markers are:
 *   - a three parameter function `f(url, name = "", value = "")`
 *   - whose body calls `.set("alr", "yes")`
 *   - and constructs the URL wrapper with `new <ns>.<Class>(...)`
 *
 * On player ea6f527e this selects exactly one function:
 *
 *   ok = function (M, l = "", c = "") {
 *     M = new g.Wx(M, !0);
 *     M.set("alr", "yes");
 *     c && (c = sx(2, 3303, XV(6, 8828, c)), M[L[0]](l, q_(4, 6046, c)));
 *     return M
 *   };
 *
 * Rather than reimplement the obfuscated maths, we evaluate the whole player
 * inside a locked-down `node:vm`, call this function, then invoke the one
 * prototype method that is not part of the public surface
 * (constructor/set/get/clone) — that method serialises the URL and applies the
 * transforms.
 */

const URL_BUILDER_SIGNATURE =
  /(?:^|[;,{}\s])([A-Za-z_$][\w$]*)\s*=\s*function\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*""\s*,\s*([A-Za-z_$][\w$]*)\s*=\s*""\s*\)\s*\{/g;

/** Methods present on the URL wrapper that are NOT the transform trigger. */
const PUBLIC_URL_METHODS = new Set(['constructor', 'set', 'get', 'clone']);

export function extractSignatureTimestamp(source) {
  const m = /signatureTimestamp\s*:\s*(\d{4,})/.exec(source);
  return m ? Number(m[1]) : null;
}

/** Locate the URL-builder function by structural shape. */
export function findUrlBuilderName(source) {
  const candidates = [];

  for (const m of source.matchAll(URL_BUILDER_SIGNATURE)) {
    const name = m[1];
    const window = source.slice(m.index, m.index + 700);
    const hasAlr = /\.set\(\s*(["'])alr\1\s*,\s*(["'])yes\2\s*\)/.test(window);
    const hasCtor = /=\s*new\s+[\w$]+\.[\w$]+\(/.test(window);
    if (hasAlr && hasCtor) candidates.push({ name, offset: m.index });
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    log.debug(`multiple url builder candidates: ${candidates.map((c) => c.name).join(',')}`);
  }
  return candidates[0].name;
}

/**
 * A live player instance: the evaluated bundle plus the transforms we drive.
 */
export class PlayerScript {
  #transform = null;

  constructor({ playerId, source }) {
    this.playerId = playerId;
    this.source = source;
    this.signatureTimestamp = extractSignatureTimestamp(source);
    this.builderName = findUrlBuilderName(source);
    this.#transform = this.#compile();
  }

  static async load(http, jsUrl) {
    const url = new URL(jsUrl, ORIGIN).toString();
    const source = await http.text(url, { headers: { accept: '*/*' } });
    const playerId = /\/player\/([0-9a-fA-F]{8,})\//.exec(url)?.[1] ?? 'unknown';
    return new PlayerScript({ playerId, source });
  }

  get healthy() {
    return Boolean(this.signatureTimestamp) && Boolean(this.#transform);
  }

  #compile() {
    if (!this.builderName) {
      log.warn('could not locate the player url builder; n transform unavailable');
      return null;
    }

    // The builder is a local binding inside the bundle's IIFE, invisible from
    // the outside. Splice a driver in just before the IIFE closes, where `eval`
    // can still see the whole lexical scope, and hand the result out via the
    // sandbox global.
    const patched = this.#injectDriver();
    if (!patched) {
      log.warn('could not splice driver into the player bundle');
      return null;
    }

    const sandbox = createBrowserContext();
    const context = vm.createContext(sandbox);

    try {
      vm.runInContext(patched, context, { timeout: 60_000, filename: 'base.js' });
    } catch (err) {
      log.debug(`player bundle threw during evaluation: ${err.message}`);
      // The bundle frequently throws late (IndexedDB probes, telemetry) after
      // the functions we need are already defined, so keep going.
    }

    const fn = sandbox.__ytwTransform;
    if (typeof fn !== 'function') {
      log.warn(`driver did not produce a transform (${sandbox.__ytwDriverError ?? 'no error reported'})`);
      return null;
    }

    try {
      const probe = fn(null, 'abcdefghijklmno');
      if (!probe || typeof probe.n !== 'string') {
        log.warn('url builder returned no n value');
        return null;
      }
    } catch (err) {
      log.warn(`transform smoke test failed: ${err.message}`);
      return null;
    }

    log.debug(`player ${this.playerId} builder=${this.builderName} sts=${this.signatureTimestamp}`);
    return fn;
  }

  #injectDriver() {
    const tail = '})(_yt_player);';
    const at = this.source.lastIndexOf(tail);
    if (at === -1) return null;

    const driver = `
;try{
  var __build = ${this.builderName};
  var __public = ${JSON.stringify([...PUBLIC_URL_METHODS])};
  this.__ytwTransform = function (signature, n) {
    var url = __build('https://www.youtube.com/watch?v=aaaaaaaaaaa', 's',
                      signature ? encodeURIComponent(signature) : undefined);
    if (n != null) url.set('n', n);

    var proto = Object.getPrototypeOf(url);
    var names = Object.keys(proto).concat(Object.getOwnPropertyNames(proto));
    for (var i = 0; i < names.length; i++) {
      if (__public.indexOf(names[i]) !== -1) continue;
      try { url[names[i]](); } catch (e) { continue; }
      break;
    }

    var s = url.get('s');
    return { signature: s ? decodeURIComponent(s) : null, n: url.get('n') };
  };
}catch(e){ this.__ytwDriverError = String(e && e.message); }
`;

    return this.source.slice(0, at) + driver + this.source.slice(at);
  }

  /** Transform a throttling-deterrent `n` value. */
  transformN(n) {
    if (!this.#transform || !n) return n;
    try {
      const out = this.#transform(null, n);
      return typeof out?.n === 'string' && out.n.length ? out.n : n;
    } catch (err) {
      log.debug(`n transform threw: ${err.message}`);
      return n;
    }
  }

  /** Decipher a legacy `signatureCipher` s value. */
  decipherSignature(signature) {
    if (!this.#transform || !signature) return signature;
    try {
      const out = this.#transform(signature, null);
      return typeof out?.signature === 'string' && out.signature.length
        ? out.signature
        : signature;
    } catch (err) {
      log.debug(`signature decipher threw: ${err.message}`);
      return signature;
    }
  }

  /**
   * Rewrite a media URL so it is actually accepted by the CDN: transform `n`,
   * and fold in a deciphered signature when the URL came from signatureCipher.
   */
  prepareUrl(rawUrl, { signature = null, signatureKey = 'sig' } = {}) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl;
    }

    const n = url.searchParams.get('n');
    if (n) {
      const fixed = this.transformN(n);
      if (fixed && fixed !== n) url.searchParams.set('n', fixed);
    }

    if (signature) {
      url.searchParams.set(signatureKey, this.decipherSignature(signature));
    }

    return url.toString();
  }
}
