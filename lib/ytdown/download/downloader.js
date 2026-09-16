import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Buffer } from 'node:buffer';

import { HttpClient } from '../net/http.js';
import { InnerTube } from '../innertube/client.js';
import { PlayerScript } from '../extractor/player-script.js';
import { parsePlayerResponse, UnplayableError } from '../parser/player-response.js';
import { normalizeFormat, selectBestVideo, selectBestAudio } from '../parser/formats.js';
import { SabrStream } from '../sabr/stream.js';
import { createAttestedSession } from '../attest/potoken.js';
import { exportSession, loadSession, loadExternalSession } from '../attest/session.js';
import { PlaybackCapture } from '../attest/playback-capture.js';
import { findFfmpeg, mergeTracks } from './ffmpeg.js';
import { ProgressiveDownload } from './progressive.js';
import { ensureDir, sanitizeFilename, uniquePath, removeQuiet } from '../util/fs.js';
import { parseVideoId } from '../util/url.js';
import { log, formatBytes, formatDuration } from '../util/logger.js';

function extensionFor(mimeType, kind) {
  const webm = mimeType?.includes('webm');
  if (kind === 'audio') return webm ? 'weba' : 'm4a';
  return webm ? 'webm' : 'mp4';
}

/*
 * Pick an output container that actually holds both codecs. The mime string is
 * misleading: YouTube labels AV1 as `video/mp4` while its Opus audio is
 * `audio/webm`, so a naive "both say webm?" test drops AV1+Opus into .mp4 —
 * technically legal, but Opus-in-mp4 plays silent on Windows Media Player and
 * many others. Decide from the codecs instead.
 */
function containerFor(videoMime, audioMime) {
  const v = (videoMime ?? '').toLowerCase();
  const a = (audioMime ?? '').toLowerCase();
  const opusOrVorbis = a.includes('opus') || a.includes('vorbis');
  const aac = a.includes('mp4a') || a.includes('aac');
  const av1OrVp9 = v.includes('av01') || v.includes('vp9') || v.includes('vp09') || v.includes('vp8');
  const h264 = v.includes('avc');

  // AAC pairs cleanly with H.264 or AV1 in mp4 — the universally playable case.
  if (aac && (h264 || v.includes('av01'))) return 'mp4';
  // Opus/Vorbis with a webm-native video codec goes to webm.
  if (opusOrVorbis && av1OrVp9) return 'webm';
  // Anything mixed (e.g. H.264 + Opus) only fits in matroska.
  return 'mkv';
}

/**
 * End-to-end pipeline: resolve metadata over InnerTube, pull both tracks over
 * SABR, then mux them into a single playable file.
 */
export class Downloader {
  constructor({ http, outputDir = process.cwd(), ffmpegPath = null } = {}) {
    this.http = http ?? new HttpClient();
    this.outputDir = outputDir;
    this.ffmpegPath = ffmpegPath;
    this.tube = new InnerTube({ http: this.http });
    this.player = null;
    this.poToken = null;
    this.attestedVisitorData = null;
  }

  async resolve(input, { attest = false, headless = true, mobile = true } = {}) {
    const videoId = parseVideoId(input);
    if (!videoId) throw new Error(`could not parse a video id from: ${input}`);

    // Attestation binds the token, the visitor identity and the streaming
    // session together, so the identity has to be established BEFORE /player is
    // called — not minted separately afterwards.
    let poToken = null;
    if (attest) {
      const session = await createAttestedSession({ headless });
      if (session.poToken && session.visitorData) {
        this.poToken = session.poToken;
        this.attestedVisitorData = session.visitorData;
        poToken = session.poToken;
        log.debug(`attested session (${session.cached ? 'cached' : 'fresh'})`);
      } else {
        log.warn(`proceeding unattested: ${session.error ?? 'attestation unavailable'}`);
      }
    }

    await this.tube.bootstrap(videoId);
    if (this.attestedVisitorData) this.tube.visitorData = this.attestedVisitorData;

    if (!this.player || this.player.playerId !== this.tube.playerId) {
      this.player = await PlayerScript.load(this.http, this.tube.jsUrl);
      if (!this.player.healthy) {
        log.warn(`player ${this.player.playerId} transforms unavailable; media requests may be rejected`);
      }
    }

    /*
     * Ask the mobile web surface first. It is the same browser-client family, but
     * it is sometimes served plain media URLs instead of being restricted to
     * SABR — which means a full download with no attestation and no browser.
     *
     * Whether it does so varies between requests, and a URL is only usable if
     * the `n` transform we hold matches the build that signed it, so the offer is
     * verified with a small ranged GET before it is trusted. Anything else falls
     * through to the desktop surface.
     */
    if (mobile) {
      const mobileRaw = await this.tube
        .player(videoId, { signatureTimestamp: this.player.signatureTimestamp, mobile: true })
        .catch((err) => {
          log.debug(`mobile player request failed: ${err.message}`);
          return null;
        });

      if (mobileRaw) {
        const mobileInfo = parsePlayerResponse(mobileRaw);
        const direct = mobileInfo.formats.filter((f) => f.url || f.signatureCipher);

        if (mobileInfo.playable && direct.length > 0) {
          if (await this.#directUrlsWork(mobileInfo)) {
            log.debug(`mobile surface offered ${direct.length} usable direct urls`);
            return { videoId, info: mobileInfo, raw: mobileRaw, progressive: true };
          }
          log.debug('mobile direct urls were rejected; falling back to SABR');
        } else {
          log.debug(`mobile surface declined (${mobileInfo.status}, ${direct.length} direct urls)`);
        }
      }
    }

    const raw = await this.tube.player(videoId, {
      signatureTimestamp: this.player.signatureTimestamp,
      poToken,
    });
    const info = parsePlayerResponse(raw);
    if (!info.playable) throw new UnplayableError(info);

    return { videoId, info, raw, progressive: false };
  }

  /**
   * Metadata and media URLs as a plain object, ready to serialise.
   *
   * URLs are returned with the throttling-deterrent `n` parameter already
   * transformed, because an untransformed one is answered with a bare 403 — so
   * what comes out of here is directly usable by curl, ffmpeg or a player.
   *
   * `reach` records what each URL will actually serve, which is not uniform:
   * a muxed URL streams the whole file, while an adaptive one stops about 895 KB
   * in. Callers that just want a working link should prefer `muxed`.
   */
  async describe(input, { mobile = true } = {}) {
    const { videoId, info } = await this.resolve(input, { attest: false, mobile });
    const progressive = new ProgressiveDownload({ http: this.http, player: this.player });

    const describeFormat = (f) => ({
      itag: f.itag,
      kind: f.kind,
      muxed: f.muxed,
      mimeType: f.mimeType,
      container: f.container,
      codecs: f.codecs,
      qualityLabel: f.qualityLabel,
      width: f.width,
      height: f.height,
      fps: f.fps,
      bitrate: f.bitrate,
      audioChannels: f.audioChannels,
      audioSampleRate: f.audioSampleRate,
      contentLength: f.contentLength,
      approxDurationMs: f.approxDurationMs,
      lastModified: f.lastModified,
      xtags: f.xtags,
      isDrc: f.isDrc,
      // Already n-transformed and deciphered; null when no url could be built.
      url: progressive.resolveUrl(f),
      reach: f.url || f.signatureCipher ? (f.muxed ? 'whole' : 'partial') : 'none',
    });

    const formats = info.formats.map(describeFormat);
    const bestVideo = selectBestVideo(info.formats);
    const bestAudio = selectBestAudio(info.formats);
    const muxed = info.formats.find((f) => ProgressiveDownload.isStreamable(f));

    return {
      videoId,
      title: info.title,
      author: info.author,
      channelId: info.channelId,
      durationSeconds: info.durationSeconds,
      viewCount: info.viewCount,
      publishDate: info.publishDate,
      isLive: info.isLive,
      thumbnails: info.thumbnails,
      // How this response was obtained, so callers know what to expect.
      surface: muxed || formats.some((f) => f.url) ? 'mobile-web' : 'web',
      delivery: info.serverAbrStreamingUrl ? 'sabr' : 'direct',
      expiresInSeconds: info.expiresInSeconds,
      recommended: {
        muxed: muxed ? describeFormat(muxed) : null,
        video: bestVideo ? describeFormat(bestVideo) : null,
        audio: bestAudio ? describeFormat(bestAudio) : null,
      },
      formats,
      captions: info.captions,
      serverAbrStreamingUrl: info.serverAbrStreamingUrl,
    };
  }

  /**
   * Download one video.
   *
   * `quality` accepts 'best', 'audio', or a height cap such as '1080'.
   *
   * Two transports are available. The direct one speaks SABR over plain HTTP and
   * is fast and dependency-free, but the service stops feeding it after about a
   * minute of media. The playback transport instead drives a real browser
   * through the video at speed and keeps a copy of what its player fetches,
   * which retrieves the whole thing. Short videos take the direct path; anything
   * longer uses playback capture unless told otherwise.
   */
  async download(input, options = {}) {
    const {
      quality = 'best',
      audioOnly = false,
      videoOnly = false,
      mp3 = false,
      itag = null,
      outputPath = null,
      keepTracks = false,
      onProgress = null,
      container = null,
      attest = true,
      headless = false,
      transport = 'auto',
      rate = 16,
    } = options;

    const { videoId, info, progressive } = await this.resolve(input, {
      attest: attest && transport === 'session',
      headless,
      mobile: transport === 'auto' || transport === 'progressive',
    });

    if (info.isLive) {
      throw new Error('live streams are not supported');
    }

    const maxHeight = /^\d+$/.test(String(quality)) ? Number(quality) : null;
    const wantVideo = !audioOnly;
    const wantAudio = !videoOnly;
    const explicitItag = itag != null ? Number(itag) : null;

    // An explicit itag overrides quality selection entirely: pick exactly that
    // format and skip the best-video/best-audio ranking.
    let videoFormat = null;
    let audioFormat = null;
    let muxedFormat = null;
    if (explicitItag != null) {
      const pick = info.formats.find((f) => f.itag === explicitItag);
      if (!pick) throw new Error(`no format with itag ${explicitItag} was offered`);
      if (pick.muxed) muxedFormat = pick;
      else if (pick.kind === 'video') videoFormat = pick;
      else audioFormat = pick;
    } else {
      videoFormat = wantVideo ? selectBestVideo(info.formats, { maxHeight }) : null;
      audioFormat = wantAudio ? selectBestAudio(info.formats) : null;
    }

    if (!videoFormat && !audioFormat && !muxedFormat) {
      throw new Error('no suitable formats were offered for this video');
    }

    const summary = muxedFormat
      ? `muxed itag ${muxedFormat.itag} (${muxedFormat.qualityLabel ?? '?'})`
      : `${videoFormat ? `${videoFormat.qualityLabel ?? videoFormat.height + 'p'} ${videoFormat.codecs[0]}` : 'no video'}` +
        `${audioFormat ? ` + ${audioFormat.codecs[0]} ${Math.round((audioFormat.bitrate ?? 0) / 1000)}kbps` : ''}`;
    log.info(`${info.title} — ${summary}`);

    /*
     * Transport selection.
     *
     * When the mobile surface handed us plain media URLs, use them: that is a
     * complete download over ordinary ranged GETs, at any length, with no
     * attestation and no browser. Otherwise fall back to SABR, which is capped
     * at about a minute unless a session was established.
     */
    let tracks;
    if (progressive && transport !== 'session' && transport !== 'playback' && transport !== 'direct') {
      tracks = await this.#downloadProgressive({
        videoId, videoFormat, audioFormat, muxedFormat, info, onProgress, audioOnly, videoOnly,
      });
    } else if (transport === 'playback') {
      tracks = await this.#captureViaPlayback({
        videoId, info, maxHeight: maxHeight ?? videoFormat?.height ?? null,
        audioOnly, videoOnly, headless, rate, onProgress,
      });
    } else if (!info.serverAbrStreamingUrl) {
      throw new Error('player response carried neither direct urls nor a SABR streaming url');
    } else if (transport === 'session') {
      tracks = await this.#downloadWithSession({
        videoId, info, audioFormat, videoFormat, maxHeight, headless, onProgress,
      });
    } else {
      /*
       * Try SABR over plain HTTP first, whatever the length. A cold session is
       * often cut off partway — if so, keep what arrived and warn rather than
       * falling back to a browser session. This is a deliberate WEB-only,
       * no-browser constraint.
       */
      tracks = await this.#downloadDirect({ videoId, info, audioFormat, videoFormat, onProgress });

      if (transport === 'auto' && this.#isTruncated(tracks, info)) {
        log.warn('cold SABR came up short and no browser fallback is used; keeping partial result');
      }
    }

    if (tracks.length === 0) throw new Error('no media was retrieved');

    /*
     * Keep whatever contiguous prefix arrived rather than discarding it, and say
     * plainly how much of the video it covers — a truncated but playable file
     * beats a hard failure.
     */
    const truncated = tracks.filter((t) => t.missing.length > 0);
    if (truncated.length) {
      const covered = Math.min(...tracks.map((t) => t.durationMs)) / 1000;
      const total = info.durationSeconds ?? 0;
      log.warn(`stream was cut short at ${formatDuration(covered)} of ${formatDuration(total)}`);
    }

    await ensureDir(this.outputDir);
    const baseName = sanitizeFilename(info.title ?? videoId);

    // A muxed track already holds both streams.
    const combined = tracks.find((t) => t.kind === 'muxed');
    if (combined) {
      // When only audio was requested, extract it from the muxed file via ffmpeg
      // rather than keeping the video. The muxed URL carries ratebypass=yes and
      // streams end to end, unlike adaptive audio which is reach-limited.
      if (audioOnly) {
        const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytw-'));
        const muxedTemp = path.join(tempDir, `muxed.${extensionFor(combined.mimeType, 'video')}`);
        try {
          await fsp.writeFile(muxedTemp, combined.data);
          const ffmpeg = await findFfmpeg(this.ffmpegPath);
          if (!ffmpeg) {
            await removeQuiet(tempDir);
          } else {
            const codec = combined.mimeType ?? '';
            const audioExt = mp3 ? 'mp3' : (codec.includes('avc') || codec.includes('mp4') ? 'm4a' : 'weba');
            const target =
              outputPath ?? (await uniquePath(path.join(this.outputDir, `${baseName}.${audioExt}`)));
            const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-i', muxedTemp, '-map', '0:a:0'];
            if (mp3) {
              args.push('-c:a', 'libmp3lame', '-q:a', '2');
            } else {
              args.push('-c', 'copy');
              if (audioExt === 'm4a') args.push('-movflags', '+faststart');
            }
            args.push(
              ...(info.title ? ['-metadata', `title=${info.title}`] : []),
              ...(info.author ? ['-metadata', `artist=${info.author}`] : []),
              target,
            );
            const { runFfmpeg } = await import('./ffmpeg.js');
            log.debug(`ffmpeg ${args.join(' ')}`);
            await runFfmpeg(ffmpeg, args);
            log.info(`saved ${target} (audio extracted from muxed${mp3 ? ', transcoded to mp3' : ''})`);
            return { path: target, tracks, info };
          }
        } finally {
          await removeQuiet(tempDir);
        }
      }

      const ext = extensionFor(combined.mimeType, 'video');
      const target =
        outputPath ?? (await uniquePath(path.join(this.outputDir, `${baseName}.${ext}`)));
      await fsp.writeFile(target, combined.data);
      log.info(`saved ${target} (${formatBytes(combined.bytes)})`);
      return { path: target, tracks, info };
    }

    const video = tracks.find((t) => t.kind === 'video');
    const audio = tracks.find((t) => t.kind === 'audio');

    // A single track needs no muxing; write it straight out.
    if (!video || !audio) {
      const only = video ?? audio;
      const ext = extensionFor(only.mimeType, only.kind);
      // Honour an explicit path only when it matches the codec's container;
      // Opus in .m4a, for instance, is not a valid file.
      const requested = outputPath ? path.extname(outputPath).slice(1).toLowerCase() : null;
      const target =
        outputPath && (!requested || requested === ext)
          ? outputPath
          : await uniquePath(
              outputPath
                ? path.join(path.dirname(outputPath), `${path.basename(outputPath, path.extname(outputPath))}.${ext}`)
                : path.join(this.outputDir, `${baseName}.${ext}`),
            );

      if (outputPath && requested && requested !== ext) {
        log.warn(`writing ${ext} instead of ${requested}: the track is ${only.codecs[0]}`);
      }

      await fsp.writeFile(target, only.data);
      log.info(`saved ${target} (${formatBytes(only.bytes)})`);
      return { path: target, tracks, info };
    }

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ytw-'));
    const videoTemp = path.join(tempDir, `video.${extensionFor(video.mimeType, 'video')}`);
    const audioTemp = path.join(tempDir, `audio.${extensionFor(audio.mimeType, 'audio')}`);

    try {
      await fsp.writeFile(videoTemp, video.data);
      await fsp.writeFile(audioTemp, audio.data);

      const ffmpeg = await findFfmpeg(this.ffmpegPath);
      if (!ffmpeg) {
        // Without ffmpeg we cannot mux, so keep both tracks rather than fail.
        const vOut = await uniquePath(path.join(this.outputDir, `${baseName}.video.${extensionFor(video.mimeType, 'video')}`));
        const aOut = await uniquePath(path.join(this.outputDir, `${baseName}.audio.${extensionFor(audio.mimeType, 'audio')}`));
        await fsp.copyFile(videoTemp, vOut);
        await fsp.copyFile(audioTemp, aOut);
        log.warn(`ffmpeg not found; wrote separate tracks:\n  ${vOut}\n  ${aOut}`);
        return { path: null, videoPath: vOut, audioPath: aOut, tracks, info };
      }

      const ext = container ?? containerFor(video.mimeType, audio.mimeType);
      const target = outputPath ?? (await uniquePath(path.join(this.outputDir, `${baseName}.${ext}`)));

      await mergeTracks({
        ffmpeg,
        videoPath: videoTemp,
        audioPath: audioTemp,
        outputPath: target,
        metadata: {
          title: info.title ?? '',
          artist: info.author ?? '',
          date: (info.publishDate ?? '').slice(0, 10),
          comment: `https://www.youtube.com/watch?v=${videoId}`,
        },
      });

      if (keepTracks) {
        await fsp.copyFile(videoTemp, path.join(this.outputDir, path.basename(videoTemp)));
        await fsp.copyFile(audioTemp, path.join(this.outputDir, path.basename(audioTemp)));
      }

      const size = (await fsp.stat(target)).size;
      log.info(`saved ${target} (${formatBytes(size)})`);
      return { path: target, tracks, info };
    } finally {
      await removeQuiet(videoTemp);
      await removeQuiet(audioTemp);
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Confirm the mobile surface has given us something we can actually finish.
   *
   * A muxed format streams end to end and is the good case. Adaptive URLs look
   * fine and answer the first ranges, but each one only reaches about 895 KB into
   * its file — even on a freshly issued URL — so they cannot be assembled. The
   * honest test is a range near the *end*; the start always succeeds and proves
   * nothing.
   */
  async #directUrlsWork(info) {
    const muxed = info.formats.find((f) => ProgressiveDownload.isStreamable(f));
    if (muxed) {
      const progressive = new ProgressiveDownload({ http: this.http, player: this.player });
      const url = progressive.resolveUrl(muxed);
      if (url) {
        try {
          const probe = await this.http.request(url, {
            headers: { range: 'bytes=0-1024', accept: '*/*' },
            expect: [200, 206],
            retries: 0,
          });
          probe.stream.resume();
          if (probe.status === 200 || probe.status === 206) {
            log.debug(`mobile surface offered a working muxed format (itag ${muxed.itag})`);
            return true;
          }
        } catch (err) {
          log.debug(`mobile muxed probe failed: ${err.message}`);
        }
      }
    }

    const candidate = info.formats.find(
      (f) => (f.url || f.signatureCipher) && Number(f.contentLength) > 0,
    );
    if (!candidate) return false;

    const size = Number(candidate.contentLength);
    const progressive = new ProgressiveDownload({ http: this.http, player: this.player });
    const url = progressive.resolveUrl(candidate);
    if (!url) return false;
    const start = Math.max(0, size - 4096);

    try {
      const res = await this.http.request(url, {
        headers: { range: `bytes=${start}-${size - 1}`, accept: '*/*' },
        expect: [200, 206, 403, 404, 416],
        retries: 0,
      });
      res.stream.resume();
      if (res.status === 200 || res.status === 206) return true;
      log.debug(`adaptive direct urls are reach-limited (HTTP ${res.status} near the end)`);
      return false;
    } catch (err) {
      log.debug(`direct url probe failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Fetch each track straight from its media URL over ranged GETs.
   *
   * No SABR loop, no attestation, no browser, and no length limit — this is the
   * preferred path whenever the response carries plain URLs.
   */
  async #downloadProgressive({ videoId, videoFormat, audioFormat, muxedFormat, info, onProgress, audioOnly, videoOnly }) {
    const progressive = new ProgressiveDownload({ http: this.http, player: this.player });

    /*
     * A muxed format already contains both tracks and streams end to end, so it
     * needs neither ranged assembly nor muxing. Prefer it whenever the caller
     * wants both tracks and one is on offer. An explicit muxed itag takes
     * precedence over the automatic pick.
     */
    const muxed = muxedFormat ?? info.formats.find((f) => ProgressiveDownload.isStreamable(f));
    if (muxed && !videoOnly) {
      // When audioOnly, stream the muxed format and let the output stage extract
      // the audio track via ffmpeg — the muxed URL carries ratebypass=yes and
      // streams end to end, unlike adaptive audio which is reach-limited.
      log.info(`streaming muxed itag ${muxed.itag} (${muxed.qualityLabel ?? '?'})`);
      const data = await progressive.streamWhole(muxed, {
        onProgress: ({ bytes, total }) =>
          onProgress?.({
            bytes,
            bufferedMs: total ? (bytes / total) * (info.durationSeconds ?? 0) * 1000 : 0,
            durationMs: (info.durationSeconds ?? 0) * 1000,
          }),
      });

      return [
        {
          formatId: { itag: muxed.itag, lastModified: muxed.lastModified, xtags: muxed.xtags },
          mimeType: muxed.mimeType,
          // Already muxed, so it is written straight out rather than merged.
          kind: 'muxed',
          data,
          bytes: data.length,
          durationMs: (info.durationSeconds ?? 0) * 1000,
          segments: 1,
          missing: [],
        },
      ];
    }

    /*
     * Otherwise fall back to ranged assembly of adaptive formats. Each URL only
     * reaches ~895 KB into its file, so a fresh one is fetched as the reach is
     * spent.
     */
    const refreshUrl = async (format) => {
      const raw = await this.tube.player(videoId, {
        signatureTimestamp: this.player.signatureTimestamp,
        mobile: true,
      });
      const fresh = parsePlayerResponse(raw);
      const match =
        fresh.formats.find(
          (f) => f.itag === format.itag && (f.xtags ?? null) === (format.xtags ?? null),
        ) ?? fresh.formats.find((f) => f.itag === format.itag);
      return match ? progressive.resolveUrl(match) : null;
    };
    progressive.refreshUrl = refreshUrl;

    const wanted = [videoFormat, audioFormat].filter(Boolean);
    const totalBytes = wanted.reduce((n, f) => n + (f.contentLength ?? 0), 0);
    let carried = 0;

    const tracks = [];
    for (const format of wanted) {
      const data = await progressive.download(format, {
        onProgress: ({ bytes }) => {
          onProgress?.({
            bytes: carried + bytes,
            bufferedMs: totalBytes
              ? ((carried + bytes) / totalBytes) * (info.durationSeconds ?? 0) * 1000
              : 0,
            durationMs: (info.durationSeconds ?? 0) * 1000,
          });
        },
      });
      carried += data.length;

      tracks.push({
        formatId: { itag: format.itag, lastModified: format.lastModified, xtags: format.xtags },
        mimeType: format.mimeType,
        kind: format.kind,
        data,
        bytes: data.length,
        durationMs: format.approxDurationMs ?? (info.durationSeconds ?? 0) * 1000,
        segments: 1,
        missing: [],
      });
    }

    return tracks;
  }

  /*
   * Whether a set of tracks stops short of the video. A cold SABR session is
   * cut off partway often enough to need a fallback, but not so reliably that
   * length alone predicts it — so this reads what actually arrived. The 2%
   * tolerance absorbs the last partial segment, which never lands exactly on
   * the reported duration.
   */
  #isTruncated(tracks, info) {
    if (tracks.length === 0) return true;
    if (tracks.some((t) => t.missing.length > 0)) return true;

    const totalMs = (info.durationSeconds ?? 0) * 1000;
    if (!totalMs) return false;

    const covered = Math.min(...tracks.map((t) => t.durationMs ?? 0));
    return covered < totalMs * 0.98;
  }

  /** Pull the stream over plain HTTP. Fast, but bounded by the serving window. */
  async #downloadDirect({ videoId, info, audioFormat, videoFormat, onProgress }) {
    const stream = new SabrStream({
      http: this.http,
      player: this.player,
      streamingUrl: info.serverAbrStreamingUrl,
      ustreamerConfig: info.ustreamerConfig,
      clientVersion: this.tube.clientVersion,
      videoId,
      durationMs: (info.durationSeconds ?? 0) * 1000,
      audioFormat,
      videoFormat,
      availableAudioFormats: info.formats.filter((f) => f.kind === 'audio' && !f.muxed),
      availableVideoFormats: info.formats.filter((f) => f.kind === 'video' && !f.muxed),
      poToken: this.poToken ? Buffer.from(this.poToken, 'base64url') : null,
      onProgress,
    });

    return stream.download();
  }

  /**
   * Earn a trusted session in a browser once, then pull the whole stream from
   * Node. The browser is not involved in the transfer itself, and a cached
   * session skips it entirely.
   */
  async #downloadWithSession({ videoId, info, audioFormat, videoFormat, maxHeight, headless, onProgress }) {
    // Prefer a session handed in from outside, then a cached one, and only launch
    // a browser as a last resort.
    let session = (await loadExternalSession(videoId)) ?? (await loadSession(videoId));
    if (session) {
      log.debug('using an existing session; no browser needed');
    } else {
      log.info('opening a browser once to establish a session');
      session = await exportSession(videoId, { headless });
    }

    const formats = (session.adaptiveFormats ?? []).map((f) => normalizeFormat(f));
    const pool = formats.length ? formats : info.formats;

    // Re-select against the session's own ladder so the ids line up with what
    // this session is entitled to.
    const video = videoFormat ? selectBestVideo(pool, { maxHeight }) : null;
    const audio = audioFormat ? selectBestAudio(pool) : null;

    const stream = new SabrStream({
      http: this.http,
      player: null, // the exported url already carries the transformed n
      streamingUrl: session.streamingUrl,
      ustreamerConfig: session.ustreamerConfig ?? info.ustreamerConfig,
      clientVersion: session.clientVersion ?? this.tube.clientVersion,
      videoId,
      durationMs: (session.durationSeconds ?? info.durationSeconds ?? 0) * 1000,
      audioFormat: audio,
      videoFormat: video,
      availableAudioFormats: pool.filter((f) => f.kind === 'audio' && !f.muxed),
      availableVideoFormats: pool.filter((f) => f.kind === 'video' && !f.muxed),
      poToken: session.poTokenB64 ? Buffer.from(session.poTokenB64, 'base64') : null,
      playbackCookie: session.playbackCookieB64
        ? Buffer.from(session.playbackCookieB64, 'base64')
        : null,
      onProgress,
    });

    return stream.download();
  }

  /**
   * Play the video through in a real browser and keep a copy of what its player
   * fetches. Slower to start, but it retrieves the whole stream.
   */
  async #captureViaPlayback({ videoId, info, maxHeight, audioOnly, videoOnly, headless, rate, onProgress }) {
    const capture = new PlaybackCapture({ videoId, headless, rate });

    try {
      await capture.open();
      if (maxHeight) await capture.selectQuality(maxHeight);

      const captured = await capture.capture({ onProgress });

      // Playback can touch several renditions as it adapts; keep the one that
      // actually covers the video for each kind, and honour the track filters.
      const byKind = new Map();
      for (const track of captured) {
        if (track.kind === 'audio' && videoOnly) continue;
        if (track.kind === 'video' && audioOnly) continue;
        const best = byKind.get(track.kind);
        if (!best || track.durationMs > best.durationMs) byKind.set(track.kind, track);
      }

      const kept = [...byKind.values()];
      if (kept.length) {
        log.debug(
          `capture kept ${kept.map((t) => `${t.kind} itag=${t.formatId.itag} ${formatBytes(t.bytes)}`).join(', ')}`,
        );
      }
      return kept;
    } finally {
      await capture.close();
    }
  }
}
