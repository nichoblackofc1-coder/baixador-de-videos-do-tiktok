import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { log } from '../util/logger.js';

/**
 * Minimal Chrome DevTools Protocol client.
 *
 * Node 22 ships a global WebSocket, so driving a locally installed Chrome needs
 * no third-party package. This keeps the project dependency-free while still
 * giving us a genuine browser realm, which is the one thing attestation
 * actually requires.
 */

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export async function findChrome() {
  for (const candidate of CHROME_PATHS) {
    try {
      await fsp.access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export class CdpError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CdpError';
  }
}

export class Browser {
  #process = null;
  #ws = null;
  #nextId = 1;
  #pending = new Map();
  #userDataDir = null;
  #usedInitialTab = false;

  constructor({ binary, headless = false, port = 0, callTimeout = 900_000 } = {}) {
    this.binary = binary;
    this.headless = headless;
    this.port = port;
    // Capture drives long playback and drains large payloads, so the ceiling has
    // to accommodate a whole video rather than a typical UI interaction.
    this.callTimeout = callTimeout;
  }

  static async launch(options = {}) {
    const binary = options.binary ?? (await findChrome());
    if (!binary) throw new CdpError('no Chrome or Edge installation was found');
    const browser = new Browser({ ...options, binary });
    await browser.#start(options.startUrl ?? 'about:blank');
    return browser;
  }

  async #start(startUrl) {
    this.#userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytw-cdp-'));
    const port = this.port || 9222 + Math.floor(Math.random() * 1000);

    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${this.#userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      // A stray profile can still pull in component extensions, which have been
      // observed failing the first navigation with chrome-error://chromewebdata.
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-popup-blocking',
      // Background tabs get their timers throttled, which stalls playback-driven
      // fetching the moment the window loses focus.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      '--no-sandbox',
      /*
       * A system proxy configured for the interactive user is frequently not
       * usable from a fresh profile, and Chrome then fails every navigation with
       * net::ERR_PROXY_CONNECTION_FAILED — which surfaces as a blank
       * chrome-error page and looks indistinguishable from being blocked.
       * Node's own requests do not go through it, so bypass it here too and keep
       * both transports on the same path.
       */
      '--no-proxy-server',
      startUrl,
    ];
    // Headless is deliberately not the default: YouTube stops feeding media to a
    // headless browser after about a minute, while the same machine driving a
    // visible window streams a full-length video without interruption.
    if (this.headless) args.unshift('--headless=new');

    log.debug(`launching ${this.binary} on port ${port}`);
    this.#process = spawn(this.binary, args, { stdio: 'ignore', detached: false });
    this.#process.on('error', (err) => log.debug(`browser process error: ${err.message}`));

    const wsUrl = await this.#waitForEndpoint(port);
    await this.#connect(wsUrl);
  }

  async #waitForEndpoint(port, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const info = await res.json();
          if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl;
        }
      } catch {
        /* not up yet */
      }
      await delay(150);
    }
    throw new CdpError('the browser never exposed a debugging endpoint');
  }

  #connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.#ws = ws;

      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new CdpError('CDP websocket failed')));
      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        // Events carry no id; hand them to the listener if one is installed.
        if (msg.id == null) {
          this.onEvent?.(msg);
          return;
        }

        const entry = this.#pending.get(msg.id);
        if (!entry) return;
        this.#pending.delete(msg.id);
        if (msg.error) entry.reject(new CdpError(`${msg.error.message} (${msg.error.code})`));
        else entry.resolve(msg.result);
      });
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`CDP call ${method} timed out`));
      }, this.callTimeout);

      this.#pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.#ws.send(JSON.stringify(payload));
    });
  }

  /**
   * Open a tab at `url` and return a session handle for evaluating code in it.
   *
   * The tab Chrome opened at launch is reused when it is already showing the
   * requested page: a `Target.createTarget` navigation issued moments after
   * launch frequently fails with `chrome-error://chromewebdata`. Matching on URL
   * matters — Chrome also keeps a blank tab around, and attaching to that gives a
   * session that silently evaluates against `about:blank`.
   */
  async newPage(url) {
    // Attach to the tab Chrome opened at launch rather than creating a second
    // one, then navigate it. Creating a target moments after launch frequently
    // lands on chrome-error://chromewebdata; navigating an attached tab does not.
    if (!this.#usedInitialTab) {
      this.#usedInitialTab = true;
      const { targetInfos } = await this.send('Target.getTargets', {});
      const existing = (targetInfos ?? []).find((t) => t.type === 'page');

      if (existing) {
        const { sessionId } = await this.send('Target.attachToTarget', {
          targetId: existing.targetId,
          flatten: true,
        });
        const page = new Page(this, sessionId, existing.targetId, url);
        await page.send('Page.enable', {}).catch(() => {});
        await page.send('Page.navigate', { url });
        return page;
      }
    }

    const { targetId } = await this.send('Target.createTarget', { url });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    return new Page(this, sessionId, targetId, url);
  }

  async close() {
    try {
      this.#ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.#process?.kill();
    } catch {
      /* ignore */
    }
    if (this.#userDataDir) {
      await fsp.rm(this.#userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export class Page {
  constructor(browser, sessionId, targetId, url = null) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
    // Remembered so a failed navigation can be retried against the real target
    // rather than against the bare origin.
    this.url = url;
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  /** Evaluate an async expression and return its resolved value. */
  async evaluate(expression, { timeout = 60_000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout,
      userGesture: true,
    });

    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'evaluation failed';
      throw new CdpError(text.split('\n')[0]);
    }
    return result.result?.value;
  }

  /**
   * Wait until the page has actually committed a document on `expectedOrigin`.
   * `Target.createTarget` resolves as soon as the tab exists, so without this a
   * script can run against an empty about:blank document and fail confusingly.
   */
  /**
   * Wait until the page has actually committed a document on `expectedOrigin`.
   *
   * `Target.createTarget` resolves as soon as the tab exists, so without this a
   * script can run against an empty about:blank document. A cold browser also
   * fails its first navigation often enough to matter, landing on
   * `chrome-error://chromewebdata/`; that is retried rather than waited out.
   */
  async waitForOrigin(expectedOrigin, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    const target = this.url ?? expectedOrigin;
    let lastSeen = null;
    let retried = false;

    /*
     * The target list reports the destination URL as soon as the navigation is
     * requested, but the page's execution context can still be the launch-time
     * about:blank for a while afterwards. Evaluating in that window returns
     * `about:blank` and, on a cold start, sometimes a transient
     * chrome-error document. So this polls the context the code will actually
     * run in, and retries a genuinely failed navigation once.
     */
    while (Date.now() < deadline) {
      const state = await this.evaluate(
        'JSON.stringify({ href: location.href, origin: location.origin, ready: document.readyState })',
      ).catch(() => null);

      if (state) {
        const { href, origin, ready } = JSON.parse(state);
        lastSeen = href ?? origin;

        if (origin === expectedOrigin && (ready === 'complete' || ready === 'interactive')) {
          return;
        }

        if (String(href ?? '').startsWith('chrome-error://') && !retried) {
          retried = true;
          await this.send('Page.navigate', { url: target }).catch(() => {});
        }
      }
      await delay(250);
    }

    throw new CdpError(
      `page never committed a document on ${expectedOrigin} (last saw: ${lastSeen ?? 'unknown'})`,
    );
  }

  async waitForLoad(timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.evaluate('document.readyState').catch(() => null);
      if (state === 'complete' || state === 'interactive') return;
      await delay(150);
    }
  }

  async close() {
    await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
  }
}
