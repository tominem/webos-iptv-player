// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumeEntry } from '../types';

const { state, storageMock } = vi.hoisted(() => {
  const state = { resume: [] as ResumeEntry[] };
  return {
    state,
    storageMock: { getResumeList: vi.fn(() => state.resume) },
  };
});

vi.mock('../services/storage-service', () => ({ StorageService: storageMock }));
vi.mock('../services/parental-control', () => ({
  isResumeConcealed: (entry: ResumeEntry) => entry.itemId === 'hidden',
}));

import { Home, vodFromResume } from './home';
import { setLocale } from '../i18n';
import { Focus } from '../navigation/focus-scope';
import { CONFIG } from '../config';

const entry = (over: Partial<ResumeEntry> = {}): ResumeEntry => ({
  accountId: 'acc1',
  kind: 'vod',
  itemId: 'm1',
  name: 'Movie A',
  poster: 'http://host/a.jpg',
  ext: 'mp4',
  position: 30,
  duration: 120,
  updatedAt: 1,
  ...over,
});

// jsdom has no layout: tiles sit in one row, the rail's cards in a row below.
function stubLayout(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const card = el.classList.contains('home-card');
    const tile = el.classList.contains('home-tile');
    if (!card && !tile) {
      return { x: 0, y: 0, top: 0, left: 0, right: 1920, bottom: 1080, width: 1920, height: 1080,
        toJSON: () => ({}) } as DOMRect;
    }
    const index = Array.from(el.parentElement!.children).indexOf(el);
    const left = index * 300;
    const top = card ? 500 : 100;
    return { x: left, y: top, top, left, right: left + 280, bottom: top + 200, width: 280, height: 200,
      toJSON: () => ({}) } as DOMRect;
  });
}

let container: HTMLElement;
let onOpen: ReturnType<typeof vi.fn>;
let onResume: ReturnType<typeof vi.fn>;
let onBack: ReturnType<typeof vi.fn>;
let home: Home;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  state.resume = [];
  vi.clearAllMocks();
  stubLayout();
  setLocale('en');
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  onOpen = vi.fn();
  onResume = vi.fn();
  onBack = vi.fn();
  home = new Home(container, { onOpen, onResume, onBack });
  Focus.setBase(() => home.focusScope);
});

afterEach(() => {
  vi.restoreAllMocks();
  Focus.setBase(() => null);
  Focus.uninstall();
});

function ringed(): HTMLElement | null {
  Focus.flush();
  return container.querySelector<HTMLElement>('.focused');
}

function click(selector: string): void {
  container.querySelector<HTMLElement>(selector)!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const tiles = (): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.home-tile')).map(el => el.dataset.section!);

describe('Home', () => {
  it('shows every section for an Xtream account and focuses Live', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    expect(tiles()).toEqual(['live', 'movies', 'series', 'settings']);
    expect(ringed()?.dataset.section).toBe('live');
  });

  it('shows the app name as the other screens do, and it is not a control', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    const title = container.querySelector('.home-title');
    expect(title?.textContent).toBe(CONFIG.APP_NAME);
    expect(title?.hasAttribute('data-focusable')).toBe(false);
  });

  it('focuses the tile of the section the user came back from', () => {
    home.open({ hasXtream: true, accountId: 'acc1' }, 'series');
    expect(ringed()?.dataset.section).toBe('series');
    home.open({ hasXtream: true, accountId: 'acc1' }, 'settings');
    expect(ringed()?.dataset.section).toBe('settings');
  });

  it('falls back to Live when that section has no tile', () => {
    home.open({ hasXtream: false, accountId: null }, 'movies');
    expect(ringed()?.dataset.section).toBe('live');
  });

  it('shows only Live and Settings without an Xtream account', () => {
    state.resume = [entry()];
    home.open({ hasXtream: false, accountId: null });
    expect(tiles()).toEqual(['live', 'settings']);
    expect(container.querySelector('.home-rail')).toBeNull();
    expect(storageMock.getResumeList).not.toHaveBeenCalled();
  });

  it('omits the rail when the account is unknown', () => {
    state.resume = [entry()];
    home.open({ hasXtream: true, accountId: null });
    expect(container.querySelector('.home-rail')).toBeNull();
  });

  it('omits the rail when nothing is in progress', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    expect(container.querySelector('.home-rail')).toBeNull();
  });

  it('lists in-progress items with progress and escaped names', () => {
    state.resume = [
      entry({ name: '<img src=x onerror=alert(1)>', position: 30, duration: 120 }),
      entry({ itemId: 'm2', name: 'Movie B', poster: '', position: 5, duration: 0 }),
    ];
    home.open({ hasXtream: true, accountId: 'acc1' });
    const cards = container.querySelectorAll('.home-card');
    expect(cards).toHaveLength(2);
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(cards[0].querySelector('.home-card-title')?.textContent)
      .toBe('<img src=x onerror=alert(1)>');
    expect(cards[0].querySelector<HTMLElement>('.home-card-progress span')?.style.width)
      .toBe('25%');
    expect(cards[0].querySelector('img')?.getAttribute('src')).toBe('http://host/a.jpg');
    expect(cards[1].querySelector('.home-card-progress')).toBeNull();
    expect(cards[1].querySelector('img')).toBeNull();
    expect(container.querySelector('.home-rail h2')?.textContent).toBe('Continue Watching');
  });

  it('keeps concealed titles off the rail', () => {
    state.resume = [entry({ itemId: 'hidden', name: 'Secret' }), entry({ itemId: 'm2', name: 'Open' })];
    home.open({ hasXtream: true, accountId: 'acc1' });
    expect(Array.from(container.querySelectorAll('.home-card-title')).map(el => el.textContent))
      .toEqual(['Open']);
  });

  it('caps the rail', () => {
    state.resume = Array.from({ length: CONFIG.HOME.RAIL_MAX + 5 }, (_, i) =>
      entry({ itemId: `m${String(i)}` }));
    home.open({ hasXtream: true, accountId: 'acc1' });
    expect(container.querySelectorAll('.home-card')).toHaveLength(CONFIG.HOME.RAIL_MAX);
  });

  it('opens the focused section on select and on click', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('right');
    home.handleAction('select');
    expect(onOpen).toHaveBeenLastCalledWith('movies');
    click('[data-section="settings"]');
    expect(onOpen).toHaveBeenLastCalledWith('settings');
  });

  it('resumes a card on select and on click', () => {
    const first = entry();
    state.resume = [first, entry({ itemId: 'm2' })];
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('down');
    expect(ringed()?.classList.contains('home-card')).toBe(true);
    home.handleAction('select');
    expect(onResume).toHaveBeenLastCalledWith(first);
    click('.home-card:nth-child(2)');
    expect(onResume).toHaveBeenLastCalledWith(state.resume[1]);
  });

  it('moves back up from the rail to the tiles', () => {
    state.resume = [entry()];
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('down');
    home.handleAction('up');
    expect(ringed()?.classList.contains('home-tile')).toBe(true);
  });

  it('reports back and ignores unrelated keys', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('back');
    expect(onBack).toHaveBeenCalledTimes(1);
    home.handleAction('red');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does nothing on select when nothing is focused', () => {
    home.handleAction('select');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onResume).not.toHaveBeenCalled();
  });

  it('ignores a click outside any control', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    container.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps the last focus when it comes back', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('right');
    home.resumeFocus();
    expect(ringed()?.dataset.section).toBe('movies');
  });

  it('falls back to Live when the remembered tile is gone', () => {
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.handleAction('right');
    home.open({ hasXtream: false, accountId: null });
    expect(ringed()?.dataset.section).toBe('live');
  });

  it('lets the scope default to Live before anything was focused', () => {
    home.focusScope.enter('key');
    expect(home.focusScope.focusKey).toBe('tile-live');
  });

  it('resumes onto the first control when nothing was focused', () => {
    expect(() => home.resumeFocus()).not.toThrow();
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.release();
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.resumeFocus();
    expect(ringed()?.dataset.section).toBe('live');
  });

  it('frees its markup on release', () => {
    state.resume = [entry()];
    home.open({ hasXtream: true, accountId: 'acc1' });
    home.release();
    expect(container.children).toHaveLength(0);
  });
});

describe('vodFromResume', () => {
  it('rebuilds the catalog item a resumed movie came from', () => {
    expect(vodFromResume(entry({ categoryId: 'c9' }))).toEqual({
      accountId: 'acc1',
      streamId: 'm1',
      name: 'Movie A',
      poster: 'http://host/a.jpg',
      rating: '',
      categoryId: 'c9',
      containerExtension: 'mp4',
    });
  });

  it('carries the rating saved with the resume point', () => {
    expect(vodFromResume(entry({ rating: '7' })).rating).toBe('7');
    expect(vodFromResume(entry()).rating).toBe('');
  });

  it('leaves the category empty when none was saved', () => {
    expect(vodFromResume(entry()).categoryId).toBe('');
  });
});
