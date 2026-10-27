import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoFrameSource, type FrameCanvas, type FrameSourceDeps, type FrameVideo } from './frame-source';

type Listener = () => void;

function fakeVideo() {
  const listeners = new Map<string, Set<Listener>>();
  const video = {
    currentTime: 0,
    readyState: 0,
    videoWidth: 1920,
    videoHeight: 1080,
    src: '',
    muted: false,
    preload: '',
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    remove: vi.fn(),
    addEventListener: (type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => { listeners.get(type)?.delete(fn); },
  };
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach(fn => fn());
  return { video: video as unknown as FrameVideo & typeof video, fire, listeners };
}

function fakeCanvas() {
  const draw = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: draw }) };
  return { canvas: canvas as unknown as FrameCanvas, draw };
}

function setup() {
  const v = fakeVideo();
  const c = fakeCanvas();
  const deps: FrameSourceDeps = { createVideo: () => v.video, createCanvas: () => c.canvas };
  const source = new VideoFrameSource('http://host/movie.mp4', deps, { width: 320, height: 180, timeoutMs: 1000 });
  return { source, ...v, ...c };
}

// Let the source reach its next wait.
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('VideoFrameSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loads the movie quietly and draws the frame at the asked time', async () => {
    const { source, video, fire, draw, canvas } = setup();
    const frame = source.frameAt(600);
    await tick();
    expect(video.src).toBe('http://host/movie.mp4');
    expect(video.muted).toBe(true);
    expect(video.preload).toBe('auto');
    fire('loadedmetadata');
    await tick();
    expect(video.currentTime).toBe(600);
    fire('seeked');
    expect(await frame).toBe(canvas);
    expect(draw).toHaveBeenCalledWith(video, 0, 0, 320, 180);
    expect(canvas.width).toBe(320);
    expect(canvas.height).toBe(180);
  });

  it('does not reload a movie that is ready', async () => {
    const { source, video, fire } = setup();
    const first = source.frameAt(10);
    await tick();
    fire('loadedmetadata');
    await tick();
    fire('seeked');
    await first;
    video.readyState = 1;
    const second = source.frameAt(20);
    await tick();
    expect(video.currentTime).toBe(20);
    fire('seeked');
    await second;
    expect(video.load).not.toHaveBeenCalled();
  });

  it('answers only the latest request when several arrive', async () => {
    const { source, video, fire } = setup();
    video.readyState = 1;
    const early = source.frameAt(100);
    await tick();
    const late = source.frameAt(200);
    await tick();
    video.currentTime = 200;
    fire('seeked');
    expect(await early).toBeNull();
    expect(await late).not.toBeNull();
  });

  it('drops a request that a newer one replaced while the movie was loading', async () => {
    const { source, video, fire } = setup();
    const early = source.frameAt(100);
    await tick();
    const late = source.frameAt(200);
    await tick();
    fire('loadedmetadata');
    await tick();
    expect(await early).toBeNull();
    video.currentTime = 200;
    fire('seeked');
    expect(await late).not.toBeNull();
  });

  it('gives up on a seek that does not land where it was asked', async () => {
    const { source, video, fire } = setup();
    video.readyState = 1;
    const frame = source.frameAt(500);
    await tick();
    video.currentTime = 100;
    fire('seeked');
    expect(await frame).toBeNull();
  });

  it('gives up on a movie that does not load in time, and then stops trying', async () => {
    const { source } = setup();
    const first = source.frameAt(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toBeNull();
    const second = source.frameAt(5);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBeNull();
    expect(source.available).toBe(false);
    expect(await source.frameAt(5)).toBeNull();
  });

  it('counts a load error as a failure', async () => {
    const { source, fire } = setup();
    const frame = source.frameAt(5);
    await tick();
    fire('error');
    expect(await frame).toBeNull();
    expect(source.available).toBe(true);
    const again = source.frameAt(5);
    await tick();
    fire('error');
    await again;
    expect(source.available).toBe(false);
  });

  it('gives up on a seek that never completes', async () => {
    const { source, video } = setup();
    video.readyState = 1;
    const frame = source.frameAt(50);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await frame).toBeNull();
  });

  it('is unavailable when the canvas cannot draw', async () => {
    const v = fakeVideo();
    const deps: FrameSourceDeps = {
      createVideo: () => v.video,
      createCanvas: () => ({ width: 0, height: 0, getContext: () => null }) as unknown as FrameCanvas,
    };
    const source = new VideoFrameSource('http://host/m.mp4', deps, { width: 320, height: 180, timeoutMs: 1000 });
    v.video.readyState = 1;
    const frame = source.frameAt(5);
    await tick();
    v.fire('seeked');
    expect(await frame).toBeNull();
    expect(source.available).toBe(true);
  });

  it('lets go of the video and its listeners on release', async () => {
    const { source, video, fire, listeners } = setup();
    const frame = source.frameAt(5);
    await tick();
    fire('loadedmetadata');
    await tick();
    fire('seeked');
    await frame;
    source.release();
    expect(video.pause).toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalled();
    expect(video.remove).toHaveBeenCalled();
    expect([...listeners.values()].every(set => set.size === 0)).toBe(true);
    // A later request starts over.
    video.readyState = 0;
    const again = source.frameAt(9);
    await tick();
    expect(video.src).toBe('http://host/movie.mp4');
    source.release();
    expect(await again).toBeNull();
  });

  it('does not count a wait ended by a release as a failure', async () => {
    const { source } = setup();
    const frame = source.frameAt(5);
    await tick();
    source.release();
    expect(await frame).toBeNull();
    expect(source.available).toBe(true);
  });

  it('release before any request does nothing', () => {
    const { source, video } = setup();
    source.release();
    expect(video.pause).not.toHaveBeenCalled();
  });
});
