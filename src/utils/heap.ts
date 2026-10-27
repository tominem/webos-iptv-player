interface MemoryInfo { usedJSHeapSize: number }

// Chromium-only; null where the engine does not report it.
export function usedHeapBytes(): number | null {
  const memory = (performance as unknown as { memory?: MemoryInfo }).memory;
  return memory ? memory.usedJSHeapSize : null;
}
