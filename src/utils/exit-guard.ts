// A failed exit flush must not trap the user in the app: storage can stay
// broken until the TV's web runtime restarts, so a repeat exit attempt right
// after the failure leaves without flushing.
export function createExitGuard(retryWindowMs = 3000) {
  let failedAt = -Infinity;
  return {
    shouldFlush(now: number): boolean {
      return now - failedAt >= retryWindowMs;
    },
    recordFailure(now: number): void {
      failedAt = now;
    },
  };
}
