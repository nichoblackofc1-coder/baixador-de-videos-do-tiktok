import vm from 'node:vm';

/**
 * Browser shims sufficient to evaluate YouTube's player bundle.
 *
 * base.js is wrapped as `var _yt_player={};(function(g){var window=this; ...`
 * and executed with `this` bound to a window-like object. It touches a fair
 * amount of DOM surface during definition, so we provide inert stand-ins:
 * enough for the module to finish defining itself, and nothing more. No
 * network, no filesystem, no timers that outlive the call.
 */

function noop() {}

function fakeElement(tag = 'div') {
  const el = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, contains: () => false, toggle: noop },
    children: [],
    childNodes: [],
    attributes: {},
    innerHTML: '',
    textContent: '',
    value: '',
    appendChild: (c) => c,
    removeChild: (c) => c,
    insertBefore: (c) => c,
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    },
    getAttribute(k) {
      return this.attributes[k] ?? null;
    },
    removeAttribute(k) {
      delete this.attributes[k];
    },
    hasAttribute(k) {
      return k in this.attributes;
    },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
    getContext: () => null,
    cloneNode: () => fakeElement(tag),
    contains: () => false,
    focus: noop,
    blur: noop,
    click: noop,
    play: () => Promise.resolve(),
    pause: noop,
    load: noop,
    canPlayType: () => '',
    remove: noop,
    ownerDocument: null,
    parentNode: null,
    firstChild: null,
    lastChild: null,
    nextSibling: null,
  };
  return el;
}

export function createBrowserContext({ href = 'https://www.youtube.com/' } = {}) {
  const documentElement = fakeElement('html');
  const body = fakeElement('body');
  const head = fakeElement('head');

  const document = {
    nodeType: 9,
    documentElement,
    body,
    head,
    cookie: '',
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    title: '',
    referrer: '',
    URL: href,
    domain: 'www.youtube.com',
    location: null,
    createElement: (tag) => fakeElement(tag),
    createElementNS: (_ns, tag) => fakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => fakeElement('fragment'),
    getElementById: () => null,
    getElementsByTagName: () => [],
    getElementsByClassName: () => [],
    getElementsByName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    createEvent: () => ({ initEvent: noop }),
    write: noop,
    writeln: noop,
    open: noop,
    close: noop,
    execCommand: () => false,
    hasFocus: () => true,
    elementFromPoint: () => null,
  };

  const location = {
    href,
    protocol: 'https:',
    host: 'www.youtube.com',
    hostname: 'www.youtube.com',
    port: '',
    pathname: new URL(href).pathname,
    search: new URL(href).search,
    hash: '',
    origin: 'https://www.youtube.com',
    assign: noop,
    replace: noop,
    reload: noop,
    toString: () => href,
  };
  document.location = location;

  const navigator = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    appVersion: '5.0 (Windows NT 10.0; Win64; x64)',
    appName: 'Netscape',
    appCodeName: 'Mozilla',
    platform: 'Win32',
    product: 'Gecko',
    productSub: '20030107',
    vendor: 'Google Inc.',
    vendorSub: '',
    language: 'en-US',
    languages: ['en-US', 'en'],
    onLine: true,
    cookieEnabled: true,
    doNotTrack: null,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    pdfViewerEnabled: true,
    webdriver: false,
    plugins: { length: 0, item: () => null, namedItem: () => null, refresh: noop },
    mimeTypes: { length: 0, item: () => null, namedItem: () => null },
    mediaCapabilities: { decodingInfo: () => Promise.resolve({ supported: true, smooth: true, powerEfficient: true }) },
    mediaDevices: { enumerateDevices: () => Promise.resolve([]) },
    permissions: { query: () => Promise.resolve({ state: 'prompt' }) },
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, addEventListener: noop },
    sendBeacon: () => true,
    javaEnabled: () => false,
    getBattery: () => Promise.resolve({ charging: true, level: 1 }),
    requestMediaKeySystemAccess: () => Promise.reject(new Error('unsupported')),
    userAgentData: {
      brands: [
        { brand: 'Chromium', version: '133' },
        { brand: 'Google Chrome', version: '133' },
      ],
      mobile: false,
      platform: 'Windows',
      getHighEntropyValues: () => Promise.resolve({}),
    },
    clipboard: { writeText: () => Promise.resolve() },
    storage: { estimate: () => Promise.resolve({ quota: 1e9, usage: 0 }) },
  };

  const screen = {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: 'landscape-primary', angle: 0, addEventListener: noop },
  };

  const storage = () => {
    const map = new Map();
    return {
      get length() {
        return map.size;
      },
      getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
      setItem: (k, v) => void map.set(String(k), String(v)),
      removeItem: (k) => void map.delete(String(k)),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
    };
  };

  const performanceEntries = [];
  const performance = {
    now: () => Date.now() - 1_000,
    timeOrigin: Date.now() - 1_000,
    timing: {
      navigationStart: Date.now() - 5_000,
      loadEventEnd: Date.now() - 1_000,
      domainLookupStart: Date.now() - 4_900,
      domainLookupEnd: Date.now() - 4_800,
      connectStart: Date.now() - 4_800,
      connectEnd: Date.now() - 4_700,
      requestStart: Date.now() - 4_700,
      responseStart: Date.now() - 4_500,
      responseEnd: Date.now() - 4_400,
    },
    navigation: { type: 0, redirectCount: 0 },
    memory: { jsHeapSizeLimit: 2 ** 32, totalJSHeapSize: 1e7, usedJSHeapSize: 5e6 },
    mark: noop,
    measure: noop,
    clearMarks: noop,
    clearMeasures: noop,
    getEntries: () => performanceEntries,
    getEntriesByType: () => performanceEntries,
    getEntriesByName: () => performanceEntries,
    setResourceTimingBufferSize: noop,
    addEventListener: noop,
  };

  class FakeXHR {
    constructor() {
      this.readyState = 0;
      this.status = 0;
      this.responseText = '';
      this.response = '';
      this.onreadystatechange = null;
      this.onload = null;
      this.onerror = null;
    }
    open() {
      this.readyState = 1;
    }
    setRequestHeader() {}
    getResponseHeader() {
      return null;
    }
    getAllResponseHeaders() {
      return '';
    }
    overrideMimeType() {}
    send() {
      this.readyState = 4;
      this.status = 0;
      this.onerror?.(new Error('network disabled in sandbox'));
      this.onreadystatechange?.();
    }
    abort() {}
    addEventListener() {}
    removeEventListener() {}
  }

  const sandbox = {
    // Bare-minimum globals the bundle expects to exist.
    document,
    location,
    navigator,
    screen,
    performance,
    history: { length: 1, state: null, pushState: noop, replaceState: noop, go: noop, back: noop, forward: noop },
    localStorage: storage(),
    sessionStorage: storage(),
    XMLHttpRequest: FakeXHR,
    fetch: () => Promise.reject(new Error('network disabled in sandbox')),
    WebSocket: class {
      constructor() {
        this.readyState = 3;
      }
      send() {}
      close() {}
      addEventListener() {}
    },
    Worker: class {
      constructor() {}
      postMessage() {}
      terminate() {}
      addEventListener() {}
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    matchMedia: () => ({ matches: false, media: '', addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    requestIdleCallback: (fn) => setTimeout(() => fn({ timeRemaining: () => 0, didTimeout: true }), 1),
    cancelIdleCallback: (id) => clearTimeout(id),
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone: (v) => JSON.parse(JSON.stringify(v)),
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: () => true,
    postMessage: noop,
    open: () => null,
    close: noop,
    focus: noop,
    blur: noop,
    alert: noop,
    confirm: () => false,
    prompt: () => null,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Blob: class {
      constructor(parts = []) {
        this.size = parts.reduce((n, p) => n + String(p).length, 0);
        this.type = '';
      }
      slice() {
        return new this.constructor([]);
      }
      text() {
        return Promise.resolve('');
      }
      arrayBuffer() {
        return Promise.resolve(new ArrayBuffer(0));
      }
    },
    FileReader: class {
      readAsText() {}
      readAsArrayBuffer() {}
      addEventListener() {}
    },
    Event: class {
      constructor(type) {
        this.type = type;
      }
      preventDefault() {}
      stopPropagation() {}
    },
    CustomEvent: class {
      constructor(type, opts = {}) {
        this.type = type;
        this.detail = opts.detail;
      }
      preventDefault() {}
      stopPropagation() {}
    },
    DOMParser: class {
      parseFromString() {
        return document;
      }
    },
    crypto: {
      getRandomValues: (arr) => {
        for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
      randomUUID: () =>
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        }),
      subtle: {},
    },
    console: { log: noop, warn: noop, error: noop, info: noop, debug: noop, trace: noop, group: noop, groupEnd: noop, time: noop, timeEnd: noop, assert: noop, dir: noop },
    Intl,
    // The bundle probes IndexedDB during startup and throws if it is absent.
    indexedDB: {
      open: () => ({ addEventListener: noop, removeEventListener: noop, result: null, error: null }),
      deleteDatabase: () => ({ addEventListener: noop, removeEventListener: noop }),
      databases: () => Promise.resolve([]),
      cmp: () => 0,
    },
    IDBKeyRange: {
      bound: () => ({}),
      only: () => ({}),
      lowerBound: () => ({}),
      upperBound: () => ({}),
    },
    IDBDatabase: class {},
    IDBTransaction: class {},
    IDBRequest: class {},
    IDBIndex: class {},
    IDBCursor: class {},
    IDBObjectStore: class {},
    // BotGuard's interpreter builds its bytecode dispatcher with indirect eval
    // and probes for the Trusted Types policy factory before doing so.
    trustedTypes: {
      createPolicy: (name, rules) => ({
        name,
        createHTML: (s) => (rules?.createHTML ? rules.createHTML(s) : s),
        createScript: (s) => (rules?.createScript ? rules.createScript(s) : s),
        createScriptURL: (s) => (rules?.createScriptURL ? rules.createScriptURL(s) : s),
      }),
      defaultPolicy: null,
      emptyHTML: '',
      emptyScript: '',
      isHTML: () => false,
      isScript: () => false,
      isScriptURL: () => false,
    },
    // The bundle checks for these to decide code paths; presence is enough.
    MediaSource: class {
      static isTypeSupported() {
        return true;
      }
      addEventListener() {}
    },
    HTMLMediaElement: class {},
    HTMLVideoElement: class {},
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    outerWidth: 1920,
    outerHeight: 1080,
    screenX: 0,
    screenY: 0,
    scrollX: 0,
    scrollY: 0,
    pageXOffset: 0,
    pageYOffset: 0,
    origin: 'https://www.youtube.com',
    isSecureContext: true,
    top: null,
    parent: null,
    self: null,
    frames: null,
    closed: false,
    name: '',
    onerror: null,
    Promise,
    Symbol,
    Reflect,
    Proxy,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Array,
    Object,
    JSON,
    Math,
    Date,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    Function,
    String,
    Number,
    Boolean,
    BigInt,
    Uint8Array,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    DataView,
    Buffer,
    process: undefined,
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  documentElement.ownerDocument = document;
  body.ownerDocument = document;

  return sandbox;
}

/**
 * Evaluate the player bundle and hand back its namespace object.
 * The bundle assigns everything onto `_yt_player`.
 */
export function loadPlayerBundle(source, { timeout = 30_000 } = {}) {
  const sandbox = createBrowserContext();
  const context = vm.createContext(sandbox);

  // The bundle is an IIFE invoked with `this` = window; run it as-is.
  vm.runInContext(source, context, { timeout, filename: 'base.js' });

  return {
    sandbox,
    context,
    namespace: sandbox._yt_player ?? {},
  };
}
