import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SeekScrubber } from './seek-scrubber';

function make(position = 100, duration = 1000) {
  const calls = { move: [] as number[], commit: [] as number[], cancel: 0 };
  const scrubber = new SeekScrubber({
    step: 30,
    commitDelayMs: 800,
    position: () => position,
    duration: () => duration,
    onMove: target => calls.move.push(target),
    onCommit: target => calls.commit.push(target),
    onCancel: () => { calls.cancel++; },
  });
  return { scrubber, calls };
}

describe('SeekScrubber', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts from the playback position and moves the target by a step', () => {
    const { scrubber, calls } = make();
    expect(scrubber.active).toBe(false);
    scrubber.press(1);
    expect(scrubber.active).toBe(true);
    expect(scrubber.target).toBe(130);
    scrubber.press(-1);
    expect(scrubber.target).toBe(100);
    expect(calls.move).toEqual([130, 100]);
  });

  it('keeps the target inside the video', () => {
    const { scrubber } = make(10, 50);
    scrubber.press(-1);
    expect(scrubber.target).toBe(0);
    scrubber.press(1);
    scrubber.press(1);
    scrubber.press(1);
    expect(scrubber.target).toBe(50);
  });

  it('commits the target once the keys stop', () => {
    const { scrubber, calls } = make();
    scrubber.press(1);
    vi.advanceTimersByTime(799);
    expect(calls.commit).toEqual([]);
    scrubber.press(1);
    vi.advanceTimersByTime(799);
    expect(calls.commit).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls.commit).toEqual([160]);
    expect(scrubber.active).toBe(false);
  });

  it('starts slow again when the direction turns', () => {
    const { scrubber } = make(500, 5000);
    for (let i = 0; i < 12; i++) scrubber.press(1);
    const overshoot = scrubber.target!;
    scrubber.press(-1);
    expect(overshoot - scrubber.target!).toBe(30);
  });

  it('still commits when the preview fails on a press', () => {
    const commits: number[] = [];
    const scrubber = new SeekScrubber({
      step: 30, commitDelayMs: 800, position: () => 100, duration: () => 1000,
      onMove: () => { throw new Error('no bar'); },
      onCommit: target => commits.push(target),
      onCancel: () => {},
    });
    expect(() => scrubber.press(1)).toThrow('no bar');
    vi.advanceTimersByTime(800);
    expect(commits).toEqual([130]);
    expect(scrubber.active).toBe(false);
  });

  it('commits at once on request, and not again later', () => {
    const { scrubber, calls } = make();
    scrubber.press(1);
    scrubber.commit();
    expect(calls.commit).toEqual([130]);
    vi.advanceTimersByTime(2000);
    expect(calls.commit).toEqual([130]);
    scrubber.commit();
    expect(calls.commit).toEqual([130]);
  });

  it('cancels without seeking, and ignores a cancel when idle', () => {
    const { scrubber, calls } = make();
    scrubber.cancel();
    expect(calls.cancel).toBe(0);
    scrubber.press(1);
    scrubber.cancel();
    expect(calls.cancel).toBe(1);
    expect(scrubber.active).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(calls.commit).toEqual([]);
  });

  it('takes bigger steps the longer a key is held', () => {
    const { scrubber } = make(0, 100_000);
    const targets: number[] = [];
    for (let i = 0; i < 12; i++) {
      scrubber.press(1);
      targets.push(scrubber.target!);
    }
    expect(targets.slice(0, 5)).toEqual([30, 60, 90, 120, 150]);
    expect(targets[5] - targets[4]).toBe(60);
    expect(targets[11] - targets[10]).toBe(90);
  });

  it('starts at the normal step again after a commit', () => {
    const { scrubber } = make(0, 100_000);
    for (let i = 0; i < 8; i++) scrubber.press(1);
    scrubber.commit();
    scrubber.press(1);
    expect(scrubber.target).toBe(30);
  });

  it('has no target while idle', () => {
    const { scrubber } = make();
    expect(scrubber.target).toBeNull();
  });
});
