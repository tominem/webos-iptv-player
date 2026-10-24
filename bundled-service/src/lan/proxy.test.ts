/**
 * Tests for the loopback forwarding proxy, against a local upstream that
 * echoes the User-Agent it receives.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { startServer } from './server';
import { proxyUrl, rewritePlaylist } from './proxy';

let service: http.Server;
let upstream: http.Server;
let base: string;
let origin: string;
let dataDir: string;
const seen: Array<{ url: string; ua?: string; range?: string }> = [];

function viaProxy(target: string, ua = 'UA/1'): string {
  return `${base}/proxy/x?u=${encodeURIComponent(target)}&ua=${encodeURIComponent(ua)}`;
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url || '', ua: req.headers['user-agent'], range: req.headers.range });
    if (req.url === '/api') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ua: req.headers['user-agent'] }));
    } else if (req.url === '/hop') {
      res.writeHead(302, { Location: '/api' });
      res.end();
    } else if (req.url === '/live/master.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      res.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n');
    } else if (req.url === '/video.mp4') {
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-3/10' });
      res.end('abcd');
    } else {
      res.writeHead(403);
      res.end('Access denied');
    }
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', () => resolve()));
  origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
  const started = await startServer(0, dataDir);
  service = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => service.close(() => resolve()));
  await new Promise<void>(resolve => upstream.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('/proxy', () => {
  it('sends the requested User-Agent upstream and allows cross-origin reads', async () => {
    const res = await fetch(viaProxy(`${origin}/api`, 'Provider/9'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ ua: 'Provider/9' });
  });

  it('follows redirects with the same User-Agent', async () => {
    const res = await fetch(viaProxy(`${origin}/hop`, 'Provider/9'));
    expect(await res.json()).toEqual({ ua: 'Provider/9' });
  });

  it('passes Range and the partial status through', async () => {
    const res = await fetch(viaProxy(`${origin}/video.mp4`), { headers: { Range: 'bytes=0-3' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-3/10');
    expect(await res.text()).toBe('abcd');
    expect(seen[seen.length - 1].range).toBe('bytes=0-3');
  });

  it('passes upstream errors through', async () => {
    const res = await fetch(viaProxy(`${origin}/missing`));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('Access denied');
  });

  it('rewrites HLS playlist URIs back through the proxy', async () => {
    const text = await (await fetch(viaProxy(`${origin}/live/master.m3u8`, 'P/1'))).text();
    const key = `${base}/proxy/key.bin?u=${encodeURIComponent(`${origin}/live/key.bin`)}&ua=P%2F1`;
    const seg = `${base}/proxy/seg1.ts?u=${encodeURIComponent(`${origin}/live/seg1.ts`)}&ua=P%2F1`;
    expect(text).toContain(`URI="${key}"`);
    expect(text.split('\n')).toContain(seg);
  });

  it('rejects a missing or unsafe target and User-Agent', async () => {
    expect((await fetch(`${base}/proxy/x?ua=UA`)).status).toBe(400);
    expect((await fetch(`${base}/proxy/x?u=file:///etc/hosts&ua=UA`)).status).toBe(400);
    expect((await fetch(viaProxy(`${origin}/api`, ''))).status).toBe(400);
    expect((await fetch(viaProxy(`${origin}/api`, 'aé'))).status).toBe(400);
  });

  it('refuses non-GET methods', async () => {
    expect((await fetch(viaProxy(`${origin}/api`), { method: 'POST', body: 'x' })).status).toBe(405);
  });
});

describe('proxy URL helpers', () => {
  it('keeps the file name so the player can detect the format', () => {
    expect(proxyUrl('http://h', 'http://p/live/u/p/12.ts', 'UA'))
      .toBe('http://h/proxy/12.ts?u=http%3A%2F%2Fp%2Flive%2Fu%2Fp%2F12.ts&ua=UA');
  });

  it('leaves non-URI playlist tags alone', () => {
    expect(rewritePlaylist('#EXTM3U\n#EXT-X-VERSION:3', 'http://p/a.m3u8', 'UA', 'http://h'))
      .toBe('#EXTM3U\n#EXT-X-VERSION:3');
  });
});
