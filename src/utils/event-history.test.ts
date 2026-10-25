// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearEventHistory,
  flushEventHistory,
  readEventHistory,
  recordLogEvent,
  resetEventHistory,
} from './event-history';
import { createLogger, Logger } from './logger';

const KEY = 'iptv_event_history';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T22:23:43Z'));
  localStorage.clear();
  resetEventHistory();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('event history', () => {
  it('keeps warnings, errors and structured events of the playback tags', () => {
    recordLogEvent('warn', 'Player', ['Manifest fetch failed', 'event=playback.manifest.failed']);
    recordLogEvent('error', 'StreamDiagnosis', ['Playback failure diagnosed']);
    recordLogEvent('info', 'ChannelHealth', ['marked', 'event=channel.health.playback.failed']);

    expect(readEventHistory()).toEqual([
      '10-25 22:23:43 warn [Player] Manifest fetch failed event=playback.manifest.failed',
      '10-25 22:23:43 error [StreamDiagnosis] Playback failure diagnosed',
      '10-25 22:23:43 info [ChannelHealth] marked event=channel.health.playback.failed',
    ]);
  });

  it('ignores debug lines, plain info lines and other tags', () => {
    recordLogEvent('debug', 'Player', ['event=playback.noise']);
    recordLogEvent('info', 'Player', ['a plain progress line']);
    recordLogEvent('error', 'Parental', ['event=parental.pin.failed']);

    expect(readEventHistory()).toEqual([]);
  });

  it('writes to storage after a short delay and on pagehide', () => {
    recordLogEvent('warn', 'Player', ['first']);
    expect(localStorage.getItem(KEY)).toBeNull();

    vi.advanceTimersByTime(3000);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);

    recordLogEvent('warn', 'Player', ['second']);
    window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(2);
  });

  it('survives a restart', () => {
    recordLogEvent('error', 'Player', ['stream died']);
    flushEventHistory();

    resetEventHistory();

    expect(readEventHistory()).toEqual(['10-25 22:23:43 error [Player] stream died']);
  });

  it('keeps only the latest lines and caps a long one', () => {
    for (let i = 0; i < 130; i++) recordLogEvent('warn', 'Player', [`line ${String(i)}`]);
    recordLogEvent('warn', 'Player', ['x'.repeat(1000)]);

    const lines = readEventHistory();
    expect(lines).toHaveLength(120);
    expect(lines[0]).toContain('line 11');
    expect(lines[lines.length - 1]).toHaveLength(240);
  });

  it('writes objects and errors as text', () => {
    recordLogEvent('error', 'Player', ['failed', { code: 2 }, new Error('boom')]);

    expect(readEventHistory()[0]).toContain('failed {"code":2} boom');
  });

  it('starts empty when the stored value is damaged, and clears on request', () => {
    localStorage.setItem(KEY, '{not json');
    expect(readEventHistory()).toEqual([]);

    localStorage.setItem(KEY, JSON.stringify(['old', 7]));
    resetEventHistory();
    expect(readEventHistory()).toEqual(['old']);

    clearEventHistory();
    expect(readEventHistory()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBe('[]');
  });

  it('survives storage that refuses a write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    recordLogEvent('warn', 'Player', ['kept in memory']);

    expect(() => flushEventHistory()).not.toThrow();
    expect(readEventHistory()).toHaveLength(1);
  });
});

describe('the logger feeds the history', () => {
  it('records a playback warning even when the console level hides it', () => {
    Logger.setLevel('silent');
    createLogger('Player').warn('Reconnecting live stream', 'event=playback.recovery.reload');
    Logger.setLevel('debug');

    expect(Logger.history()).toEqual([
      '10-25 22:23:43 warn [Player] Reconnecting live stream event=playback.recovery.reload',
    ]);
  });

  it('leaves other tags out', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    createLogger('Search').info('event=search.index.prewarm.completed');

    expect(Logger.history()).toEqual([]);
  });
});
