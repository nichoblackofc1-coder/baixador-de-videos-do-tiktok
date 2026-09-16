const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

let current = LEVELS[process.env.YTW_LOG ?? 'info'] ?? LEVELS.info;

export function setLevel(name) {
  if (name in LEVELS) current = LEVELS[name];
}

function stamp() {
  return new Date().toISOString().slice(11, 23);
}

function emit(stream, level, tag, args) {
  if (current < LEVELS[level]) return;
  stream.write(`${stamp()} ${tag} ${args.map(fmt).join(' ')}\n`);
}

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ?? v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  error: (...a) => emit(process.stderr, 'error', '[err ]', a),
  warn: (...a) => emit(process.stderr, 'warn', '[warn]', a),
  info: (...a) => emit(process.stderr, 'info', '[info]', a),
  debug: (...a) => emit(process.stderr, 'debug', '[dbg ]', a),
};

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '?';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (x) => String(x).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
