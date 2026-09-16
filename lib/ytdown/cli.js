#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';

import { Downloader } from './download/downloader.js';
import { HttpClient } from './net/http.js';
import { exportSession } from './attest/session.js';
import { parseVideoId } from './util/url.js';
import { describeFormat, selectBestAudio, selectBestVideo } from './parser/formats.js';
import { setLevel, log, formatBytes, formatDuration } from './util/logger.js';

const USAGE = `
ytw — YouTube downloader built on a reverse-engineered InnerTube WEB client

Usage
  ytw <url|id>                     download best quality
  ytw download <url|id> [options]  download with options
  ytw info <url|id>                show metadata
  ytw formats <url|id>             list available formats
  ytw json <url|id>                metadata and media urls as JSON
  ytw session <url|id>             export a session to stdout as JSON

Options
  -o, --output <dir>       output directory (default: current directory)
  -f, --file <path>        exact output file path
  -q, --quality <spec>     best | audio | a max height such as 1080
      --audio-only         download only the audio track
      --mp3                with --audio-only: transcode to mp3
      --video-only         download only the video track
      --container <ext>    force the output container (mp4 | webm | mkv)
      --keep-tracks        also keep the separate video and audio files
      --transport <mode>   auto | progressive | direct | session | playback
      --rate <n>           playback capture speed multiplier (default: 16)
      --headless           run the session browser without a window
      --urls-only          with json: emit only formats that carry a url
      --compact            with json: no indentation
      --no-attest          skip PO token minting
      --ffmpeg <path>      path to the ffmpeg binary
  -v, --verbose            verbose logging
      --quiet              errors only
  -h, --help               show this help

Transports
  direct    SABR over plain HTTP, no browser. The service cuts a cold session
            off after roughly a minute of media, so this suits short videos.
  session   Uses a trusted session: one supplied via YTW_SESSION, else a cached
            one, else a browser is opened once to establish it. The download
            itself always runs in Node. Full length, full quality.
  playback  Plays the video in a browser and keeps what its player fetches.
            A fallback for when a session cannot be established.
  auto      direct for short videos, session for anything longer.

Running without a browser
  Export a session once, on any machine that has one:
      ytw session <url|id> > session.json
  then download with no browser at all:
      YTW_SESSION=session.json ytw download <url|id>
  Sessions are per-video and short-lived. Short videos never need one.
`.trim();

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = () => argv[++i];

    switch (arg) {
      case '-o': case '--output': args.flags.output = take(); break;
      case '-f': case '--file': args.flags.file = take(); break;
      case '-q': case '--quality': args.flags.quality = take(); break;
      case '--container': args.flags.container = take(); break;
      case '--transport': args.flags.transport = take(); break;
      case '--rate': args.flags.rate = Number(take()); break;
      case '--ffmpeg': args.flags.ffmpeg = take(); break;
      case '--audio-only': args.flags.audioOnly = true; break;
      case '--mp3': args.flags.mp3 = true; break;
      case '--video-only': args.flags.videoOnly = true; break;
      case '--keep-tracks': args.flags.keepTracks = true; break;
      case '--no-attest': args.flags.attest = false; break;
      case '--headless': args.flags.headless = true; break;
      case '--urls-only': args.flags.urlsOnly = true; break;
      case '--compact': args.flags.compact = true; break;
      case '-v': case '--verbose': args.flags.verbose = true; break;
      case '--quiet': args.flags.quiet = true; break;
      case '-h': case '--help': args.flags.help = true; break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
        args._.push(arg);
    }
  }
  return args;
}

function renderProgress(p) {
  if (!process.stderr.isTTY) return;
  const have = p.bufferedMs ?? p.playerTimeMs ?? 0;
  const pct = p.durationMs ? Math.min(100, (have / p.durationMs) * 100) : 0;
  const width = 28;
  const filled = Math.round((pct / 100) * width);
  const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
  process.stderr.write(`\r  [${bar}] ${pct.toFixed(1).padStart(5)}%  ${formatBytes(p.bytes)}   `);
}

async function cmdInfo(target, flags) {
  const downloader = new Downloader({ ffmpegPath: flags.ffmpeg });
  const { info } = await downloader.resolve(target);

  const video = selectBestVideo(info.formats);
  const audio = selectBestAudio(info.formats);

  process.stdout.write(
    [
      `title      ${info.title}`,
      `author     ${info.author}`,
      `duration   ${formatDuration(info.durationSeconds)}`,
      `views      ${info.viewCount?.toLocaleString() ?? '?'}`,
      `published  ${info.publishDate ?? '?'}`,
      `formats    ${info.formats.length}`,
      `best video ${video ? describeFormat(video) : 'none'}`,
      `best audio ${audio ? describeFormat(audio) : 'none'}`,
      `delivery   ${info.serverAbrStreamingUrl ? 'SABR' : 'direct urls'}`,
      '',
    ].join('\n'),
  );
}

async function cmdFormats(target, flags) {
  const downloader = new Downloader({ ffmpegPath: flags.ffmpeg });
  const { info } = await downloader.resolve(target);

  const video = info.formats.filter((f) => f.kind === 'video').sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const audio = info.formats.filter((f) => f.kind === 'audio').sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  process.stdout.write(`${info.title}\n\nVideo\n`);
  for (const f of video) process.stdout.write(`  ${describeFormat(f)}\n`);
  process.stdout.write('\nAudio\n');
  for (const f of audio) process.stdout.write(`  ${describeFormat(f)}\n`);
  process.stdout.write('\n');
}

async function cmdDownload(target, flags) {
  const downloader = new Downloader({
    outputDir: flags.output ? path.resolve(flags.output) : process.cwd(),
    ffmpegPath: flags.ffmpeg,
  });

  const result = await downloader.download(target, {
    quality: flags.quality ?? 'best',
    audioOnly: Boolean(flags.audioOnly) || flags.quality === 'audio',
    mp3: Boolean(flags.mp3),
    videoOnly: Boolean(flags.videoOnly),
    outputPath: flags.file ? path.resolve(flags.file) : null,
    container: flags.container ?? null,
    keepTracks: Boolean(flags.keepTracks),
    transport: flags.transport ?? 'auto',
    rate: flags.rate ?? 16,
    attest: flags.attest !== false,
    headless: flags.headless === true,
    onProgress: renderProgress,
  });

  if (process.stderr.isTTY) process.stderr.write('\n');
  if (result.path) process.stdout.write(`${result.path}\n`);
}

async function cmdJson(target, flags) {
  const downloader = new Downloader({ ffmpegPath: flags.ffmpeg });
  const described = await downloader.describe(target, {
    mobile: flags.transport !== 'direct',
  });

  const payload = flags.urlsOnly
    ? {
        videoId: described.videoId,
        title: described.title,
        durationSeconds: described.durationSeconds,
        recommended: described.recommended,
        formats: described.formats.filter((f) => f.url),
      }
    : described;

  process.stdout.write(`${JSON.stringify(payload, null, flags.compact ? 0 : 1)}\n`);
}

async function cmdSession(target, flags) {
  const videoId = parseVideoId(target);
  if (!videoId) throw new Error(`could not parse a video id from: ${target}`);

  const session = await exportSession(videoId, { headless: flags.headless === true });
  // Written to stdout so it can be redirected into a file and carried elsewhere.
  process.stdout.write(`${JSON.stringify({ [videoId]: session }, null, 1)}\n`);
  log.info(`session exported for ${videoId}; use it with YTW_SESSION`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${USAGE}\n`);
    process.exit(2);
  }

  if (args.flags.help || args._.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(args.flags.help ? 0 : 2);
  }

  if (args.flags.verbose) setLevel('debug');
  if (args.flags.quiet) setLevel('error');

  const known = new Set(['download', 'info', 'formats', 'json', 'session']);
  const command = known.has(args._[0]) ? args._[0] : 'download';
  const target = known.has(args._[0]) ? args._[1] : args._[0];

  if (!target) {
    process.stderr.write(`missing video url or id\n\n${USAGE}\n`);
    process.exit(2);
  }

  switch (command) {
    case 'info': await cmdInfo(target, args.flags); break;
    case 'formats': await cmdFormats(target, args.flags); break;
    case 'json': await cmdJson(target, args.flags); break;
    case 'session': await cmdSession(target, args.flags); break;
    default: await cmdDownload(target, args.flags); break;
  }
}

main().catch((err) => {
  if (process.stderr.isTTY) process.stderr.write('\n');
  log.error(err.message);
  if (process.env.YTW_LOG === 'debug') log.error(err);
  process.exit(1);
});
