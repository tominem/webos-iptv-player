import { CONFIG } from '../config';

// The LAN service binds to an OS-assigned port at startup and reports it
// through the Luna `start` response (see app.ts → startBundledService). Until
// setServicePort() receives that value, serviceBase() returns null and both LAN
// clients behave as if the service were unreachable. This also covers dev and
// e2e environments where Luna is unavailable and no service runs.
let runtimePort: number | null = null;

export function setServicePort(port: number | null): void {
  if (port === null) {
    runtimePort = null;
    return;
  }
  if (typeof port === 'number' && port > 0 && port < 65536) {
    runtimePort = port;
  }
}

// Chromium 53 ignores a script-set User-Agent, so a request that needs one is
// routed through the bundled service, which sets it. The name keeps the
// original extension for the player's URL-based format detection. Without the
// service (desktop preview, service down) the URL is returned unchanged.
export function proxiedUrl(url: string, userAgent?: string): string {
  const base = userAgent ? serviceBase() : null;
  if (!base || !userAgent) return url;
  const path = url.split(/[?#]/)[0];
  const name = path.slice(path.lastIndexOf('/') + 1) || 'stream';
  return `${base}/proxy/${encodeURIComponent(name)}?u=${encodeURIComponent(url)}&ua=${encodeURIComponent(userAgent)}`;
}

export function serviceBase(): string | null {
  if (runtimePort === null) return null;
  return `http://${CONFIG.SERVICE_HOST}:${runtimePort}`;
}
