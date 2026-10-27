import type { Action } from '../types';
import { CONFIG } from '../config';
import { t } from '../i18n';
import { Focus, type FocusScope } from '../navigation/focus-scope';
import { InputMode } from '../navigation/input-mode';
import { serviceBase } from '../services/service-http';
import { formatPosition } from '../utils/time';
import { PAUSE_ICON, PLAY_ICON } from './icons';
import { showToast } from './toast';
import { createLogger } from '../utils/logger';

const log = createLogger('Trailer');

// The player's state for "playing" and "ended" in the YouTube player API.
const PLAYING = 1;
const ENDED = 0;

interface PageMessage {
  source?: string;
  event?: string;
  state?: number;
  code?: number;
  current?: number;
  duration?: number;
}

// A movie trailer over the whole screen. YouTube's player is framed by a page
// the bundled service serves (it will not embed from the app's file:// origin),
// and that page relays the player's state and position back here. The player's
// own controls are off: the bar at the bottom is drawn here, so the keys and
// the pointer drive it as they drive the movie player.
//
// The player takes seconds to start, so while a movie's details are up it can
// be parked: the page is loaded out of sight, paused, and opening the trailer
// then only brings it forward and says "play".
export class TrailerOverlay {
  private el: HTMLElement | null = null;
  private frame: HTMLIFrameElement | null = null;
  private controls: HTMLElement | null = null;
  private scope: FocusScope | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private probe: { promise: Promise<boolean>; at: number } | null = null;
  private stopWatchingInput: (() => void) | null = null;
  // The video the details on screen would like ready, and the one parked out of sight.
  private warmId: string | null = null;
  private parkedId: string | null = null;
  // The video being shown, and those the player refused, which are not parked again.
  private openId: string | null = null;
  private readonly refused = new Set<string>();
  // Bumped by every open and close, so a late reachability answer is dropped.
  private session = 0;
  private playing = false;
  private current = 0;
  private duration = 0;
  private holdUntil = 0;
  private readonly onMessage = (event: MessageEvent): void => this.handleMessage(event);

  // The page can be framed only while the service is running.
  static available(): boolean {
    return serviceBase() !== null;
  }

  get visible(): boolean {
    return this.el !== null && !this.el.classList.contains('hidden') && this.parkedId === null;
  }

  // Details with this trailer are up: ask YouTube now, and park the player a moment later.
  warm(videoId: string): void {
    if (serviceBase() === null) return;
    this.warmId = videoId;
    void this.reachable();
    if (this.session % 2 === 1 || this.parkedId !== null || this.warmTimer !== null
        || this.refused.has(videoId)) return;
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null;
      void this.park(videoId);
    }, CONFIG.TRAILER.WARM_DELAY_MS);
  }

  // The details are gone: give the parked player's memory back.
  unwarm(): void {
    this.warmId = null;
    this.clearWarmTimer();
    this.dropParked();
  }

  // Closes the trailer and gives up any parked player.
  dispose(): void {
    this.close();
    this.unwarm();
  }

  async open(videoId: string): Promise<void> {
    const base = serviceBase();
    if (!base || this.session % 2 === 1) return;
    this.clearWarmTimer();
    if (this.parkedId === videoId) {
      this.start(videoId);
      this.post({ command: 'play' });
      return;
    }
    this.dropParked();
    const session = ++this.session;
    if (!await this.reachable()) {
      log.warn('Trailer unavailable', 'event=trailer.unreachable');
      if (session === this.session) {
        this.session++;
        showToast(t('catalog.trailerUnavailable'));
      }
      return;
    }
    if (session !== this.session) return;
    this.build(`${base}/trailer?v=${encodeURIComponent(videoId)}`);
    this.start(videoId, false);
  }

  close(): void {
    if (this.session % 2 === 0) return;
    this.session++;
    this.openId = null;
    this.clearStartTimer();
    this.clearHideTimer();
    this.stopWatchingInput?.();
    this.stopWatchingInput = null;
    this.teardown();
    if (this.scope) Focus.pop(this.scope);
    // The details are still up: park the player again for the next time.
    if (this.warmId !== null) this.warm(this.warmId);
  }

  handleAction(action: Action): void {
    if (!this.visible) return;
    switch (action) {
      case 'back':
        this.close();
        break;
      case 'select':
      case 'play':
      case 'pause':
        this.toggle();
        this.revealControls();
        break;
      case 'left':
      case 'rewind':
        this.seekBy(-CONFIG.TRAILER.SEEK_STEP);
        break;
      case 'right':
      case 'fast_forward':
        this.seekBy(CONFIG.TRAILER.SEEK_STEP);
        break;
    }
  }

  // Loads the page out of sight and paused, once YouTube is known to answer.
  private async park(videoId: string): Promise<void> {
    const base = serviceBase();
    if (!base || !await this.reachable() || !this.canPark(videoId)) return;
    this.build(`${base}/trailer?v=${encodeURIComponent(videoId)}&autoplay=0`);
    this.el!.classList.add('trailer-parked');
    this.parkedId = videoId;
  }

  private canPark(videoId: string): boolean {
    return this.warmId === videoId && this.session % 2 === 0 && this.parkedId === null;
  }

  private dropParked(): void {
    if (this.parkedId === null) return;
    this.parkedId = null;
    this.teardown();
  }

  // The frame goes with its page, which frees the player's memory.
  private teardown(): void {
    window.removeEventListener('message', this.onMessage);
    this.frame?.remove();
    this.frame = null;
    this.controls = null;
    this.el?.classList.remove('trailer-parked');
    this.el?.classList.add('hidden');
  }

  private build(url: string): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'trailer-overlay';
      this.el.setAttribute('data-self-activate', '');
      this.el.addEventListener('click', (event) => this.onClick(event));
    }
    this.playing = false;
    this.current = 0;
    this.duration = 0;
    this.holdUntil = 0;
    this.el.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'trailer-loading';
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    const label = document.createElement('div');
    label.textContent = t('common.loading');
    loading.append(spinner, label);
    this.el.appendChild(loading);
    this.frame = document.createElement('iframe');
    this.frame.className = 'trailer-frame';
    this.frame.setAttribute('allow', 'autoplay; encrypted-media');
    this.frame.src = url;
    this.el.appendChild(this.frame);
    this.controls = this.buildControls();
    this.el.appendChild(this.controls);
    // Last in <body>, so it paints above whatever is shown.
    document.body.appendChild(this.el);
    this.el.classList.remove('hidden');
    window.addEventListener('message', this.onMessage);
  }

  // Takes the keys and starts the clock on the player's start.
  private start(videoId: string, wasParked = true): void {
    if (!this.scope) {
      this.scope = Focus.register({
        id: 'overlay.trailer',
        root: () => this.el,
        restrict: 'self-only',
        onAction: (action) => this.handleAction(action),
      });
    }
    if (wasParked) {
      this.session++;
      this.parkedId = null;
      this.el!.classList.remove('trailer-parked');
    }
    this.openId = videoId;
    // The cursor coming back to the screen brings the bar with it.
    this.stopWatchingInput = InputMode.onChange((mode) => {
      if (mode === 'pointer') this.revealControls();
    });
    Focus.push(this.scope);
    this.startTimer = setTimeout(() => {
      log.warn('Trailer did not start', 'event=trailer.timeout');
      this.fail();
    }, CONFIG.TRAILER.START_TIMEOUT_MS);
    this.renderControls();
  }

  private buildControls(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'trailer-controls hidden';
    const icon = document.createElement('span');
    icon.className = 'trailer-play';
    const current = document.createElement('span');
    current.className = 'trailer-time trailer-time-current';
    const track = document.createElement('div');
    track.className = 'trailer-bar';
    const fill = document.createElement('div');
    fill.className = 'trailer-bar-fill';
    track.appendChild(fill);
    const end = document.createElement('span');
    end.className = 'trailer-time trailer-time-end';
    bar.append(icon, current, track, end);
    return bar;
  }

  private handleMessage(event: MessageEvent): void {
    if (!this.frame || event.source !== this.frame.contentWindow) return;
    let data: PageMessage;
    try {
      data = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (data.source !== 'iptv-trailer') return;
    if (data.event === 'error') {
      log.warn('Trailer refused', 'event=trailer.error', `code=${String(data.code)}`);
      this.fail();
    } else if (this.parkedId !== null) {
      // Parked, the player only gets ready: nothing to show yet.
      return;
    } else if (data.event === 'time') {
      this.onTime(data);
    } else if (data.event === 'state' && data.state === PLAYING) {
      this.clearStartTimer();
      this.el?.querySelector('.trailer-loading')?.remove();
      this.setPlaying(true);
    } else if (data.event === 'state' && data.state === ENDED) {
      this.close();
    } else if (data.event === 'state') {
      this.setPlaying(false);
    }
  }

  private onTime(data: PageMessage): void {
    if (typeof data.duration === 'number' && data.duration > 0) this.duration = data.duration;
    if (typeof data.current === 'number' && Date.now() >= this.holdUntil) this.current = data.current;
    this.renderControls();
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.revealControls();
  }

  private toggle(): void {
    this.post({ command: 'toggle' });
  }

  private seekBy(seconds: number): void {
    if (this.duration <= 0) return;
    this.seekTo(this.current + seconds);
  }

  private seekTo(seconds: number): void {
    const target = Math.max(0, Math.min(this.duration, seconds));
    this.current = target;
    this.holdUntil = Date.now() + CONFIG.TRAILER.SEEK_HOLD_MS;
    this.post({ command: 'seek', seconds: target });
    this.revealControls();
  }

  // A click on the bar seeks to that point; anywhere else it pauses or resumes.
  private onClick(event: MouseEvent): void {
    const track = this.controls?.querySelector<HTMLElement>('.trailer-bar');
    const rect = track?.getBoundingClientRect();
    if (rect && rect.width > 0 && this.duration > 0 && !this.controls!.classList.contains('hidden')
        && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top - 20 && event.clientY <= rect.bottom + 20) {
      this.seekTo(((event.clientX - rect.left) / rect.width) * this.duration);
      return;
    }
    this.toggle();
    this.revealControls();
  }

  private revealControls(): void {
    this.controls!.classList.remove('hidden');
    this.renderControls();
    this.clearHideTimer();
    // Held up while it waits, paused or unstarted; otherwise it goes after a rest.
    if (!this.playing) return;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.controls!.classList.add('hidden');
    }, CONFIG.TRAILER.CONTROLS_HIDE_MS);
  }

  // Only while the overlay is up, when the bar exists.
  private renderControls(): void {
    const bar = this.controls!;
    bar.querySelector('.trailer-play')!.innerHTML = this.playing ? PAUSE_ICON : PLAY_ICON;
    bar.querySelector('.trailer-time-current')!.textContent = formatPosition(this.current);
    bar.querySelector('.trailer-time-end')!.textContent = this.duration > 0 ? formatPosition(this.duration) : '';
    const fraction = this.duration > 0 ? Math.min(1, this.current / this.duration) : 0;
    bar.querySelector<HTMLElement>('.trailer-bar-fill')!.style.width = `${fraction * 100}%`;
  }

  private post(message: { command: string; seconds?: number }): void {
    this.frame?.contentWindow?.postMessage(
      JSON.stringify({ source: 'iptv-trailer', ...message }), '*');
  }

  // The player refused the video, or never started it: say so, and do not park it again.
  private fail(): void {
    // Only an open or parked player can fail.
    this.refused.add((this.openId ?? this.parkedId)!);
    if (this.parkedId !== null) {
      this.dropParked();
      return;
    }
    this.close();
    showToast(t('catalog.trailerUnavailable'));
  }

  private clearStartTimer(): void {
    if (this.startTimer === null) return;
    clearTimeout(this.startTimer);
    this.startTimer = null;
  }

  private clearHideTimer(): void {
    if (this.hideTimer === null) return;
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private clearWarmTimer(): void {
    if (this.warmTimer === null) return;
    clearTimeout(this.warmTimer);
    this.warmTimer = null;
  }

  // A frame whose address does not load can replace the whole app with the TV's
  // error page, so the frame opens only once YouTube answered. An answer is
  // trusted for a while, and a failure is asked again next time.
  private reachable(): Promise<boolean> {
    const known = this.probe;
    if (known && Date.now() - known.at < CONFIG.TRAILER.REACH_TTL_MS) return known.promise;
    const promise = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), CONFIG.TRAILER.REACH_TIMEOUT_MS);
      fetch(CONFIG.TRAILER.REACH_URL, { mode: 'no-cors', cache: 'no-store' })
        .then(() => { clearTimeout(timer); resolve(true); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
    this.probe = { promise, at: Date.now() };
    void promise.then((ok) => {
      if (!ok && this.probe?.promise === promise) this.probe = null;
    });
    return promise;
  }
}
