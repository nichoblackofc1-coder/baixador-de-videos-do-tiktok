import { spawn } from 'node:child_process';
import path from 'node:path';
import { log } from '../util/logger.js';

/** Locate ffmpeg: explicit override, PATH, or the usual Windows install spots. */
export async function findFfmpeg(explicit = null) {
  const candidates = [
    explicit,
    process.env.FFMPEG_PATH,
    'ffmpeg',
    'D:\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await probe(candidate)) return candidate;
  }
  return null;
}

function probe(binary) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['-version'], { stdio: 'ignore', shell: false });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export function runFfmpeg(binary, args, { onStderr = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
      onStderr?.(text);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Mux a video track and an audio track into one container.
 *
 * Both inputs are already the final encoded bitstreams, so we stream-copy:
 * no re-encode, no quality loss.
 */
export async function mergeTracks({
  ffmpeg,
  videoPath,
  audioPath,
  outputPath,
  metadata = {},
  onProgress = null,
}) {
  const container = path.extname(outputPath).toLowerCase();
  const args = ['-hide_banner', '-loglevel', 'warning', '-y'];

  if (videoPath) args.push('-i', videoPath);
  if (audioPath) args.push('-i', audioPath);

  args.push('-c', 'copy');

  if (videoPath && audioPath) {
    args.push('-map', '0:v:0', '-map', '1:a:0');
  }

  if (container === '.mp4' || container === '.m4a') {
    // Move the index to the front so the file is seekable before it is fully read.
    args.push('-movflags', '+faststart');
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (value == null || value === '') continue;
    args.push('-metadata', `${key}=${value}`);
  }

  args.push(outputPath);

  log.debug(`ffmpeg ${args.join(' ')}`);
  await runFfmpeg(ffmpeg, args, { onStderr: onProgress });
  return outputPath;
}

/** Read stream properties back out of a finished file. */
export function probeFile(ffmpeg, filePath) {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (m) => (m.toLowerCase().endsWith('.exe') ? 'ffprobe.exe' : 'ffprobe'));

  return new Promise((resolve, reject) => {
    const child = spawn(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error(`ffprobe returned invalid JSON: ${err.message}`));
      }
    });
  });
}
