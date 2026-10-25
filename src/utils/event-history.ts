/**
 * A short, persistent trail of playback events.
 *
 * The console is gone once the app closes, so a stream that failed an hour ago
 * left nothing to read. This keeps the last events of the playback tags in one
 * small localStorage value that survives a restart and can be read with
 * `localStorage.getItem('iptv_event_history')` over the remote debugger. It
 * holds warnings, errors and structured `event=` lines only, never debug noise,
 * and every line is capped, so the value stays far below the Web Storage limit.
 */

const KEY = 'iptv_event_history';
const MAX_LINES = 120;
const MAX_LINE_CHARS = 240;
const FLUSH_DELAY_MS = 3000;
const TRACKED_TAGS = ['Player', 'StreamDiagnosis', 'ChannelHealth'];

type Level = 'debug' | 'info' | 'warn' | 'error';

let lines: string[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function load(): string[] {
  if (lines) return lines;
  lines = [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(stored)) {
      lines = stored.filter((line): line is string => typeof line === 'string').slice(-MAX_LINES);
    }
  } catch { /* unreadable or unavailable: start empty */ }
  return lines;
}

function format(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message;
  try {
    const text = JSON.stringify(arg);
    return text === undefined ? String(arg) : text;
  } catch {
    return String(arg);
  }
}

export function flushEventHistory(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!lines) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch { /* storage full or unavailable: the trail is best effort */ }
}

function scheduleFlush(): void {
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.addEventListener('pagehide', flushEventHistory);
  }
  if (flushTimer === null) flushTimer = setTimeout(flushEventHistory, FLUSH_DELAY_MS);
}

/** Called by the logger for every line; keeps only what helps explain a failure. */
export function recordLogEvent(level: Level, tag: string, args: readonly unknown[]): void {
  if (level === 'debug' || TRACKED_TAGS.indexOf(tag) === -1) return;
  const text = args.map(format).join(' ');
  if (level === 'info' && text.indexOf('event=') === -1) return;
  const kept = load();
  const stamp = new Date().toISOString().slice(5, 19).replace('T', ' ');
  kept.push(`${stamp} ${level} [${tag}] ${text}`.slice(0, MAX_LINE_CHARS));
  if (kept.length > MAX_LINES) kept.splice(0, kept.length - MAX_LINES);
  scheduleFlush();
}

export function readEventHistory(): string[] {
  return load().slice();
}

export function clearEventHistory(): void {
  lines = [];
  flushEventHistory();
}

/** Forget the in-memory copy so the next call reads storage again (tests). */
export function resetEventHistory(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  lines = null;
}
