import type { Action, ResumeEntry, VodItem } from '../types';
import { CONFIG } from '../config';
import { SpatialNav } from '../navigation/spatial-nav';
import { Focus, type FocusScope } from '../navigation/focus-scope';
import { StorageService } from '../services/storage-service';
import { isResumeConcealed } from '../services/parental-control';
import { html, raw } from '../utils/dom';
import { morph } from '../utils/morph';
import { t, type TextMessageKey } from '../i18n';
import {
  HOME_LIVE_ICON,
  HOME_MOVIES_ICON,
  HOME_SERIES_ICON,
  HOME_SETTINGS_ICON,
} from './icons';

export type HomeSection = 'live' | 'movies' | 'series' | 'settings';

export interface HomeContext {
  hasXtream: boolean;
  accountId: string | null;
}

interface HomeHandlers {
  onOpen: (section: HomeSection) => void;
  onResume: (entry: ResumeEntry) => void;
  onBack: () => void;
}

const TILES: ReadonlyArray<{ section: HomeSection; labelKey: TextMessageKey; icon: string; xtreamOnly: boolean }> = [
  { section: 'live', labelKey: 'nav.live', icon: HOME_LIVE_ICON, xtreamOnly: false },
  { section: 'movies', labelKey: 'nav.movies', icon: HOME_MOVIES_ICON, xtreamOnly: true },
  { section: 'series', labelKey: 'nav.series', icon: HOME_SERIES_ICON, xtreamOnly: true },
  { section: 'settings', labelKey: 'nav.settings', icon: HOME_SETTINGS_ICON, xtreamOnly: false },
];

export function vodFromResume(entry: ResumeEntry): VodItem {
  return {
    accountId: entry.accountId,
    streamId: entry.itemId,
    name: entry.name,
    poster: entry.poster,
    rating: '',
    categoryId: entry.categoryId ?? '',
    containerExtension: entry.ext,
  };
}

function percent(entry: ResumeEntry): number {
  if (entry.duration <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(entry.position / entry.duration * 100)));
}

// The landing screen. It reads only the persisted resume list, so no section's
// catalog has to be in memory while it is shown.
export class Home {
  readonly focusScope: FocusScope;
  private readonly nav: SpatialNav;
  private entries: ResumeEntry[] = [];

  constructor(
    private readonly container: HTMLElement,
    private readonly handlers: HomeHandlers,
  ) {
    this.focusScope = Focus.register({
      id: 'view.home',
      root: container,
      defaultKey: () => this.nav.focused?.dataset.key ?? 'tile-live',
    });
    this.nav = new SpatialNav(container, undefined, { scope: this.focusScope });
    this.container.setAttribute('data-self-activate', '');
    this.container.addEventListener('click', (event: MouseEvent) => {
      const control = (event.target as HTMLElement).closest<HTMLElement>('[data-focusable]');
      if (!control) return;
      this.nav.focus(control, 'pointer');
      this.activate(control);
    });
  }

  // `focus` is the tile of the section just left, so Back lands where the user came from.
  open(context: HomeContext, focus: HomeSection = 'live'): void {
    this.entries = context.hasXtream && context.accountId
      ? StorageService.getResumeList(context.accountId)
          .filter(entry => !isResumeConcealed(entry))
          .slice(0, CONFIG.HOME.RAIL_MAX)
      : [];
    this.render(context.hasXtream);
    this.nav.focus(this.container.querySelector<HTMLElement>(`[data-section="${focus}"]`)
      ?? this.container.querySelector<HTMLElement>('[data-section="live"]'));
  }

  resumeFocus(): void {
    this.nav.focus(this.nav.focused ?? this.nav.first());
  }

  release(): void {
    this.entries = [];
    morph(this.container, html``);
  }

  handleAction(action: Action): void {
    if (action === 'back') {
      this.handlers.onBack();
    } else if (action === 'select') {
      if (this.nav.focused) this.activate(this.nav.focused);
    } else if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      this.nav.move(action);
    }
  }

  private activate(control: HTMLElement): void {
    if (control.dataset.section) {
      this.handlers.onOpen(control.dataset.section as HomeSection);
      return;
    }
    this.handlers.onResume(this.entries[Number(control.dataset.index)]);
  }

  private render(hasXtream: boolean): void {
    const tiles = TILES.filter(tile => hasXtream || !tile.xtreamOnly);
    morph(this.container, html`
      <div class="home-view">
        <span class="home-title">${CONFIG.APP_NAME}</span>
        <div class="home-tiles" data-nav-container>
          ${tiles.map(tile => html`
            <button class="home-tile" data-focusable data-key="${`tile-${tile.section}`}"
                    data-section="${tile.section}">
              <span class="home-tile-icon">${raw(tile.icon)}</span>
              <span class="home-tile-label">${t(tile.labelKey)}</span>
            </button>`)}
        </div>
        ${this.entries.length ? this.rail() : ''}
      </div>
    `);
  }

  private rail() {
    return html`
      <section class="home-rail">
        <h2>${t('catalog.continueWatching')}</h2>
        <div class="home-rail-track" data-nav-container data-nav-enter="last-focused">
          ${this.entries.map((entry, index) => html`
            <button class="home-card" data-focusable data-index="${String(index)}"
                    data-key="${`card-${entry.kind}-${entry.itemId}`}">
              ${entry.poster
                ? html`<img class="home-card-poster" src="${entry.poster}" alt="">`
                : html`<span class="home-card-poster"></span>`}
              <span class="home-card-title">${entry.name}</span>
              ${percent(entry)
                ? html`<span class="home-card-progress"><span style="${`width:${String(percent(entry))}%`}"></span></span>`
                : ''}
            </button>`)}
        </div>
      </section>`;
  }
}
