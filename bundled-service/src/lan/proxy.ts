/**
 * Loopback-only forwarding proxy. The app's Chromium 53 ignores a script-set
 * User-Agent, so requests to a provider that validates it go through here and
 * leave with the account's User-Agent. HLS playlists are rewritten so every
 * segment and key request keeps flowing through the proxy.
 */

import * as http from 'http';
import * as https from 'https';
import * as nodeUrl from 'url';
import { bufferFrom } from '../compat';

const MAX_REDIRECTS = 5;
const UPSTREAM_IDLE_MS = 30 * 1000;
const MAX_PLAYLIST_BYTES = 4 * 1024 * 1024;
const PASS_REQUEST_HEADERS = ['range', 'if-range', 'accept', 'accept-encoding', 'accept-language'];
const PASS_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'content-encoding',
  'accept-ranges',
  'last-modified',
  'etag',
];

export interface ProxyRequest {
  target: string;
  userAgent: string;
  proxyBase: string;
}

export function isValidUserAgent(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !/[^\x20-\x7e]/.test(value);
}

export function proxyUrl(proxyBase: string, target: string, userAgent: string): string {
  const parsed = nodeUrl.parse(target);
  const segments = (parsed.pathname || '').split('/');
  const name = segments[segments.length - 1] || 'stream';
  return proxyBase + '/proxy/' + encodeURIComponent(name) +
    '?u=' + encodeURIComponent(target) + '&ua=' + encodeURIComponent(userAgent);
}

// Resolves each URI against the playlist URL and sends it back through the proxy.
export function rewritePlaylist(text: string, playlistUrl: string, userAgent: string, proxyBase: string): string {
  const wrap = (uri: string): string =>
    proxyUrl(proxyBase, nodeUrl.resolve(playlistUrl, uri), userAgent);
  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.charAt(0) !== '#') return wrap(trimmed);
    return line.replace(/URI="([^"]*)"/g, (_match: string, uri: string) => 'URI="' + wrap(uri) + '"');
  }).join('\n');
}

function abortRequest(request: http.ClientRequest): void {
  const target = request as unknown as { destroy?: () => void; abort?: () => void };
  if (typeof target.abort === 'function') target.abort();
  else if (typeof target.destroy === 'function') target.destroy();
}

function fail(res: http.ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const body = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function isPlaylistPath(target: string): boolean {
  return /\.m3u8$/i.test(nodeUrl.parse(target).pathname || '');
}

function isPlaylistType(contentType: string): boolean {
  return /mpegurl/i.test(contentType);
}

export function forwardRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  proxy: ProxyRequest,
): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    fail(res, 405, 'Method not allowed');
    return;
  }

  let upstream: http.ClientRequest | null = null;
  res.on('close', () => { if (upstream) abortRequest(upstream); });

  function send(target: string, redirects: number): void {
    const parsed = nodeUrl.parse(target);
    const secure = parsed.protocol === 'https:';
    if (!secure && parsed.protocol !== 'http:') {
      fail(res, 400, 'Unsupported protocol');
      return;
    }
    const headers: { [name: string]: string } = { 'User-Agent': proxy.userAgent };
    for (let i = 0; i < PASS_REQUEST_HEADERS.length; i++) {
      const value = req.headers[PASS_REQUEST_HEADERS[i]];
      if (typeof value === 'string') headers[PASS_REQUEST_HEADERS[i]] = value;
    }
    // A playlist is rewritten, so it must arrive uncompressed.
    if (isPlaylistPath(target)) headers['accept-encoding'] = 'identity';

    const options = {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: req.method,
      headers,
      // Providers commonly serve self-signed or mismatched certificates.
      rejectUnauthorized: false,
    };
    const request = (secure ? https : http).request(options, (upstreamRes) => {
      const status = upstreamRes.statusCode || 502;
      const location = upstreamRes.headers.location;
      if (status >= 300 && status < 400 && typeof location === 'string') {
        upstreamRes.resume();
        if (redirects >= MAX_REDIRECTS) {
          fail(res, 502, 'Too many redirects');
          return;
        }
        send(nodeUrl.resolve(target, location), redirects + 1);
        return;
      }

      const outHeaders: { [name: string]: string | string[] } = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Accept-Ranges',
      };
      for (let i = 0; i < PASS_RESPONSE_HEADERS.length; i++) {
        const value = upstreamRes.headers[PASS_RESPONSE_HEADERS[i]];
        if (value !== undefined) outHeaders[PASS_RESPONSE_HEADERS[i]] = value as string | string[];
      }

      const contentType = String(upstreamRes.headers['content-type'] || '');
      const rewrite = status === 200 && req.method === 'GET' &&
        !upstreamRes.headers['content-encoding'] &&
        (isPlaylistType(contentType) || isPlaylistPath(target));
      if (!rewrite) {
        res.writeHead(status, outHeaders);
        upstreamRes.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      let size = 0;
      upstreamRes.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_PLAYLIST_BYTES) {
          abortRequest(request);
          fail(res, 502, 'Playlist too large');
          return;
        }
        chunks.push(chunk);
      });
      upstreamRes.on('end', () => {
        if (res.headersSent) return;
        const text = Buffer.concat(chunks).toString('utf-8');
        // Only HLS playlists carry URIs to rewrite; any other body passes through.
        const body = bufferFrom(/^\s*#EXTM3U/.test(text)
          ? rewritePlaylist(text, target, proxy.userAgent, proxy.proxyBase)
          : text, 'utf-8');
        outHeaders['content-length'] = String(body.length);
        res.writeHead(status, outHeaders);
        res.end(body);
      });
      upstreamRes.on('error', () => res.end());
    });
    upstream = request;
    request.setTimeout(UPSTREAM_IDLE_MS, () => {
      abortRequest(request);
      fail(res, 504, 'Upstream timed out');
    });
    request.on('error', (err: Error) => fail(res, 502, 'Upstream failed: ' + err.message));
    request.end();
  }

  send(proxy.target, 0);
}
