// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { NextEpisodeCard } from './next-episode-card';

let container: HTMLElement;
let card: NextEpisodeCard;
const el = () => container.querySelector<HTMLElement>('.osd-next-card')!;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  card = new NextEpisodeCard(container);
});

describe('NextEpisodeCard', () => {
  it('creates nothing until it is shown', () => {
    expect(container.querySelector('.osd-next-card')).toBeNull();
    expect(card.visible).toBe(false);
  });

  it('names the next episode and the time left, with the key to start it', () => {
    card.show('Show: S1 E2', 17);
    expect(card.visible).toBe(true);
    expect(el().classList.contains('hidden')).toBe(false);
    expect(el().querySelector('.osd-next-card-label')?.textContent).toBe('Next episode');
    expect(el().querySelector('.osd-next-card-title')?.textContent).toBe('Show: S1 E2');
    expect(el().querySelector('.osd-next-card-time')?.textContent).toContain('17');
    expect(el().querySelector('.osd-next-card-hint')?.textContent).toBe('Play now');
  });

  it('counts down in place', () => {
    card.show('Show: S1 E2', 17);
    card.show('Show: S1 E2', 16);
    expect(container.querySelectorAll('.osd-next-card')).toHaveLength(1);
    expect(el().querySelector('.osd-next-card-time')?.textContent).toContain('16');
  });

  it('escapes the episode title', () => {
    card.show('<img src=x onerror=alert(1)>', 5);
    expect(el().querySelector('img')).toBeNull();
    expect(el().querySelector('.osd-next-card-title')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('hides, and can be hidden before it was ever shown', () => {
    card.hide();
    expect(container.querySelector('.osd-next-card')).toBeNull();
    card.show('Show: S1 E2', 5);
    card.hide();
    expect(card.visible).toBe(false);
    expect(el().classList.contains('hidden')).toBe(true);
    card.hide();
    expect(card.visible).toBe(false);
  });
});
