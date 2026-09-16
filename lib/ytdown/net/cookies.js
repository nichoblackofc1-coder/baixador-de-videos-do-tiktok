/**
 * Minimal cookie jar. YouTube hands out VISITOR_INFO1_LIVE / YSC / __Secure-*
 * on the first watch-page hit; replaying them keeps the session coherent and
 * avoids the consent interstitial and bot checks on subsequent requests.
 */
export class CookieJar {
  #store = new Map();

  constructor(initial = []) {
    for (const raw of initial) this.setFromHeader(raw);
  }

  setFromHeader(header) {
    if (!header) return;
    const [pair] = String(header).split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) return;
    if (value === '' || value === 'EXPIRED') {
      this.#store.delete(name);
      return;
    }
    this.#store.set(name, value);
  }

  absorb(setCookieHeaders) {
    if (!setCookieHeaders) return;
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const c of list) this.setFromHeader(c);
  }

  set(name, value) {
    this.#store.set(name, value);
  }

  get(name) {
    return this.#store.get(name);
  }

  header() {
    if (this.#store.size === 0) return '';
    return [...this.#store].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toJSON() {
    return Object.fromEntries(this.#store);
  }
}
