import process from 'node:process';

import { Downloader } from './download/downloader.js';
import { selectBestVideo, selectBestAudio } from './parser/formats.js';
import { exportSession } from './attest/session.js';
import { parseVideoId } from './util/url.js';

/**
 * The friendly, one-liner surface of the package.
 *
 * Everything here is a thin wrapper over `Downloader`. It exists so a caller
 * can `import YTdownload from 'ytdown'` and get straight to downloading, while
 * the low-level named exports in `index.js` stay available for power users.
 */

/**
 * Metadata for a video: title, author, duration, and the offered formats.
 *
 * @returns {Promise<Object>} `{ videoId, title, author, durationSeconds,
 *   viewCount, publishDate, isLive, thumbnails, formats, bestVideo, bestAudio }`
 */
export async function info(input) {
  const downloader = new Downloader();
  const { videoId, info: meta } = await downloader.resolve(input);
  return {
    videoId,
    title: meta.title,
    author: meta.author,
    channelId: meta.channelId,
    durationSeconds: meta.durationSeconds,
    viewCount: meta.viewCount,
    publishDate: meta.publishDate,
    isLive: meta.isLive,
    thumbnails: meta.thumbnails,
    formats: meta.formats,
    bestVideo: selectBestVideo(meta.formats),
    bestAudio: selectBestAudio(meta.formats),
  };
}

/**
 * Every format the video offers, as normalised objects carrying the fields you
 * need to pick one: `itag`, `kind` (`'video' | 'audio'`), `muxed`, `height`,
 * `qualityLabel`, `codecs`, `bitrate`, `contentLength`, and more.
 *
 * @returns {Promise<Array>} the normalised format list, e.g. to find an itag.
 */
export async function formats(input) {
  const downloader = new Downloader();
  const { info: meta } = await downloader.resolve(input);
  return meta.formats;
}

/**
 * The full resolved payload as JSON: metadata plus every media URL, already
 * `n`-transformed so each one is directly usable by curl, ffmpeg or a player.
 *
 * Alias of `describe`.
 *
 * @returns {Promise<Object>} the `describe()` shape.
 */
export async function json(input) {
  return new Downloader().describe(input);
}

/** Alias of `json`. */
export async function describe(input) {
  return new Downloader().describe(input);
}

/**
 * Download a video.
 *
 * @param {string} input  a watch URL, `youtu.be` link, shorts link, embed, or
 *   a bare eleven-character video id.
 * @param {object} [options]
 * @param {'best'|'audio'|string} [options.quality='best']  `'best'`, `'audio'`,
 *   or a maximum height such as `'1080'` or `'720'`.
 * @param {number} [options.itag]  download a specific format by itag instead of
 *   ranking by quality.
 * @param {boolean} [options.audioOnly=false]  only the audio track.
 * @param {boolean} [options.videoOnly=false]  only the video track.
 * @param {boolean} [options.mp3=false]  with `audioOnly`, transcode to mp3.
 * @param {string} [options.outputDir]  output directory (default: cwd).
 * @param {string} [options.outputPath]  exact output file path.
 * @param {string} [options.container]  force output container (`mp4` | `webm` | `mkv`).
 * @param {boolean} [options.keepTracks=false]  also keep the separate video/audio files.
 * @param {'auto'|'progressive'|'direct'|'session'|'playback'} [options.transport='auto']
 * @param {number} [options.rate=16]  playback capture speed multiplier.
 * @param {boolean} [options.headless=false]  run the session browser headless.
 * @param {boolean} [options.attest=true]  mint a PO token.
 * @param {string} [options.ffmpegPath]  path to the ffmpeg binary.
 * @param {Function} [options.onProgress]  progress callback `({ bytes, bufferedMs, durationMs })`.
 * @returns {Promise<Object>} `{ path, info, tracks }` — `path` is the saved file
 *   (or `null` with `videoPath`/`audioPath` when ffmpeg is unavailable).
 */
export async function down(input, options = {}) {
  const {
    quality = 'best',
    audioOnly = false,
    videoOnly = false,
    mp3 = false,
    itag = null,
    outputDir = process.cwd(),
    outputPath = null,
    keepTracks = false,
    onProgress = null,
    container = null,
    attest = true,
    headless = false,
    transport = 'auto',
    rate = 16,
    ffmpegPath = null,
    // Friendly aliases matching the CLI flag names.
    output = null,
    file = null,
  } = options;

  const downloader = new Downloader({ outputDir: output ?? outputDir, ffmpegPath });
  return downloader.download(input, {
    quality,
    audioOnly,
    videoOnly,
    mp3,
    itag,
    outputPath: file ?? outputPath,
    keepTracks,
    onProgress,
    container,
    attest,
    headless,
    transport,
    rate,
  });
}

/**
 * Export a reusable session for a video. Downloading against an exported
 * session (`YTW_SESSION`) needs no browser at all, so a credential minted on
 * one machine can be used on a headless one.
 *
 * @returns {Promise<Object>} the session, ready to `JSON.stringify` and reuse.
 */
export async function session(input, options = {}) {
  const videoId = parseVideoId(input);
  if (!videoId) throw new Error(`could not parse a video id from: ${input}`);
  return exportSession(videoId, { headless: options.headless === true });
}

/**
 * The object a caller gets from `import YTdownload from 'ytdown'`.
 *
 * `YTdownload.down(...)`, `YTdownload.info(...)`, and so on.
 */
const YTdownload = { down, info, formats, json, describe, session };

export default YTdownload;
