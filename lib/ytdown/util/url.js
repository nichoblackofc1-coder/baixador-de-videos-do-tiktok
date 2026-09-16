/**
 * Pull the 11 character video id out of anything a user is likely to paste:
 * watch URLs, youtu.be links, shorts, embeds, live, or a bare id.
 */
export function parseVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();

  if (/^[\w-]{11}$/.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\.|^m\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;

  const v = url.searchParams.get('v');
  if (v && /^[\w-]{11}$/.test(v)) return v;

  const segments = url.pathname.split('/').filter(Boolean);
  const prefixes = new Set(['embed', 'shorts', 'live', 'v', 'e']);
  if (segments.length >= 2 && prefixes.has(segments[0])) {
    const id = segments[1];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }

  return null;
}

/** Parse an `application/x-www-form-urlencoded` blob into a plain object. */
export function parseQueryString(input) {
  const out = Object.create(null);
  if (!input) return out;
  for (const pair of String(input).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    out[decodeURIComponent(key.replace(/\+/g, ' '))] = decodeURIComponent(
      value.replace(/\+/g, ' '),
    );
  }
  return out;
}

export function watchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}&bpctr=9999999999&has_verified=1`;
}
