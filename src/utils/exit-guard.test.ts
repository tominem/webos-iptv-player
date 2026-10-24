import { describe, it, expect } from 'vitest';
import { createExitGuard } from './exit-guard';

describe('createExitGuard', () => {
  it('flushes before the first exit', () => {
    expect(createExitGuard().shouldFlush(1000)).toBe(true);
  });

  it('skips the flush on a repeat attempt right after a failure', () => {
    const guard = createExitGuard(3000);
    guard.recordFailure(1000);
    expect(guard.shouldFlush(2500)).toBe(false);
  });

  it('flushes again once the retry window has passed', () => {
    const guard = createExitGuard(3000);
    guard.recordFailure(1000);
    expect(guard.shouldFlush(4000)).toBe(true);
  });
});
