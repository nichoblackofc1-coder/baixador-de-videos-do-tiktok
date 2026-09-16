export const ORIGIN = 'https://www.youtube-nocookie.com';
export const INNERTUBE_API_PATH = '/youtubei/v1';
export const FALLBACK_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
export const FALLBACK_CLIENT_VERSION = '2.20250312.04.00';
export const USER_AGENT ='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' + 'Chrome/133.0.0.0 Safari/537.36';
export const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
export const CLIENT = {
  NAME: 'WEB',
  ID: 1,
  SCREEN: 'WATCH_FULL_SCREEN',
  BROWSER_NAME: 'Chrome',
  BROWSER_VERSION: '133.0.0.0',
  OS_NAME: 'Windows',
  OS_VERSION: '10.0',
  PLATFORM: 'DESKTOP',
  DEVICE_MAKE: '',
  DEVICE_MODEL: '',
};

export const BROWSER_HEADERS = {
  'user-agent': USER_AGENT,
  'accept-language': ACCEPT_LANGUAGE,
  'accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'sec-ch-ua': '"Chromium";v="133", "Not(A:Brand";v="24", "Google Chrome";v="133"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
};

// Cookie that opts the session out of the EU consent interstitial.
export const CONSENT_COOKIE = 'SOCS=CAI';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 4;
// Size of each ranged GET when pulling a media stream. YouTube throttles single
// long-lived connections hard; many medium requests are dramatically faster.
export const CHUNK_SIZE = 1024 * 1024 * 8;
