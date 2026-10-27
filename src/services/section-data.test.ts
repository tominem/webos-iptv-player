import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionData, searchScopeFor, prewarmKindsFor, parseStartSection, type SectionOps } from './section-data';

function makeOps(heap: number | null = 10) {
  const ops = {
    heap,
    loadChannels: vi.fn(async () => {}),
    loadGuide: vi.fn(async () => {}),
    dropGuide: vi.fn(),
    dropChannels: vi.fn(),
    releaseCatalog: vi.fn(),
    heapUsedBytes: vi.fn((): number | null => ops.heap),
    onError: vi.fn(),
  };
  return ops satisfies SectionOps & { heap: number | null };
}

describe('SectionData', () => {
  let ops: ReturnType<typeof makeOps>;
  let data: SectionData;

  beforeEach(() => {
    vi.useFakeTimers();
    ops = makeOps();
    data = new SectionData(ops, { heapCapBytes: 100, heapRecheckMs: 1000 });
  });

  afterEach(() => vi.useRealTimers());

  it('starts cold on the home screen', () => {
    expect(data.active).toBe('home');
    expect(data.liveState).toBe('cold');
  });

  it('loads channels, then the guide in the background, on entering live', async () => {
    await data.enter('live');
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
    expect(data.active).toBe('live');
    expect(data.liveState).toBe('hot');
    expect(ops.loadGuide).toHaveBeenCalledTimes(1);
  });

  it('does not reload anything when live is already hot', async () => {
    await data.enter('live');
    await data.enter('live');
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
    expect(ops.loadGuide).toHaveBeenCalledTimes(1);
  });

  it('reports a guide failure without failing the section', async () => {
    const boom = new Error('guide');
    ops.loadGuide.mockRejectedValueOnce(boom);
    await data.enter('live');
    await Promise.resolve();
    await Promise.resolve();
    expect(ops.onError).toHaveBeenCalledWith('guide', boom);
    expect(data.liveState).toBe('hot');
  });

  it('lets a caller wait for the guide to finish loading', async () => {
    let release = (): void => {};
    ops.loadGuide.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await data.enter('live');
    let ready = false;
    const waiting = data.guideReady().then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    release();
    await waiting;
    expect(ready).toBe(true);
  });

  it('has no guide to wait for before live opens', async () => {
    await expect(data.guideReady()).resolves.toBeUndefined();
  });

  it('keeps the channel list but drops the guide when leaving live', async () => {
    await data.enter('live');
    await data.enter('movies');
    expect(ops.dropGuide).toHaveBeenCalledTimes(1);
    expect(ops.dropChannels).not.toHaveBeenCalled();
    expect(data.liveState).toBe('warm');
  });

  it('reloads only the guide when returning to a warm live', async () => {
    await data.enter('live');
    await data.enter('series');
    await data.enter('live');
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
    expect(ops.loadGuide).toHaveBeenCalledTimes(2);
    expect(data.liveState).toBe('hot');
  });

  it('judges the heap only after the dropped guide had time to be collected', async () => {
    await data.enter('live');
    ops.heap = 101;
    await data.enter('movies');
    expect(ops.dropChannels).not.toHaveBeenCalled();
    expect(data.liveState).toBe('warm');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ops.dropChannels).toHaveBeenCalledTimes(1);
    expect(data.liveState).toBe('cold');
  });

  it('keeps the channel list when the heap settles under the cap', async () => {
    await data.enter('live');
    ops.heap = 101;
    await data.enter('movies');
    ops.heap = 50;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ops.dropChannels).not.toHaveBeenCalled();
    expect(data.liveState).toBe('warm');
  });

  it('skips the late check when live is back in front', async () => {
    await data.enter('live');
    ops.heap = 101;
    await data.enter('movies');
    await data.enter('live');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ops.dropChannels).not.toHaveBeenCalled();
    expect(data.liveState).toBe('hot');
  });

  it('restarts the late check when the user keeps moving between sections', async () => {
    await data.enter('live');
    ops.heap = 101;
    await data.enter('movies');
    await vi.advanceTimersByTimeAsync(600);
    await data.enter('series');
    await vi.advanceTimersByTimeAsync(600);
    expect(ops.dropChannels).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(ops.dropChannels).toHaveBeenCalledTimes(1);
  });

  it('judges a channel list left warm at once, since no guide is pending collection', async () => {
    await data.ensureChannels();
    ops.heap = 101;
    await data.enter('movies');
    expect(ops.dropChannels).toHaveBeenCalledTimes(1);
    expect(data.liveState).toBe('cold');
  });

  it('stays warm when the heap is unknown', async () => {
    ops.heap = null;
    await data.enter('live');
    await data.enter('movies');
    await vi.advanceTimersByTimeAsync(1000);
    expect(ops.dropChannels).not.toHaveBeenCalled();
    expect(data.liveState).toBe('warm');
  });

  it('numbers each guide so a stale load can tell it was replaced', async () => {
    const first = data.guideGeneration;
    await data.enter('live');
    const loaded = data.guideGeneration;
    expect(loaded).not.toBe(first);
    await data.enter('movies');
    expect(data.guideGeneration).not.toBe(loaded);
    const dropped = data.guideGeneration;
    await data.enter('live');
    expect(data.guideGeneration).not.toBe(dropped);
  });

  it('reloads the channels when the settings changed during a load', async () => {
    let release = (): void => {};
    ops.loadChannels.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const entering = data.enter('live');
    await vi.waitFor(() => expect(ops.loadChannels).toHaveBeenCalled());
    data.invalidate();
    release();
    await entering;
    expect(ops.loadChannels).toHaveBeenCalledTimes(2);
    expect(ops.dropChannels).toHaveBeenCalledTimes(1);
    expect(data.liveState).toBe('hot');
  });

  it('reloads channels when live is entered cold', async () => {
    await data.enter('live');
    ops.heap = 101;
    await data.enter('movies');
    await vi.advanceTimersByTimeAsync(1000);
    ops.heap = 10;
    await data.enter('live');
    expect(ops.loadChannels).toHaveBeenCalledTimes(2);
  });

  it('keeps only one catalog section in memory', async () => {
    await data.enter('movies');
    expect(ops.releaseCatalog).not.toHaveBeenCalled();
    await data.enter('series');
    expect(ops.releaseCatalog).toHaveBeenCalledWith('movies');
    await data.enter('live');
    expect(ops.releaseCatalog).toHaveBeenCalledWith('series');
  });

  it('does not touch live when moving between catalogs from a cold live', async () => {
    await data.enter('movies');
    await data.enter('series');
    expect(ops.dropGuide).not.toHaveBeenCalled();
    expect(data.liveState).toBe('cold');
  });

  it('frees catalogs and the guide on the home screen', async () => {
    await data.enter('live');
    await data.enter('movies');
    await data.enter('home');
    expect(ops.releaseCatalog).toHaveBeenCalledWith('movies');
    expect(data.active).toBe('home');
    expect(data.liveState).toBe('warm');
  });

  it('ensureChannels loads a cold list without changing the active section', async () => {
    await data.ensureChannels();
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
    expect(data.active).toBe('home');
    expect(data.liveState).toBe('warm');
    await data.ensureChannels();
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
  });

  it('ensureChannels leaves a hot live alone', async () => {
    await data.enter('live');
    await data.ensureChannels();
    expect(data.liveState).toBe('hot');
  });

  it('shares one load between concurrent callers', async () => {
    let release = (): void => {};
    ops.loadChannels.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = data.enter('live');
    const second = data.ensureChannels();
    await vi.waitFor(() => expect(ops.loadChannels).toHaveBeenCalled());
    release();
    await Promise.all([first, second]);
    expect(ops.loadChannels).toHaveBeenCalledTimes(1);
  });

  it('runs transitions in order', async () => {
    let release = (): void => {};
    ops.loadChannels.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const live = data.enter('live');
    const movies = data.enter('movies');
    await vi.waitFor(() => expect(ops.loadChannels).toHaveBeenCalled());
    expect(ops.dropGuide).not.toHaveBeenCalled();
    release();
    await Promise.all([live, movies]);
    expect(ops.dropGuide).toHaveBeenCalledTimes(1);
    expect(data.active).toBe('movies');
  });

  it('survives a failed channel load and lets the next enter retry', async () => {
    ops.loadChannels.mockRejectedValueOnce(new Error('offline'));
    await expect(data.enter('live')).rejects.toThrow('offline');
    expect(data.liveState).toBe('cold');
    await data.enter('live');
    expect(data.liveState).toBe('hot');
    expect(ops.loadChannels).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops everything and reports the section to reload', async () => {
    await data.enter('live');
    const active = data.invalidate();
    expect(active).toBe('live');
    expect(ops.dropGuide).toHaveBeenCalled();
    expect(ops.dropChannels).toHaveBeenCalled();
    expect(ops.releaseCatalog).toHaveBeenCalledWith('movies');
    expect(ops.releaseCatalog).toHaveBeenCalledWith('series');
    expect(data.liveState).toBe('cold');
  });

  it('invalidate on a cold home does not drop live twice', () => {
    expect(data.invalidate()).toBe('home');
    expect(ops.dropGuide).not.toHaveBeenCalled();
    expect(ops.dropChannels).not.toHaveBeenCalled();
  });
});

describe('searchScopeFor', () => {
  it('searches the section the user is in', () => {
    expect(searchScopeFor('live')).toBe('live');
    expect(searchScopeFor('movies')).toBe('movies');
    expect(searchScopeFor('series')).toBe('series');
  });

  it('falls back to live from home, where nothing else is loaded', () => {
    expect(searchScopeFor('home')).toBe('live');
  });
});

describe('prewarmKindsFor', () => {
  it('warms only what the active section holds', () => {
    expect(prewarmKindsFor('live')).toEqual({ live: true, movies: false, series: false });
    expect(prewarmKindsFor('movies')).toEqual({ live: false, movies: true, series: false });
    expect(prewarmKindsFor('series')).toEqual({ live: false, movies: false, series: true });
    expect(prewarmKindsFor('home')).toEqual({ live: false, movies: false, series: false });
  });
});

describe('parseStartSection', () => {
  it('opens the home screen by default', () => {
    expect(parseStartSection('')).toBe('home');
    expect(parseStartSection('?other=1')).toBe('home');
  });

  it('lets a launch name the content section to open', () => {
    expect(parseStartSection('?start=live')).toBe('live');
    expect(parseStartSection('?start=movies')).toBe('movies');
    expect(parseStartSection('?start=series')).toBe('series');
    expect(parseStartSection('?start=home')).toBe('home');
  });

  it('ignores a section it does not know', () => {
    expect(parseStartSection('?start=guide')).toBe('home');
    expect(parseStartSection('?start=')).toBe('home');
  });
});
