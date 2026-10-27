// The popup is this wide, and keeps this far from the screen edge and this far above the bar.
const POPUP_WIDTH = 320;
const SCREEN_MARGIN = 80;
const GAP_ABOVE_BAR = 24;

// The frame and time shown over the seek bar while the keys move along the movie.
export class SeekPreview {
  private el: HTMLElement | null = null;
  private frame: HTMLCanvasElement | null = null;
  private timeEl: HTMLElement | null = null;

  constructor(private readonly container: HTMLElement) {}

  get visible(): boolean {
    return !!this.el && !this.el.classList.contains('hidden');
  }

  show(bar: HTMLElement | null, fraction: number, label: string): void {
    const el = this.ensure();
    const rect = bar?.getBoundingClientRect();
    const screen = window.innerWidth || 1920;
    const center = rect ? rect.left + fraction * rect.width : screen / 2;
    const half = POPUP_WIDTH / 2;
    const left = Math.max(SCREEN_MARGIN + half, Math.min(screen - SCREEN_MARGIN - half, center));
    el.style.left = `${left}px`;
    // Anchored by its bottom edge, so the time sits right over the OSD panel (which is opaque
    // and stacks above this popup) with or without a frame.
    const height = window.innerHeight || 1080;
    const top = bar?.closest('.player-osd')?.getBoundingClientRect().top ?? rect?.top;
    el.style.bottom = `${top === undefined ? SCREEN_MARGIN : height - top + GAP_ABOVE_BAR}px`;
    this.timeEl!.textContent = label;
    el.classList.remove('hidden');
  }

  // The frame canvas is the source's own, so it is moved in, not copied.
  setFrame(canvas: HTMLCanvasElement | null): void {
    if (!this.el || !this.visible) return;
    if (canvas && canvas.parentElement !== this.el) {
      this.dropFrame();
      this.el.insertBefore(canvas, this.el.firstChild);
      this.frame = canvas;
    } else if (!canvas) {
      this.dropFrame();
    }
    this.el.classList.toggle('has-frame', !!canvas);
  }

  hide(): void {
    if (!this.el) return;
    this.dropFrame();
    this.el.classList.remove('has-frame');
    this.el.classList.add('hidden');
  }

  private dropFrame(): void {
    this.frame?.remove();
    this.frame = null;
  }

  private ensure(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'osd-seek-preview hidden';
    const time = document.createElement('span');
    time.className = 'osd-seek-preview-time';
    el.appendChild(time);
    this.timeEl = time;
    this.container.appendChild(el);
    this.el = el;
    return el;
  }
}
