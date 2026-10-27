export interface FrameVideo {
  currentTime: number;
  readyState: number;
  src: string;
  muted: boolean;
  preload: string;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
  remove(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface FrameCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): { drawImage(image: unknown, x: number, y: number, w: number, h: number): void } | null;
}

export interface FrameSourceDeps {
  createVideo(): FrameVideo;
  createCanvas(): FrameCanvas;
}

export interface FrameSourceOptions {
  width: number;
  height: number;
  timeoutMs: number;
}

// The browser's own elements, the video kept just off screen: a hidden or
// detached one may not decode on every engine.
export const browserFrameDeps: FrameSourceDeps = {
  createVideo: () => {
    const video = document.createElement('video');
    video.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(video);
    return video as unknown as FrameVideo;
  },
  createCanvas: () => document.createElement('canvas') as unknown as FrameCanvas,
};

// After this many failed loads or seeks the source stops trying.
const MAX_FAILURES = 2;
// How far from the asked time a seek may land (a keyframe) and still count.
const SEEK_TOLERANCE_SECS = 2;

// Frames of one movie for a seek preview, from a second, silent video element
// on the same URL. It seeks where asked and copies the frame to a small canvas.
export class VideoFrameSource {
  private video: FrameVideo | null = null;
  private canvas: FrameCanvas | null = null;
  private ticket = 0;
  private failures = 0;
  // Waits in flight, so a release can end them.
  private pending: Array<() => void> = [];

  constructor(
    private readonly url: string,
    private readonly deps: FrameSourceDeps = browserFrameDeps,
    private readonly options: FrameSourceOptions,
  ) {}

  get available(): boolean {
    return this.failures < MAX_FAILURES;
  }

  // The canvas holding the frame at `time`, or null when superseded by a newer
  // request or when no frame could be had. The canvas is reused between frames.
  async frameAt(time: number): Promise<FrameCanvas | null> {
    if (!this.available) return null;
    const ticket = ++this.ticket;
    const video = this.ensureVideo();
    if (video.readyState < 1 && !await this.wait(video, 'loadedmetadata')) return this.failIfCurrent(ticket);
    if (ticket !== this.ticket) return null;
    video.currentTime = time;
    if (!await this.wait(video, 'seeked')) return this.failIfCurrent(ticket);
    if (ticket !== this.ticket) return null;
    if (Math.abs(video.currentTime - time) > SEEK_TOLERANCE_SECS) return null;
    return this.draw(video);
  }

  release(): void {
    this.ticket++;
    this.pending.splice(0).forEach(abort => abort());
    const video = this.video;
    this.video = null;
    this.canvas = null;
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }

  private ensureVideo(): FrameVideo {
    if (this.video) return this.video;
    const video = this.deps.createVideo();
    video.muted = true;
    video.preload = 'auto';
    video.src = this.url;
    this.video = video;
    return video;
  }

  private draw(video: FrameVideo): FrameCanvas | null {
    const canvas = this.canvas ?? this.deps.createCanvas();
    canvas.width = this.options.width;
    canvas.height = this.options.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, this.options.width, this.options.height);
    this.canvas = canvas;
    return canvas;
  }

  // A wait ended by a newer request or a release is not the video's fault.
  private failIfCurrent(ticket: number): null {
    if (ticket === this.ticket) this.failures++;
    return null;
  }

  // True once `type` fires; false on an error or when it takes too long.
  private wait(video: FrameVideo, type: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => done(false), this.options.timeoutMs);
      const onDone = (): void => done(true);
      const onError = (): void => done(false);
      const cleanup = (): void => {
        clearTimeout(timer);
        video.removeEventListener(type, onDone);
        video.removeEventListener('error', onError);
      };
      const abort = (): void => done(false);
      const done = (ok: boolean): void => {
        const index = this.pending.indexOf(abort);
        if (index >= 0) this.pending.splice(index, 1);
        cleanup();
        resolve(ok);
      };
      this.pending.push(abort);
      video.addEventListener(type, onDone);
      video.addEventListener('error', onError);
    });
  }
}
