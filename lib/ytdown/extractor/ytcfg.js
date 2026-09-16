import { Reader, Writer, WIRE } from '../proto/wire.js';
import { Buffer } from 'node:buffer';

/**
 * Reads ytcfg / player-response data out of a watch page.
 *
 * YouTube embeds these as JavaScript object literals, so a regex on the whole
 * blob is unreliable. Instead we locate the assignment and walk the braces with
 * a string-aware scanner, which survives nested quotes and escaped characters.
 */
export function extractJsonObject(source, marker) {
  const at = source.indexOf(marker);
  if (at === -1) return null;

  const start = source.indexOf('{', at);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const raw = source.slice(start, i + 1);
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export function extractPlayerResponse(html) {
  return (
    extractJsonObject(html, 'var ytInitialPlayerResponse =') ??
    extractJsonObject(html, 'ytInitialPlayerResponse =') ??
    extractJsonObject(html, 'ytInitialPlayerResponse')
  );
}

export function extractYtcfg(html) {
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(html)?.[1] ?? null;
  const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(html)?.[1] ?? null;
  const visitorData = /"visitorData":"([^"]+)"/.exec(html)?.[1] ?? null;
  const jsUrl = /"jsUrl":"([^"]+\/base\.js)"/.exec(html)?.[1] ?? /"jsUrl":"([^"]+)"/.exec(html)?.[1]?? null;
  const idToken = /"ID_TOKEN":"([^"]+)"/.exec(html)?.[1] ?? null;
  const sessionIndex = /"SESSION_INDEX":"?(\d+)"?/.exec(html)?.[1] ?? '0';
  const datasyncId = /"DATASYNC_ID":"([^"]+)"/.exec(html)?.[1] ?? null;

  return {
    apiKey,
    clientVersion,
    visitorData: visitorData ? decodeEscapes(visitorData) : null,
    jsUrl: jsUrl ? decodeEscapes(jsUrl) : null,
    idToken,
    sessionIndex,
    datasyncId,
  };
}

function decodeEscapes(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  ).replace(/\\\//g, '/');
}

/**
 * visitorData is a base64url protobuf: `{ 1: visitorId, 5: timestamp, 6: {...} }`.
 * Regenerating one locally lets us open a session without scraping first, and
 * lets us pin a stable identity across the player and SABR requests.
 */
export function generateVisitorData() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let id = '';
  for (let i = 0; i < 11; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  const w = new Writer();
  w.string(1, id);
  w.uint(5, Math.floor(Date.now() / 1000));
  w.message(6, (m) => {
    m.message(1, (c) => {
      c.string(1, 'US');
    });
    m.message(2, (c) => {
      c.string(2, '');
    });
  });

  return w.finish().toString('base64url');
}

export function parseVisitorData(value) {
  try {
    const buf = Buffer.from(value, 'base64url');
    const r = new Reader(buf);
    const out = { id: null, timestamp: null };
    for (const { field, wire } of r.tags()) {
      if (field === 1 && wire === WIRE.LENGTH) out.id = r.bytes().toString('utf8');
      else if (field === 5 && wire === WIRE.VARINT) out.timestamp = Number(r.varint());
      else r.skip(wire);
    }
    return out;
  } catch {
    return null;
  }
}
