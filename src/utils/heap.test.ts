import { afterEach, describe, expect, it, vi } from 'vitest';
import { usedHeapBytes } from './heap';

describe('usedHeapBytes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the JS heap from performance.memory', () => {
    vi.stubGlobal('performance', { memory: { usedJSHeapSize: 1234 } });
    expect(usedHeapBytes()).toBe(1234);
  });

  it('is unknown where the engine does not report it', () => {
    vi.stubGlobal('performance', {});
    expect(usedHeapBytes()).toBeNull();
  });
});
