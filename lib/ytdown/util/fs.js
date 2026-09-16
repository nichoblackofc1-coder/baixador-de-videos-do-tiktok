import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const RESERVED_CHARS = /[<>:"/\\|?*]/g;

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/** Strip characters Windows and POSIX refuse, then clamp the length. */
export function sanitizeFilename(name, max = 120) {
  const cleaned = String(name ?? '')
    .replace(CONTROL_CHARS, '')
    .replace(RESERVED_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim();
  const safe = cleaned.length ? cleaned : 'video';
  return safe.length > max ? safe.slice(0, max).trimEnd() : safe;
}

export async function uniquePath(target) {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  let candidate = target;
  let i = 1;
  while (await exists(candidate)) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
    i += 1;
  }
  return candidate;
}

export async function exists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removeQuiet(p) {
  try {
    await fsp.rm(p, { force: true });
  } catch {
    /* best effort */
  }
}

export async function fileSize(p) {
  try {
    return (await fsp.stat(p)).size;
  } catch {
    return 0;
  }
}
