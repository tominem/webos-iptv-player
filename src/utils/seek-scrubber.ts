export interface SeekScrubberOptions {
  step: number;
  // How long the keys must rest before the target is committed as a seek.
  commitDelayMs: number;
  position: () => number;
  duration: () => number;
  onMove: (target: number) => void;
  onCommit: (target: number) => void;
  onCancel: () => void;
}

// Presses before a held key starts taking bigger steps, and the cap on the multiplier.
const ACCELERATE_EVERY = 5;
const MAX_MULTIPLIER = 6;

// Left/Right move a target along the video instead of seeking at once, so a
// preview can follow it; the seek happens when the keys rest.
export class SeekScrubber {
  private current: number | null = null;
  private presses = 0;
  private direction: 1 | -1 = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SeekScrubberOptions) {}

  get active(): boolean {
    return this.current !== null;
  }

  get target(): number | null {
    return this.current;
  }

  press(direction: 1 | -1): void {
    const base = this.current ?? this.options.position();
    // Turning back starts slow again, so an overshoot is easy to correct.
    if (direction !== this.direction) this.presses = 0;
    this.direction = direction;
    const multiplier = Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.presses / ACCELERATE_EVERY));
    this.presses++;
    this.current = Math.max(0, Math.min(this.options.duration(), base + direction * this.options.step * multiplier));
    // Armed first, so a failing preview cannot leave the target without a commit.
    this.restartTimer();
    this.options.onMove(this.current);
  }

  commit(): void {
    const target = this.current;
    if (target === null) return;
    this.finish();
    this.options.onCommit(target);
  }

  cancel(): void {
    if (this.current === null) return;
    this.finish();
    this.options.onCancel();
  }

  private finish(): void {
    this.clearTimer();
    this.current = null;
    this.presses = 0;
  }

  private restartTimer(): void {
    this.clearTimer();
    this.timer = setTimeout(() => this.commit(), this.options.commitDelayMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}
