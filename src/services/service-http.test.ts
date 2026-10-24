import { afterEach, describe, expect, it } from 'vitest';
import { proxiedUrl, setServicePort } from './service-http';

afterEach(() => setServicePort(null));

describe('proxiedUrl', () => {
  it('returns the URL unchanged without a User-Agent or a running service', () => {
    setServicePort(4000);
    expect(proxiedUrl('http://host/a.ts')).toBe('http://host/a.ts');
    setServicePort(null);
    expect(proxiedUrl('http://host/a.ts', 'UA/1')).toBe('http://host/a.ts');
  });

  it('routes through the service and keeps the file name', () => {
    setServicePort(4000);
    expect(proxiedUrl('http://host/live/u/p/12.ts?x=1', 'UA/1')).toBe(
      'http://127.0.0.1:4000/proxy/12.ts?u=http%3A%2F%2Fhost%2Flive%2Fu%2Fp%2F12.ts%3Fx%3D1&ua=UA%2F1',
    );
  });
});
