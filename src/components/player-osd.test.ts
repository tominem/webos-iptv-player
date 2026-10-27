// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../config';
import { StorageService } from '../services/storage-service';
import type { Channel, Programme } from '../types';
import type { DvrState } from '../utils/dvr';
import { PlayerOsd, type PlayerOsdOptions, type PlayerOsdSnapshot } from './player-osd';

const CHANNEL: Channel = {
  id: 'ch1',
  name: 'Alpha',
  logo: 'http://host/logo',
  group: 'Group 1',
  url: 'http://host/a',
  extras: null,
  playlistIds: [],
  catchup: '',
  catchupSource: '',
  catchupDays: 0,
};

const PROGRAMME: Programme = {
  start: new Date('2026-01-01T10:00:00Z'),
  stop: new Date('2026-01-01T11:00:00Z'),
  title: 'Programme 1',
  description: 'Description 1',
  category: 'Category 1',
  icon: 'http://host/icon',
};

function playback(duration: number, position = 0, paused = false) {
  return { duration, position, paused };
}

function snapshot(overrides: Partial<PlayerOsdSnapshot> = {}): PlayerOsdSnapshot {
  return {
    playback: null,
    channel: CHANNEL,
    channelNumber: 1,
    catchup: null,
    vodTitle: null,
    upNextSeconds: 0,
    hasNextEpisode: false,
    dvr: null,
    nowPlaying: null,
    upcoming: null,
    streamInfo: null,
    ...overrides,
  };
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
  } as DOMRect;
}

describe('PlayerOsd', () => {
  let container: HTMLElement;
  let state: PlayerOsdSnapshot;
  let callbacks: PlayerOsdOptions;
  let osd: PlayerOsd;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    container = document.createElement('div');
    container.innerHTML = '<div id="player-osd"></div>';
    document.body.appendChild(container);
    state = snapshot();
    callbacks = {
      getSnapshot: () => state,
      canAutoReveal: () => true,
      canSeek: () => true,
      onSeekFraction: vi.fn(),
      onPauseToggle: vi.fn(),
      onGoLive: vi.fn(),
      onResync: vi.fn(),
      onNextEpisode: vi.fn(),
      onPlayNext: vi.fn(),
      onCancelNext: vi.fn(),
    };
    osd = new PlayerOsd(container, callbacks);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('next episode button', () => {
    const button = () => container.querySelector<HTMLElement>('[data-next-episode]');

    it('is drawn only when an episode follows', () => {
      state = snapshot({ playback: playback(120, 30), channel: null, vodTitle: 'Episode 1' });
      osd.render();
      expect(button()).toBeNull();
      state = { ...state, hasNextEpisode: true };
      osd.render();
      expect(button()).not.toBeNull();
      expect(button()?.getAttribute('aria-label')).toBe('Next episode');
    });

    it('starts the next episode when it is clicked, and not for a click elsewhere', () => {
      state = snapshot({
        playback: playback(120, 30), channel: null, vodTitle: 'Episode 1', hasNextEpisode: true,
      });
      osd.render();
      button()!.getBoundingClientRect = () => rect(500, 10, 30, 30);
      container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 20 }));
      expect(callbacks.onNextEpisode).not.toHaveBeenCalled();
      container.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 510, clientY: 20 }));
      expect(callbacks.onNextEpisode).toHaveBeenCalledOnce();
    });
  });

  describe('a render in the middle of a seek', () => {
    it('keeps the bar and clock at the target, not the playing position', () => {
      state = snapshot({ playback: playback(120, 30), channel: null, vodTitle: 'Video 1' });
      osd.show();
      osd.showSeekPreview(0.75, '1:30');
      osd.render();
      expect(container.querySelector<HTMLElement>('.osd-progress-bar')?.style.width).toBe('75%');
      expect(container.querySelector('.osd-time-current')?.textContent).toBe('1:30');
      osd.hideSeekPreview();
      osd.render();
      expect(container.querySelector<HTMLElement>('.osd-progress-bar')?.style.width).toBe('25%');
      expect(container.querySelector('.osd-time-current')?.textContent).toBe('0:30');
    });
  });

  describe('seek preview', () => {
    const popup = () => container.querySelector('.osd-seek-preview');

    beforeEach(() => {
      state = snapshot({ playback: playback(7200, 600), channel: null, vodTitle: 'Movie' });
      osd.show();
    });

    it('moves the bar and the clock to the target and shows the preview there', () => {
      osd.showSeekPreview(0.5, '1:00:00');
      expect((container.querySelector('.osd-progress-bar') as HTMLElement).style.width).toBe('50%');
      expect(container.querySelector('.osd-time-current')?.textContent).toBe('1:00:00');
      expect(popup()?.classList.contains('hidden')).toBe(false);
      expect(popup()?.querySelector('.osd-seek-preview-time')?.textContent).toBe('1:00:00');
    });

    it('stops the bar easing while previewing, and eases again after', () => {
      const osdEl = () => container.querySelector('#player-osd')!;
      osd.showSeekPreview(0.5, '1:00:00');
      expect(osdEl().classList.contains('scrubbing')).toBe(true);
      osd.hideSeekPreview();
      expect(osdEl().classList.contains('scrubbing')).toBe(false);
    });

    it('keeps the OSD up while the keys move', () => {
      osd.showSeekPreview(0.5, '1:00:00');
      vi.advanceTimersByTime(CONFIG.PLAYER.DEFAULT_PLAYER_OSD_TIMEOUT_MS - 1);
      osd.showSeekPreview(0.6, '1:12:00');
      vi.advanceTimersByTime(CONFIG.PLAYER.DEFAULT_PLAYER_OSD_TIMEOUT_MS - 1);
      expect(osd.isVisible()).toBe(true);
    });

    it('shows the OSD when it was hidden', () => {
      osd.hide();
      osd.showSeekPreview(0.1, '12:00');
      expect(osd.isVisible()).toBe(true);
    });

    it('does not let the playing position pull the bar back while previewing', () => {
      osd.showSeekPreview(0.5, '1:00:00');
      osd.refreshProgress();
      expect((container.querySelector('.osd-progress-bar') as HTMLElement).style.width).toBe('50%');
    });

    it('goes back to following playback once the preview is hidden', () => {
      osd.showSeekPreview(0.5, '1:00:00');
      osd.hideSeekPreview();
      expect(popup()?.classList.contains('hidden')).toBe(true);
      osd.refreshProgress();
      expect((container.querySelector('.osd-progress-bar') as HTMLElement).style.width)
        .toBe(`${String(600 / 7200 * 100)}%`);
    });

    it('hides the preview with the OSD', () => {
      osd.showSeekPreview(0.5, '1:00:00');
      osd.hide();
      expect(popup()?.classList.contains('hidden')).toBe(true);
    });

    it('puts a frame in the preview', () => {
      const canvas = document.createElement('canvas');
      osd.showSeekPreview(0.5, '1:00:00');
      osd.setSeekPreviewFrame(canvas);
      expect(popup()?.contains(canvas)).toBe(true);
    });
  });

  it('shows, hides, auto-reveals, and stays visible while paused', () => {
    state = snapshot({ playback: playback(120), vodTitle: 'Video 1' });

    osd.show();
    expect(osd.isVisible()).toBe(true);
    expect(container.querySelector('#player-osd')?.classList.contains('hidden')).toBe(false);
    vi.advanceTimersByTime(CONFIG.PLAYER.DEFAULT_PLAYER_OSD_TIMEOUT_MS);
    expect(osd.isVisible()).toBe(false);

    container.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: 12,
      clientY: 34,
    }));
    expect(osd.isVisible()).toBe(true);
    expect(osd.pointerPosition()).toEqual({ x: 12, y: 34 });

    state = { ...state, playback: playback(120, 0, true) };
    osd.resetTimer();
    vi.advanceTimersByTime(CONFIG.PLAYER.DEFAULT_PLAYER_OSD_TIMEOUT_MS);
    expect(osd.isVisible()).toBe(true);

    osd.clearPointer();
    osd.hide();
    expect(osd.pointerPosition()).toEqual({ x: null, y: null });
    expect(container.querySelector('#player-osd')?.classList.contains('hidden')).toBe(true);
  });

  it('uses the configured auto-hide timeout', () => {
    StorageService.setPlayerOsdTimeoutMs(3000);
    osd.show();
    vi.advanceTimersByTime(2999);
    expect(osd.isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(osd.isVisible()).toBe(false);
  });

  it('renders representative Live, catch-up, VOD, and up-next layouts', () => {
    state = snapshot({
      playback: playback(120, 30),
      nowPlaying: PROGRAMME,
      upcoming: { ...PROGRAMME, title: 'Programme 2' },
      streamInfo: {
        resolution: { tier: 'hd', label: 'Info 1' },
        hdr: 'HDR',
        drm: 'PlayReady',
        fps: '30',
        videoCodec: 'Codec 1',
        audioCodec: 'Codec 2',
        audio: 'Track 1',
        subtitle: 'Track 2',
      },
    });
    osd.show();
    expect(container.textContent).toContain('Alpha');
    expect(container.textContent).toContain('Programme 1');
    expect(container.textContent).toContain('Programme 2');
    expect(container.textContent).toContain('Info 1');
    expect(container.textContent).toContain('HDR');
    expect(container.textContent).toContain('PlayReady');
    expect(container.textContent).toContain('30fps');
    expect(container.textContent).toContain('Codec 1');
    expect(container.textContent).toContain('Audio Track: Track 1');

    state = snapshot({
      playback: playback(120, 30),
      catchup: {
        start: 1_000_000,
        end: 1_000_120,
        title: 'Programme 3',
        description: 'Description 3',
        icon: '',
      },
    });
    osd.render();
    expect(container.textContent).toContain('Programme 3');
    expect(container.querySelector('[data-seekbar]')).not.toBeNull();
    expect(container.querySelector('[data-resync]')).not.toBeNull();

    state = snapshot({ playback: playback(120, 30), channel: null, vodTitle: 'Video 1' });
    osd.render();
    expect(container.querySelector('.osd-channel-name')?.textContent).toContain('Video 1');
    expect(container.querySelector<HTMLElement>('.osd-progress-bar')?.style.width).toBe('25%');

    state = { ...state, vodTitle: 'Video 2', upNextSeconds: 5 };
    osd.render();
    expect(container.textContent).toContain('Video 2');
    expect(container.querySelector('[data-next-play]')).not.toBeNull();
    expect(container.querySelector('[data-next-cancel]')).not.toBeNull();
  });

  it('does not repeat an audio-track prefix already present in the name', () => {
    state = snapshot({
      streamInfo: {
        resolution: null,
        hdr: '',
        drm: '',
        fps: '',
        videoCodec: '',
        audioCodec: '',
        audio: 'Audio Track 1',
        subtitle: '',
      },
    });

    osd.show();

    expect(container.textContent).toContain('Audio Track 1');
    expect(container.textContent).not.toContain('Audio Track: Audio Track 1');
  });

  it('refreshes progress and switches an open Live OSD to the DVR layout', () => {
    state = snapshot({ playback: playback(Infinity, 30), nowPlaying: PROGRAMME });
    osd.show();
    expect(container.querySelector('[data-golive]')).toBeNull();

    const dvr: DvrState = {
      start: 0,
      end: 60,
      length: 60,
      position: 30,
      fraction: 0.5,
      behindLive: 30,
      atLiveEdge: false,
    };
    state = { ...state, dvr };
    osd.refreshProgress();
    expect(container.querySelector('[data-golive]')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.osd-progress-bar')?.style.width).toBe('50%');

    state = { ...state, dvr: { ...dvr, fraction: 0.75, behindLive: 15 } };
    osd.refreshProgress();
    expect(container.querySelector<HTMLElement>('.osd-progress-bar')?.style.width).toBe('75%');
    expect(container.querySelector('.osd-dvr-behind')?.textContent).toBe('-0:15');
  });

  it('routes pointer seeks and control clicks through callbacks', () => {
    state = snapshot({
      playback: playback(120, 30),
      catchup: {
        start: 1_000_000,
        end: 1_000_120,
        title: 'Programme 1',
        description: '',
        icon: '',
      },
    });
    osd.show();

    const seekbar = container.querySelector('[data-seekbar]') as HTMLElement;
    seekbar.getBoundingClientRect = () => rect(100, 50, 400, 20);
    container.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 400,
      clientY: 60,
    }));
    expect(callbacks.onSeekFraction).toHaveBeenCalledWith(0.75);

    const pause = container.querySelector('[data-playpause]') as HTMLElement;
    pause.getBoundingClientRect = () => rect(10, 10, 30, 30);
    container.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 20,
      clientY: 20,
    }));
    expect(callbacks.onPauseToggle).toHaveBeenCalledOnce();

    const resync = container.querySelector('[data-resync]') as HTMLElement;
    resync.getBoundingClientRect = () => rect(600, 10, 30, 30);
    container.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 610,
      clientY: 20,
    }));
    expect(callbacks.onResync).toHaveBeenCalledOnce();

    state = snapshot({
      playback: playback(120, 30),
      channel: null,
      vodTitle: 'Video 2',
      upNextSeconds: 5,
    });
    osd.render();
    const playNext = container.querySelector('[data-next-play]') as HTMLElement;
    playNext.getBoundingClientRect = () => rect(50, 100, 80, 30);
    container.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      clientX: 60,
      clientY: 110,
    }));
    expect(callbacks.onPlayNext).toHaveBeenCalledOnce();
  });

  it('reuses keyed programme icons and removes failed URLs until cleared', () => {
    state = snapshot({
      catchup: {
        start: 1_000_000,
        end: 1_000_120,
        title: 'Programme 1',
        description: '',
        icon: 'http://host/icon',
      },
    });
    osd.show();
    const first = container.querySelector('.osd-programme-icon');
    expect(first).not.toBeNull();

    osd.render();
    expect(container.querySelector('.osd-programme-icon')).toBe(first);

    first?.dispatchEvent(new Event('error'));
    expect(container.querySelector('.osd-programme-icon')).toBeNull();
    osd.render();
    expect(container.querySelector('.osd-programme-icon')).toBeNull();

    osd.clearFailedIcons();
    osd.render();
    expect(container.querySelector('.osd-programme-icon')).not.toBeNull();
  });
});
