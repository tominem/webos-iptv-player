import { t, tp } from '../i18n';

// The corner card over the last seconds of an episode: what plays next, how
// long until it does, and the key that starts it now.
export class NextEpisodeCard {
  private el: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;

  constructor(private readonly container: HTMLElement) {}

  get visible(): boolean {
    return !!this.el && !this.el.classList.contains('hidden');
  }

  show(title: string, secondsLeft: number): void {
    const el = this.ensure();
    this.titleEl!.textContent = title;
    this.timeEl!.textContent = tp('player.playingIn', secondsLeft);
    el.classList.remove('hidden');
  }

  hide(): void {
    this.el?.classList.add('hidden');
  }

  private ensure(): HTMLElement {
    if (this.el) return this.el;
    const el = document.createElement('div');
    el.className = 'osd-next-card hidden';
    const part = (className: string, text = ''): HTMLElement => {
      const node = document.createElement('div');
      node.className = className;
      node.textContent = text;
      el.appendChild(node);
      return node;
    };
    part('osd-next-card-label', t('player.nextEpisode'));
    this.titleEl = part('osd-next-card-title');
    this.timeEl = part('osd-next-card-time');
    part('osd-next-card-hint', t('player.playNow'));
    this.container.appendChild(el);
    this.el = el;
    return el;
  }
}
