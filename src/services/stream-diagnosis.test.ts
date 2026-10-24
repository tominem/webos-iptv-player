import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { diagnoseStream } from './stream-diagnosis';
import { setServicePort } from './service-http';

const PACKET = 188;

function transportStream(videoType: number): Uint8Array {
  const packet = (pid: number, section: number[]): number[] => {
    const out = [0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0x00, ...section];
    while (out.length < PACKET) out.push(0xff);
    return out;
  };
  const pat = [0x00, 0xb0, 0x0d, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0, 0, 0, 0];
  const entries = [videoType, 0xe1, 0x01, 0xf0, 0x00, 0x0f, 0xe1, 0x02, 0xf0, 0x00];
  const body = [0x02, 0xb0, 0x00, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00, ...entries, 0, 0, 0, 0];
  body[2] = body.length - 3;
  const filler = Array.from({ length: PACKET }, (_, i) => (i === 0 ? 0x47 : 1));
  return new Uint8Array([...packet(0, pat), ...packet(0x100, body), ...filler, ...filler]);
}

function respond(status: number, body?: Uint8Array): Response {
  return new Response(body ?? null, { status });
}

describe('diagnoseStream', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setServicePort(null);
  });

  it.each([
    [404, 'offline'], [410, 'offline'],
    [401, 'denied'], [403, 'denied'],
    [429, 'busy'], [503, 'busy'],
    [400, 'unknown'],
  ])('maps HTTP %i to %s', async (status, reason) => {
    fetchMock.mockResolvedValue(respond(status));
    expect(await diagnoseStream('http://host/live/1.ts')).toEqual({ reason, status });
  });

  it('calls an empty answer an offline channel', async () => {
    fetchMock.mockResolvedValue(respond(200, new Uint8Array(0)));
    expect(await diagnoseStream('http://host/live/1.ts')).toEqual({ reason: 'offline', status: 200 });
  });

  it('blames the format when the stream carries a codec the TV may refuse', async () => {
    fetchMock.mockResolvedValue(respond(200, transportStream(0x24)));
    expect(await diagnoseStream('http://host/live/1.ts'))
      .toEqual({ reason: 'format', status: 200, video: 'hevc', audio: ['aac'] });
  });

  it('does not blame the format for a common codec, but still reports it', async () => {
    fetchMock.mockResolvedValue(respond(200, transportStream(0x1b)));
    expect(await diagnoseStream('http://host/live/1.ts'))
      .toEqual({ reason: 'unknown', status: 200, video: 'h264', audio: ['aac'] });
  });

  it('treats an unreadable body (a playlist) as unknown', async () => {
    fetchMock.mockResolvedValue(respond(200, new TextEncoder().encode('#EXTM3U\n#EXTINF:4,\nseg.ts\n')));
    expect(await diagnoseStream('http://host/live/1.m3u8')).toEqual({ reason: 'unknown', status: 200 });
  });

  it('calls a request that times out unreachable', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const pending = diagnoseStream('http://host/live/1.ts');
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual({ reason: 'unreachable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks through the local proxy when the account needs a User-Agent', async () => {
    setServicePort(4000);
    fetchMock.mockResolvedValue(respond(404));
    await diagnoseStream('http://host/live/1.ts', 'UA/1');
    expect(fetchMock.mock.calls[0][0]).toContain('http://127.0.0.1:4000/proxy/1.ts?u=');
  });
});
