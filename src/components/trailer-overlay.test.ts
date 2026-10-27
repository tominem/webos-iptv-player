// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastMock } = vi.hoisted(() => ({ toastMock: { showToast: vi.fn() } }));
vi.mock('./toast', () => toastMock);

import { TrailerOverlay } from './trailer-overlay';
import { setServicePort } from '../services/service-http';
import { Focus } from '../navigation/focus-scope';
import { setInputMode } from '../navigation/input-mode';
import { CONFIG } from '../config';

let overlay: TrailerOverlay;
let fetchMock: ReturnType<typeof vi.fn>;

const el = () => document.querySelector<HTMLElement>('.trailer-overlay');
const frame = () => document.querySelector<HTMLIFrameElement>('.trailer-frame');

// The page in the frame talks to the app by postMessage; jsdom's frame window is its source.
function fromPage(message: object, source: unknown = frame()?.contentWindow): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: typeof message === 'string' ? message : JSON.stringify({ source: 'iptv-trailer', ...message }),
    source: source as MessageEventSource,
  }));
}

async function opened(id = 'abcDEF_-123'): Promise<void> {
  await overlay.open(id);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  toastMock.showToast.mockClear();
  setServicePort(8123);
  fetchMock = vi.fn().mockResolvedValue({});
  vi.stubGlobal('fetch', fetchMock);
  overlay = new TrailerOverlay();
});

afterEach(() => {
  overlay.close();
  Focus.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setServicePort(null);
});

describe('TrailerOverlay', () => {
  it('is available only while the service runs', () => {
    expect(TrailerOverlay.available()).toBe(true);
    setServicePort(null);
    expect(TrailerOverlay.available()).toBe(false);
  });

  it('does nothing without the service', async () => {
    setServicePort(null);
    await opened();
    expect(el()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('frames the service page for the video once YouTube answers', async () => {
    await opened();
    expect(fetchMock).toHaveBeenCalledWith(CONFIG.TRAILER.REACH_URL, expect.objectContaining({ mode: 'no-cors' }));
    expect(overlay.visible).toBe(true);
    expect(frame()?.getAttribute('src')).toBe(`http://${CONFIG.SERVICE_HOST}:8123/trailer?v=abcDEF_-123`);
    expect(el()?.querySelector('.trailer-loading')?.textContent).toBe('Loading…');
    expect(Focus.owner()?.id).toBe('overlay.trailer');
  });

  it('opens no frame, and says so, when YouTube cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await opened();
    expect(frame()).toBeNull();
    expect(overlay.visible).toBe(false);
    expect(toastMock.showToast).toHaveBeenCalledWith('Trailer unavailable');
  });

  it('gives up on a YouTube that does not answer in time', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = overlay.open('abcDEF_-123');
    await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.REACH_TIMEOUT_MS);
    await pending;
    expect(frame()).toBeNull();
    expect(toastMock.showToast).toHaveBeenCalledWith('Trailer unavailable');
  });

  it('drops an open that was closed while it waited for YouTube', async () => {
    let answer!: (value: object) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const pending = overlay.open('abcDEF_-123');
    overlay.close();
    answer({});
    await pending;
    expect(frame()).toBeNull();
    expect(toastMock.showToast).not.toHaveBeenCalled();
  });

  it('stays quiet when it was closed while YouTube turned out unreachable', async () => {
    let fail!: (error: Error) => void;
    fetchMock.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const pending = overlay.open('abcDEF_-123');
    overlay.close();
    fail(new Error('offline'));
    await pending;
    expect(toastMock.showToast).not.toHaveBeenCalled();
  });

  it('ignores a second open while one is under way or showing', async () => {
    const first = overlay.open('abcDEF_-123');
    await overlay.open('zzzzzzzzzzz');
    await first;
    await overlay.open('yyyyyyyyyyy');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.trailer-frame')).toHaveLength(1);
  });

  it('removes the loading text once the trailer plays, and keeps the frame', async () => {
    await opened();
    fromPage({ event: 'state', state: 1 });
    expect(el()?.querySelector('.trailer-loading')).toBeNull();
    await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.START_TIMEOUT_MS);
    expect(overlay.visible).toBe(true);
  });

  describe('controls', () => {
    const bar = () => el()!.querySelector<HTMLElement>('.trailer-controls')!;
    const shown = () => !bar().classList.contains('hidden');
    const posted = (post: ReturnType<typeof vi.spyOn>) =>
      post.mock.calls.map(([data]) => JSON.parse(String(data)));

    async function playing(duration = 120, current = 30) {
      await opened();
      fromPage({ event: 'time', duration, current });
      fromPage({ event: 'state', state: 1 });
    }

    it('is held up while the trailer waits to start, with the play icon', async () => {
      await opened();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS * 2);
      expect(bar().querySelector('.trailer-play svg')).not.toBeNull();
    });

    it('shows the time, the length and the progress, and goes after a rest', async () => {
      await playing(120, 30);
      expect(shown()).toBe(true);
      expect(bar().querySelector('.trailer-time-current')?.textContent).toBe('0:30');
      expect(bar().querySelector('.trailer-time-end')?.textContent).toBe('2:00');
      expect(bar().querySelector<HTMLElement>('.trailer-bar-fill')?.style.width).toBe('25%');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS);
      expect(shown()).toBe(false);
    });

    it('stays up while paused and returns on a key', async () => {
      await playing();
      fromPage({ event: 'state', state: 2 });
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS * 2);
      expect(shown()).toBe(true);
      fromPage({ event: 'state', state: 1 });
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS);
      expect(shown()).toBe(false);
      overlay.handleAction('select');
      expect(shown()).toBe(true);
    });

    it('returns when the cursor comes back, and not when the keys take over', async () => {
      setInputMode('keys');
      await playing();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS);
      setInputMode('keys');
      expect(shown()).toBe(false);
      setInputMode('pointer');
      expect(shown()).toBe(true);
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.CONTROLS_HIDE_MS);
      setInputMode('keys');
      expect(shown()).toBe(false);
    });

    it('stops watching the cursor once closed', async () => {
      setInputMode('keys');
      await playing();
      overlay.close();
      expect(() => setInputMode('pointer')).not.toThrow();
    });

    it('moves the trailer by a step on Left and Right, and on rewind and fast forward', async () => {
      await playing(120, 30);
      const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
      overlay.handleAction('right');
      expect(bar().querySelector('.trailer-time-current')?.textContent).toBe('0:40');
      overlay.handleAction('left');
      overlay.handleAction('fast_forward');
      overlay.handleAction('rewind');
      expect(posted(post).map(m => m.seconds)).toEqual([40, 30, 40, 30]);
      expect(posted(post)[0]).toMatchObject({ source: 'iptv-trailer', command: 'seek' });
    });

    it('keeps the target inside the trailer', async () => {
      await playing(120, 5);
      const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
      overlay.handleAction('left');
      fromPage({ event: 'time', current: 115 });
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.SEEK_HOLD_MS);
      fromPage({ event: 'time', current: 115 });
      overlay.handleAction('right');
      expect(posted(post).map(m => m.seconds)).toEqual([0, 120]);
    });

    it('does not seek before the length is known', async () => {
      await opened();
      const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
      overlay.handleAction('right');
      expect(post).not.toHaveBeenCalled();
    });

    it('does not let a late position pull the bar back right after a seek', async () => {
      await playing(120, 30);
      overlay.handleAction('right');
      fromPage({ event: 'time', current: 31 });
      expect(bar().querySelector('.trailer-time-current')?.textContent).toBe('0:40');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.SEEK_HOLD_MS);
      fromPage({ event: 'time', current: 41 });
      expect(bar().querySelector('.trailer-time-current')?.textContent).toBe('0:41');
    });

    it('ignores a length that is not positive', async () => {
      await opened();
      fromPage({ event: 'time', duration: 0 });
      fromPage({ event: 'time' });
      expect(bar().querySelector('.trailer-time-end')?.textContent).toBe('');
    });

    it('seeks to the point of a click on the bar, and pauses on a click elsewhere', async () => {
      await playing(100, 10);
      const track = bar().querySelector<HTMLElement>('.trailer-bar')!;
      track.getBoundingClientRect = () => ({ left: 200, right: 1200, top: 900, bottom: 908, width: 1000, height: 8 }) as DOMRect;
      const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
      el()!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 905 }));
      el()!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 700, clientY: 300 }));
      expect(posted(post).map(m => m.command)).toEqual(['seek', 'toggle']);
      expect(posted(post)[0].seconds).toBe(50);
    });

    it('treats a click as a pause while the bar is away or the length unknown', async () => {
      await opened();
      const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
      el()!.click();
      expect(posted(post).map(m => m.command)).toEqual(['toggle']);
    });
  });

  describe('asking YouTube ahead', () => {
    it('answers an open from the earlier ask, without asking again', async () => {
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(0);
      await opened();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(overlay.visible).toBe(true);
    });

    it('asks again once the answer is too old', async () => {
      await opened();
      overlay.close();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.REACH_TTL_MS);
      await opened();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('asks again after a failure, since that may pass', async () => {
      fetchMock.mockRejectedValueOnce(new Error('offline'));
      await opened();
      expect(overlay.visible).toBe(false);
      await opened();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(overlay.visible).toBe(true);
    });
  });

  describe('parking the player', () => {
    const parked = () => el()?.classList.contains('trailer-parked') ?? false;
    async function warmed(id = 'abcDEF_-123'): Promise<void> {
      overlay.warm(id);
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS);
    }

    it('loads the page out of sight and paused once the details have rested a moment', async () => {
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS - 1);
      expect(frame()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(frame()?.getAttribute('src')).toBe(`http://${CONFIG.SERVICE_HOST}:8123/trailer?v=abcDEF_-123&autoplay=0`);
      expect(parked()).toBe(true);
      expect(overlay.visible).toBe(false);
      expect(Focus.owner()?.id).not.toBe('overlay.trailer');
    });

    it('is a no-op without the service, and parks one video once', async () => {
      setServicePort(null);
      await warmed();
      expect(frame()).toBeNull();
      setServicePort(8123);
      await warmed();
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS);
      expect(document.querySelectorAll('.trailer-frame')).toHaveLength(1);
    });

    it('brings the parked page forward on open, and tells it to play', async () => {
      await warmed();
      const parkedFrame = frame()!;
      const post = vi.spyOn(parkedFrame.contentWindow!, 'postMessage');
      fetchMock.mockClear();
      await overlay.open('abcDEF_-123');
      expect(frame()).toBe(parkedFrame);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(parked()).toBe(false);
      expect(overlay.visible).toBe(true);
      expect(Focus.owner()?.id).toBe('overlay.trailer');
      expect(post).toHaveBeenCalledWith(JSON.stringify({ source: 'iptv-trailer', command: 'play' }), '*');
      expect(el()?.querySelector('.trailer-loading')).not.toBeNull();
      fromPage({ event: 'state', state: 1 });
      expect(el()?.querySelector('.trailer-loading')).toBeNull();
    });

    it('gives up on a start that never comes after it was parked', async () => {
      await warmed();
      await overlay.open('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.START_TIMEOUT_MS);
      expect(overlay.visible).toBe(false);
      expect(toastMock.showToast).toHaveBeenCalledWith('Trailer unavailable');
    });

    it('takes no notice of the player while parked, and drops it quietly when it refuses', async () => {
      await warmed();
      fromPage({ event: 'state', state: 1 });
      fromPage({ event: 'time', duration: 90, current: 3 });
      expect(parked()).toBe(true);
      fromPage({ event: 'error', code: 150 });
      expect(frame()).toBeNull();
      expect(toastMock.showToast).not.toHaveBeenCalled();
      await warmed();
      expect(frame()).toBeNull();
    });

    it('lets go of the parked page when the details go', async () => {
      await warmed();
      overlay.unwarm();
      expect(frame()).toBeNull();
      expect(parked()).toBe(false);
    });

    it('does not park at all when the details go before the moment passes', async () => {
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS - 10);
      overlay.unwarm();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS);
      expect(frame()).toBeNull();
    });

    it('does not park when YouTube cannot be reached, or the details went while it was asked', async () => {
      fetchMock.mockRejectedValue(new Error('offline'));
      await warmed();
      expect(frame()).toBeNull();
      overlay.unwarm();
      let answer!: (value: object) => void;
      fetchMock.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS);
      overlay.unwarm();
      answer({});
      await vi.advanceTimersByTimeAsync(0);
      expect(frame()).toBeNull();
    });

    it('swaps the parked page when another video is opened', async () => {
      await warmed();
      await overlay.open('zzzzzzzzzzz');
      expect(document.querySelectorAll('.trailer-frame')).toHaveLength(1);
      expect(frame()?.getAttribute('src')).toBe(`http://${CONFIG.SERVICE_HOST}:8123/trailer?v=zzzzzzzzzzz`);
    });

    it('parks again after the trailer is closed, while the details are still up', async () => {
      await warmed();
      await overlay.open('abcDEF_-123');
      overlay.close();
      expect(frame()).toBeNull();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS);
      expect(parked()).toBe(true);
    });

    it('does not park again after dispose, or a video the player refused', async () => {
      await warmed();
      await overlay.open('abcDEF_-123');
      overlay.dispose();
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS * 2);
      expect(frame()).toBeNull();
      overlay.warm('abcDEF_-123');
      await overlay.open('abcDEF_-123');
      fromPage({ event: 'error', code: 150 });
      overlay.warm('abcDEF_-123');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS * 2);
      expect(frame()).toBeNull();
    });

    it('does not park while a trailer is open', async () => {
      await opened();
      overlay.warm('zzzzzzzzzzz');
      await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.WARM_DELAY_MS * 2);
      expect(document.querySelectorAll('.trailer-frame')).toHaveLength(1);
      expect(frame()?.getAttribute('src')).toContain('v=abcDEF_-123');
    });
  });

  it('closes by itself when the trailer ends', async () => {
    await opened();
    fromPage({ event: 'state', state: 1 });
    fromPage({ event: 'state', state: 0 });
    expect(overlay.visible).toBe(false);
    expect(frame()).toBeNull();
    expect(Focus.owner()?.id).not.toBe('overlay.trailer');
  });

  it('closes with a message when the player refuses the video', async () => {
    await opened();
    fromPage({ event: 'error', code: 150 });
    expect(overlay.visible).toBe(false);
    expect(toastMock.showToast).toHaveBeenCalledWith('Trailer unavailable');
  });

  it('closes with a message when the player never starts', async () => {
    await opened();
    await vi.advanceTimersByTimeAsync(CONFIG.TRAILER.START_TIMEOUT_MS);
    expect(overlay.visible).toBe(false);
    expect(toastMock.showToast).toHaveBeenCalledWith('Trailer unavailable');
  });

  it('takes no notice of messages that carry nothing it acts on', async () => {
    await opened();
    fromPage({ event: 'ready' });
    expect(overlay.visible).toBe(true);
    expect(el()?.querySelector('.trailer-loading')).not.toBeNull();
  });

  it('only believes the page it framed, and only its own messages', async () => {
    await opened();
    fromPage({ event: 'error', code: 150 }, window);
    fromPage('not json');
    fromPage({ source: 'other', event: 'error' } as never);
    fromPage({ event: 'state', state: 2 });
    expect(overlay.visible).toBe(true);
    expect(el()?.querySelector('.trailer-loading')).not.toBeNull();
  });

  it('asks the page to pause or resume on OK, Play, Pause and a click', async () => {
    await opened();
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    overlay.handleAction('select');
    overlay.handleAction('play');
    overlay.handleAction('pause');
    el()!.click();
    overlay.handleAction('left');
    expect(post).toHaveBeenCalledTimes(4);
    expect(post).toHaveBeenCalledWith(JSON.stringify({ source: 'iptv-trailer', command: 'toggle' }), '*');
  });

  it('takes the keys while it is up, through its focus scope', async () => {
    await opened();
    const scope = Focus.owner()!;
    expect(scope.root()).toBe(el());
    expect(scope.handle('back')).toBe(true);
    expect(overlay.visible).toBe(false);
  });

  it('closes on Back, and ignores keys while it is closed', async () => {
    await opened();
    overlay.handleAction('back');
    expect(overlay.visible).toBe(false);
    expect(frame()).toBeNull();
    overlay.handleAction('back');
    overlay.handleAction('select');
    overlay.close();
    expect(overlay.visible).toBe(false);
  });

  it('can be opened again after it was closed', async () => {
    await opened();
    overlay.close();
    await opened('zzzzzzzzzzz');
    expect(frame()?.getAttribute('src')).toContain('v=zzzzzzzzzzz');
    expect(document.querySelectorAll('.trailer-overlay')).toHaveLength(1);
  });

  it('stops listening to the page once closed', async () => {
    await opened();
    const page = frame()!.contentWindow;
    overlay.close();
    fromPage({ event: 'error', code: 150 }, page);
    expect(toastMock.showToast).not.toHaveBeenCalled();
  });

  it('does not post to a frame that is gone', async () => {
    await opened();
    overlay.close();
    expect(() => overlay.handleAction('select')).not.toThrow();
  });
});
