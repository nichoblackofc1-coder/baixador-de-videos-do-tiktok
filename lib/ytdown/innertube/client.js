import { HttpClient } from '../net/http.js';
import { CookieJar } from '../net/cookies.js';
import {
  ORIGIN,
  INNERTUBE_API_PATH,
  FALLBACK_API_KEY,
  FALLBACK_CLIENT_VERSION,
  CLIENT,
  CONSENT_COOKIE,
  USER_AGENT,
} from '../config/constants.js';
import { extractYtcfg, extractPlayerResponse, generateVisitorData } from '../extractor/ytcfg.js';
import { watchUrl } from '../util/url.js';
import { log } from '../util/logger.js';

/**
 * The mobile web surface.
 *
 * Still a browser client on youtube.com — no Android or iOS app impersonation —
 * but unlike the desktop surface it is served plain media URLs rather than being
 * restricted to SABR. Those URLs still need the player's `n` transform, after
 * which they answer ranged GETs with no attestation at all.
 */
export const MWEB_CLIENT = {
  NAME: 'MWEB',
  ID: 2,
  VERSION: '2.20260805.01.00',
  PLATFORM: 'MOBILE',
  FORM_FACTOR: 'SMALL_FORM_FACTOR',
  BROWSER_NAME: 'Chrome Mobile',
  BROWSER_VERSION: '133.0.0.0',
  OS_NAME: 'Android',
  OS_VERSION: '13',
  USER_AGENT:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
};

/**
 * InnerTube WEB surface.
 *
 * Everything here impersonates a browser and only a browser: the desktop client
 * by default, and the mobile web client when asked. No ANDROID / iOS / TV client
 * is used anywhere.
 */
export class InnerTube {
  constructor({ http, jar } = {}) {
    this.jar = jar ?? new CookieJar([CONSENT_COOKIE]);
    this.http = http ?? new HttpClient({ jar: this.jar });
    this.apiKey = FALLBACK_API_KEY;
    this.clientVersion = FALLBACK_CLIENT_VERSION;
    this.visitorData = null;
    this.jsUrl = null;
    this.ready = false;
  }

  /** Load a watch page: seeds cookies, api key, client version, visitorData, player js url. */
  async bootstrap(videoId) {
    const url = watchUrl(videoId);
    const html = await this.http.text(url, {
      headers: { 'sec-fetch-site': 'same-origin', referer: `${ORIGIN}/` },
    });

    const cfg = extractYtcfg(html);
    if (cfg.apiKey) this.apiKey = cfg.apiKey;
    if (cfg.clientVersion) this.clientVersion = cfg.clientVersion;
    if (cfg.visitorData) this.visitorData = cfg.visitorData;
    if (cfg.jsUrl) this.jsUrl = new URL(cfg.jsUrl, ORIGIN).toString();
    if (!this.visitorData) this.visitorData = generateVisitorData();

    this.ready = true;
    const embedded = extractPlayerResponse(html);

    log.debug(
      `bootstrap ok client=${this.clientVersion} player=${this.playerId ?? '?'} visitor=${this.visitorData?.slice(0, 12)}`,
    );

    return { html, cfg, embeddedPlayerResponse: embedded };
  }

  get playerId() {
    if (!this.jsUrl) return null;
    return /\/player\/([0-9a-fA-F]{8,})\//.exec(this.jsUrl)?.[1] ?? null;
  }

  context(extra = {}) {
    return {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: CLIENT.NAME,
        clientVersion: this.clientVersion,
        userAgent: `${USER_AGENT},gzip(gfe)`,
        platform: CLIENT.PLATFORM,
        clientFormFactor: 'UNKNOWN_FORM_FACTOR',
        browserName: CLIENT.BROWSER_NAME,
        browserVersion: CLIENT.BROWSER_VERSION,
        osName: CLIENT.OS_NAME,
        osVersion: CLIENT.OS_VERSION,
        screenWidthPoints: 1920,
        screenHeightPoints: 1080,
        screenPixelDensity: 1,
        screenDensityFloat: 1,
        utcOffsetMinutes: 0,
        timeZone: 'UTC',
        ...(this.visitorData ? { visitorData: this.visitorData } : {}),
        ...extra,
      },
      user: { lockedSafetyMode: false },
      request: {
        useSsl: true,
        internalExperimentFlags: [],
        consistencyTokenJars: [],
      },
    };
  }

  /** Context for the mobile web surface, which is served direct media URLs. */
  mobileContext() {
    return {
      client: {
        hl: 'en',
        gl: 'US',
        clientName: MWEB_CLIENT.NAME,
        clientVersion: MWEB_CLIENT.VERSION,
        userAgent: `${MWEB_CLIENT.USER_AGENT},gzip(gfe)`,
        platform: MWEB_CLIENT.PLATFORM,
        clientFormFactor: MWEB_CLIENT.FORM_FACTOR,
        browserName: MWEB_CLIENT.BROWSER_NAME,
        browserVersion: MWEB_CLIENT.BROWSER_VERSION,
        osName: MWEB_CLIENT.OS_NAME,
        osVersion: MWEB_CLIENT.OS_VERSION,
        screenWidthPoints: 412,
        screenHeightPoints: 915,
        screenPixelDensity: 3,
        screenDensityFloat: 2.625,
        utcOffsetMinutes: 0,
        timeZone: 'UTC',
        ...(this.visitorData ? { visitorData: this.visitorData } : {}),
      },
      user: { lockedSafetyMode: false },
      request: {
        useSsl: true,
        internalExperimentFlags: [],
        consistencyTokenJars: [],
      },
    };
  }

  headers(videoId) {
    return {
      'content-type': 'application/json',
      'x-youtube-client-name': String(CLIENT.ID),
      'x-youtube-client-version': this.clientVersion,
      'x-youtube-bootstrap-logged-in': 'false',
      origin: ORIGIN,
      referer: videoId ? watchUrl(videoId) : `${ORIGIN}/`,
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'same-origin',
      'sec-fetch-site': 'same-origin',
      ...(this.visitorData ? { 'x-goog-visitor-id': this.visitorData } : {}),
    };
  }

  /** POST /youtubei/v1/player for a video. `signatureTimestamp` comes from base.js. */
  async player(videoId, { signatureTimestamp = null, poToken = null, mobile = false } = {}) {
    if (!this.ready) await this.bootstrap(videoId);

    const referer = mobile
      ? `https://m.youtube.com/watch?v=${videoId}`
      : watchUrl(videoId);

    const payload = {
      context: mobile ? this.mobileContext() : this.context(),
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: 'HTML5_PREF_WANTS',
          lactMilliseconds: '-1',
          referer,
          currentUrl: `/watch?v=${videoId}`,
          autonavState: 'STATE_NONE',
          splay: false,
          vis: 0,
          ...(signatureTimestamp != null ? { signatureTimestamp } : {}),
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
      ...(poToken ? { serviceIntegrityDimensions: { poToken } } : {}),
    };

    const headers = mobile
      ? {
          ...this.headers(videoId),
          'x-youtube-client-name': String(MWEB_CLIENT.ID),
          'x-youtube-client-version': MWEB_CLIENT.VERSION,
          'user-agent': MWEB_CLIENT.USER_AGENT,
          referer,
        }
      : this.headers(videoId);

    const url = `${ORIGIN}${INNERTUBE_API_PATH}/player?key=${this.apiKey}&prettyPrint=false`;
    return this.http.postJson(url, payload, { headers });
  }

  /** POST /youtubei/v1/next — used for metadata the player response omits. */
  async next(videoId) {
    if (!this.ready) await this.bootstrap(videoId);
    const url = `${ORIGIN}${INNERTUBE_API_PATH}/next?key=${this.apiKey}&prettyPrint=false`;
    return this.http.postJson(
      url,
      { context: this.context(), videoId, contentCheckOk: true, racyCheckOk: true },
      { headers: this.headers(videoId) },
    );
  }
}
