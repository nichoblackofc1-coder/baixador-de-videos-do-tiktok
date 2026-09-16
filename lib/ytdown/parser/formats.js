/**
 * Format metadata and selection.
 *
 * InnerTube returns `adaptiveFormats` (single-track DASH style) and sometimes
 * `formats` (muxed progressive). We normalise both into one shape so callers
 * do not care which list a format came from.
 */

const QUALITY_ORDER = [
  '144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p', '4320p',
];

const CODEC_PREFERENCE = {
  video: ['av01', 'vp9', 'vp09', 'avc1'],
  audio: ['opus', 'mp4a', 'ac-3', 'ec-3'],
};

export function parseMimeType(mimeType) {
  const m = /^([^;]+)(?:;\s*codecs="([^"]*)")?/.exec(mimeType ?? '');
  const full = m?.[1] ?? '';
  const [type, container] = full.split('/');
  const codecs = (m?.[2] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  return { type, container, codecs, mimeType };
}

export function normalizeFormat(raw, { source = 'adaptive' } = {}) {
  const { type, container, codecs } = parseMimeType(raw.mimeType);
  const hasVideo = Boolean(raw.width || raw.height || type === 'video');
  const hasAudio = type === 'audio' || source === 'muxed';

  return {
    itag: raw.itag,
    source,
    mimeType: raw.mimeType ?? null,
    container: container ?? null,
    codecs,
    kind: type === 'audio' ? 'audio' : 'video',
    muxed: source === 'muxed',
    hasVideo,
    hasAudio,
    width: raw.width ?? null,
    height: raw.height ?? null,
    fps: raw.fps ?? null,
    qualityLabel: raw.qualityLabel ?? null,
    quality: raw.quality ?? null,
    bitrate: raw.bitrate ?? null,
    averageBitrate: raw.averageBitrate ?? null,
    audioQuality: raw.audioQuality ?? null,
    audioSampleRate: raw.audioSampleRate ? Number(raw.audioSampleRate) : null,
    audioChannels: raw.audioChannels ?? null,
    loudnessDb: raw.loudnessDb ?? null,
    contentLength: raw.contentLength ? Number(raw.contentLength) : null,
    approxDurationMs: raw.approxDurationMs ? Number(raw.approxDurationMs) : null,
    lastModified: raw.lastModified ?? null,
    // Several itags appear more than once, distinguished only by xtags (DRC and
    // alternate-mix variants). Dropping it makes the FormatId ambiguous and the
    // SABR server answers `sabr.no_audio_selected`.
    xtags: raw.xtags ?? null,
    initRange: raw.initRange ?? null,
    indexRange: raw.indexRange ?? null,
    isDrc: Boolean(raw.isDrc),
    isVb: Boolean(raw.isVb),
    audioTrackId: raw.audioTrack?.id ?? null,
    // Present only on legacy responses; SABR-only responses omit both.
    url: raw.url ?? null,
    signatureCipher: raw.signatureCipher ?? raw.cipher ?? null,
  };
}

export function collectFormats(streamingData) {
  const out = [];
  for (const f of streamingData?.formats ?? []) out.push(normalizeFormat(f, { source: 'muxed' }));
  for (const f of streamingData?.adaptiveFormats ?? []) out.push(normalizeFormat(f, { source: 'adaptive' }));
  return out;
}

function qualityRank(format) {
  if (format.height) return format.height;
  const label = format.qualityLabel ?? '';
  const idx = QUALITY_ORDER.findIndex((q) => label.startsWith(q));
  return idx === -1 ? 0 : (idx + 1) * 100;
}

function codecRank(format) {
  const list = CODEC_PREFERENCE[format.kind] ?? [];
  const codec = format.codecs[0] ?? '';
  const idx = list.findIndex((c) => codec.startsWith(c));
  return idx === -1 ? list.length : idx;
}

/**
 * Highest quality video track.
 *
 * Ordered by resolution, then frame rate, then codec preference, then bitrate.
 * DRC (dynamic range compressed) variants are deprioritised because they are
 * alternate renditions rather than higher quality.
 */
export function selectBestVideo(formats, { maxHeight = null, preferCodec = null } = {}) {
  const candidates = formats.filter((f) => f.hasVideo && !f.muxed);
  if (candidates.length === 0) return null;

  const eligible = maxHeight
    ? candidates.filter((f) => (f.height ?? 0) <= maxHeight)
    : candidates;
  const pool = eligible.length ? eligible : candidates;

  return [...pool].sort((a, b) => {
    if (preferCodec) {
      const am = a.codecs[0]?.startsWith(preferCodec) ? 0 : 1;
      const bm = b.codecs[0]?.startsWith(preferCodec) ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    const q = qualityRank(b) - qualityRank(a);
    if (q !== 0) return q;
    const fps = (b.fps ?? 0) - (a.fps ?? 0);
    if (fps !== 0) return fps;
    const codec = codecRank(a) - codecRank(b);
    if (codec !== 0) return codec;
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  })[0];
}

/**
 * Highest quality audio track.
 *
 * Prefers the plain rendition: DRC (dynamic range compressed) and `vb`
 * (alternate mix) variants share an itag with the original and are alternate
 * renditions rather than higher quality. Stereo is preferred over 5.1 because
 * multichannel itags are frequently not selectable over SABR.
 */
export function selectBestAudio(formats, { preferCodec = null, allowSurround = false } = {}) {
  const candidates = formats.filter((f) => f.kind === 'audio' && !f.muxed);
  if (candidates.length === 0) return null;

  const plain = candidates.filter((f) => !f.isDrc && !f.isVb);
  const pool = plain.length ? plain : candidates;
  const stereo = pool.filter((f) => (f.audioChannels ?? 2) <= 2);
  const finalPool = !allowSurround && stereo.length ? stereo : pool;

  return [...finalPool].sort((a, b) => {
    if (preferCodec) {
      const am = a.codecs[0]?.startsWith(preferCodec) ? 0 : 1;
      const bm = b.codecs[0]?.startsWith(preferCodec) ? 0 : 1;
      if (am !== bm) return am - bm;
    }
    return (b.bitrate ?? 0) - (a.bitrate ?? 0);
  })[0];
}

export function describeFormat(f) {
  const bits = [`itag ${String(f.itag).padEnd(4)}`, (f.container ?? '?').padEnd(5)];
  if (f.kind === 'video') {
    bits.push((f.qualityLabel ?? `${f.height ?? '?'}p`).padEnd(7));
    bits.push(`${f.fps ?? '?'}fps`.padEnd(6));
  } else {
    bits.push((f.audioQuality?.replace('AUDIO_QUALITY_', '').toLowerCase() ?? 'audio').padEnd(7));
    bits.push(`${f.audioChannels ?? '?'}ch`.padEnd(6));
  }
  bits.push((f.codecs[0] ?? '?').padEnd(12));
  bits.push(f.bitrate ? `${Math.round(f.bitrate / 1000)}kbps` : '');
  if (f.isDrc) bits.push('[drc]');
  return bits.join(' ');
}
