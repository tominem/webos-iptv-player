import type { SearchScope } from '../components/search';

export type ContentSection = 'live' | 'movies' | 'series';
export type ActiveSection = ContentSection | 'home';
// hot: channels and guide in memory; warm: channels only; cold: nothing.
export type LiveState = 'cold' | 'warm' | 'hot';

export interface SectionOps {
  loadChannels(): Promise<void>;
  loadGuide(): Promise<void>;
  dropGuide(): void;
  dropChannels(): void;
  releaseCatalog(section: 'movies' | 'series'): void;
  heapUsedBytes(): number | null;
  onError(what: 'guide', err: unknown): void;
}

export interface SectionDataOptions {
  heapCapBytes: number;
  // A guide just dropped still counts in the heap until it is collected.
  heapRecheckMs: number;
}

// Keeps one content section's data in memory at a time. Live leaves its channel
// list behind (warm) so coming back is instant, until the JS heap passes the cap.
export class SectionData {
  active: ActiveSection = 'home';
  liveState: LiveState = 'cold';
  private catalog: 'movies' | 'series' | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private guideLoad: Promise<void> = Promise.resolve();
  private heapTimer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by invalidate(), so a load that started under the old settings is discarded.
  private epoch = 0;
  private guideEpoch = 0;

  constructor(
    private readonly ops: SectionOps,
    private readonly options: SectionDataOptions,
  ) {}

  // Changes whenever a guide starts loading or is dropped.
  get guideGeneration(): number {
    return this.guideEpoch;
  }

  enter(section: ActiveSection): Promise<void> {
    return this.run(async () => {
      this.active = section;
      this.switchCatalog(section === 'movies' || section === 'series' ? section : null);
      if (section === 'live') {
        this.clearHeapTimer();
        await this.warmChannels();
        this.heatGuide();
        return;
      }
      this.coolLive();
    });
  }

  // Settles once the guide that entering live started has loaded (or failed).
  guideReady(): Promise<void> {
    return this.guideLoad;
  }

  ensureChannels(): Promise<void> {
    return this.run(() => this.warmChannels());
  }

  // Drops everything and returns the section whose data the caller should reload.
  invalidate(): ActiveSection {
    this.epoch++;
    this.clearHeapTimer();
    if (this.liveState === 'hot') this.dropGuide();
    if (this.liveState !== 'cold') this.ops.dropChannels();
    this.liveState = 'cold';
    this.ops.releaseCatalog('movies');
    this.ops.releaseCatalog('series');
    this.catalog = null;
    return this.active;
  }

  private run(task: () => Promise<void>): Promise<void> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async warmChannels(): Promise<void> {
    while (this.liveState === 'cold') {
      const epoch = this.epoch;
      await this.ops.loadChannels();
      if (epoch === this.epoch) {
        this.liveState = 'warm';
        return;
      }
      // The sources changed while this list loaded: it is stale, load it again.
      this.ops.dropChannels();
    }
  }

  private dropGuide(): void {
    this.ops.dropGuide();
    this.guideEpoch++;
  }

  private heatGuide(): void {
    if (this.liveState !== 'warm') return;
    this.guideEpoch++;
    this.liveState = 'hot';
    this.guideLoad = this.ops.loadGuide().catch((err: unknown) => this.ops.onError('guide', err));
  }

  private coolLive(): void {
    const guideDropped = this.liveState === 'hot';
    if (guideDropped) {
      this.dropGuide();
      this.liveState = 'warm';
    }
    if (this.liveState !== 'warm') return;
    // Right after a drop the heap still holds the guide: look again once it is collected.
    if (guideDropped || this.heapTimer) this.scheduleHeapCheck();
    else this.dropChannelsOverCap();
  }

  private dropChannelsOverCap(): void {
    const heap = this.ops.heapUsedBytes();
    if (heap === null || heap <= this.options.heapCapBytes) return;
    this.ops.dropChannels();
    this.liveState = 'cold';
  }

  private scheduleHeapCheck(): void {
    this.clearHeapTimer();
    this.heapTimer = setTimeout(() => {
      this.heapTimer = null;
      // Any move to live or invalidate() clears this timer, so live is still warm and behind.
      void this.run(async () => this.dropChannelsOverCap());
    }, this.options.heapRecheckMs);
  }

  private clearHeapTimer(): void {
    if (this.heapTimer === null) return;
    clearTimeout(this.heapTimer);
    this.heapTimer = null;
  }

  private switchCatalog(next: 'movies' | 'series' | null): void {
    if (this.catalog && this.catalog !== next) this.ops.releaseCatalog(this.catalog);
    this.catalog = next;
  }
}

export function searchScopeFor(active: ActiveSection): SearchScope {
  return active === 'home' ? 'live' : active;
}

export function prewarmKindsFor(active: ActiveSection): { live: boolean; movies: boolean; series: boolean } {
  return { live: active === 'live', movies: active === 'movies', series: active === 'series' };
}

const START_SECTIONS: readonly ActiveSection[] = ['home', 'live', 'movies', 'series'];

// `?start=live` opens a section directly; anything else opens the home screen.
export function parseStartSection(search: string): ActiveSection {
  const value = new URLSearchParams(search).get('start');
  return START_SECTIONS.find(section => section === value) ?? 'home';
}
