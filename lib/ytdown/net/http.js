import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

import { CookieJar } from './cookies.js';
import {
  BROWSER_HEADERS,
  CONSENT_COOKIE,
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_MS,
} from '../config/constants.js';
import { log } from '../util/logger.js';

const agents = {
  'https:': new https.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 15_000 }),
  'http:': new http.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 15_000 }),
};

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

function decompressStream(res) {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  switch (encoding) {
    case 'gzip':
      return res.pipe(zlib.createGunzip());
    case 'deflate':
      return res.pipe(zlib.createInflate());
    case 'br':
      return res.pipe(zlib.createBrotliDecompress());
    default:
      return res;
  }
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 ||
    status === 503 || status === 504;
}

/**
 * A single HTTP session: shared cookie jar, keep-alive agents, redirect
 * following, transparent decompression, and retry with exponential backoff.
 */
export class HttpClient {
  constructor({ jar, timeout = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
    this.jar = jar ?? new CookieJar([CONSENT_COOKIE]);
    this.timeout = timeout;
    this.retries = retries;
  }

  /** Perform one request without retries. Resolves with the live response stream. */
  #once(url, { method = 'GET', headers = {}, body = null, redirects = 0 } = {}) {
    return new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(url);
      } catch (err) {
        reject(err);
        return;
      }

      const transport = target.protocol === 'http:' ? http : https;
      const cookie = this.jar.header();
      const finalHeaders = {
        ...BROWSER_HEADERS,
        ...(cookie ? { cookie } : {}),
        ...headers,
      };
      if (body != null && finalHeaders['content-length'] == null) {
        finalHeaders['content-length'] = String(Buffer.byteLength(body));
      }

      const req = transport.request(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || undefined,
          path: `${target.pathname}${target.search}`,
          method,
          headers: finalHeaders,
          agent: agents[target.protocol],
        },
        (res) => {
          this.jar.absorb(res.headers['set-cookie']);

          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 8) {
              reject(new Error(`Too many redirects for ${url}`));
              return;
            }
            const next = new URL(res.headers.location, target).toString();
            // 303, and 301/302 on POST, degrade to GET per browser behaviour.
            const nextMethod =
              status === 303 || (method === 'POST' && (status === 301 || status === 302))
                ? 'GET'
                : method;
            resolve(
              this.#once(next, {
                method: nextMethod,
                headers,
                body: nextMethod === 'GET' ? null : body,
                redirects: redirects + 1,
              }),
            );
            return;
          }

          resolve({ status, headers: res.headers, stream: decompressStream(res), url: target.toString() });
        },
      );

      req.setTimeout(this.timeout, () => {
        req.destroy(new Error(`Timeout after ${this.timeout}ms for ${url}`));
      });
      req.on('error', reject);

      if (body != null) req.write(body);
      req.end();
    });
  }

  /** Request with retries. `expect` lists extra acceptable status codes. */
  async request(url, options = {}) {
    const { expect = [], retries = this.retries } = options;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) {
        const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
        log.debug(`retry ${attempt}/${retries} after ${backoff}ms: ${url}`);
        await delay(backoff);
      }

      try {
        const res = await this.#once(url, options);
        const ok = (res.status >= 200 && res.status < 300) || expect.includes(res.status);
        if (ok) return res;

        const body = await drainText(res.stream).catch(() => '');
        const err = new HttpError(res.status, url, body);
        if (!isRetryableStatus(res.status)) throw err;
        lastError = err;
      } catch (err) {
        if (err instanceof HttpError && !isRetryableStatus(err.status)) throw err;
        lastError = err;
      }
    }

    throw lastError ?? new Error(`Request failed: ${url}`);
  }

  async text(url, options = {}) {
    const res = await this.request(url, options);
    return drainText(res.stream);
  }

  async json(url, options = {}) {
    const raw = await this.text(url, {
      ...options,
      headers: { accept: 'application/json', ...(options.headers ?? {}) },
    });
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid JSON from ${url}: ${raw.slice(0, 300)}`);
    }
  }

  async postJson(url, payload, options = {}) {
    return this.json(url, {
      ...options,
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
  }

  /** HEAD-like probe using a 1 byte ranged GET; returns total size when known. */
  async probeSize(url, options = {}) {
    const res = await this.request(url, {
      ...options,
      headers: { range: 'bytes=0-0', ...(options.headers ?? {}) },
      expect: [206, 200],
    });
    res.stream.resume();
    const contentRange = res.headers['content-range'];
    if (contentRange) {
      const m = /\/(\d+)\s*$/.exec(String(contentRange));
      if (m) return Number(m[1]);
    }
    const len = Number(res.headers['content-length']);
    return Number.isFinite(len) ? len : 0;
  }
}

export async function drainText(stream) {
  const chunks = [];
  const sink = new PassThrough();
  sink.on('data', (c) => chunks.push(c));
  await pipeline(stream, sink);
  return Buffer.concat(chunks).toString('utf8');
}
