import {
  test,
  expect,
  routePlaylist,
  routeLiveManifest,
  seedPlaylist,
  enterTab,
  SAMPLE_M3U,
  type Page,
} from './helpers';

async function seedXtream(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.route('**/get.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U }));
  await page.route('**/xmltv.php*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/xml', body: '<tv></tv>' }));
  await page.addInitScript((values) => {
    localStorage.setItem('iptv_playlists', JSON.stringify([
      { id: 'x1', name: 'X Account', url: 'http://host.example.com:8080',
        source: 'xtream', xtream: { username: 'u', password: 'p' } },
    ]));
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
  }, extra);
}

const tiles = (page: Page) => page.locator('#view-home .home-tile');
const toast = (page: Page, text: string) => page.locator('.toast.visible', { hasText: text });

test('boots on the home screen without loading any section', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/');

  await expect(page.locator('#view-home')).toBeVisible();
  await expect(tiles(page)).toHaveText(['Live', 'Movies', 'Series', 'Settings']);
  await expect(page.locator('#view-home .home-tile[data-section="live"]')).toHaveClass(/\bfocused\b/);
  await expect(page.locator('.tab-bar')).toBeHidden();
  await expect(page.locator('#view-channels .channel-item')).toHaveCount(0);
  await expect(toast(page, 'channels loaded')).toHaveCount(0);
});

test('an M3U-only account shows just Live and Settings', async ({ page }) => {
  await seedPlaylist(page);
  await routePlaylist(page);
  await page.goto('/');

  await expect(tiles(page)).toHaveText(['Live', 'Settings']);
});

test('Live loads its channels on demand and Back returns home', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#view-channels .channel-item').first()).toBeVisible();
  await expect(page.locator('.tab-bar')).toBeVisible();
  await expect(toast(page, '2 channels loaded')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('.tab-bar')).toBeHidden();
});

test('Back on the home screen asks twice before leaving', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(toast(page, 'Press back again to exit')).toBeVisible();
  await expect(page.locator('#view-home')).toBeVisible();
});

test('the arrow keys move across the tiles and Enter opens Settings', async ({ page }) => {
  await seedXtream(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#view-home .home-tile[data-section="settings"]')).toHaveClass(/\bfocused\b/);
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-settings')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#view-home')).toBeVisible();
});

test('Movies opens from its tile and the search box names its scope', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies')).toBeVisible();
  await expect(page.locator('.tab-bar-search-input')).toHaveAttribute('placeholder', 'Search movies…');

  await enterTab(page, 'series');
  await expect(page.locator('.tab-bar-search-input')).toHaveAttribute('placeholder', 'Search series…');
});

test('leaving Live keeps the channel list, so coming back does not reload it', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/?start=live');
  await expect(toast(page, '2 channels loaded')).toBeVisible();
  await expect(toast(page, '2 channels loaded')).toBeHidden({ timeout: 10_000 });

  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies')).toBeVisible();
  await enterTab(page, 'live');
  await expect(page.locator('#view-channels .channel-item').first()).toBeVisible();
  await expect(toast(page, '2 channels loaded')).toHaveCount(0);
});

test('a heap over the cap frees the channel list when Live is left', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      get: () => ({ usedJSHeapSize: 4 * 1024 * 1024 * 1024 }),
    });
  });
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/?start=live');
  await expect(toast(page, '2 channels loaded')).toBeVisible();
  await expect(toast(page, '2 channels loaded')).toBeHidden({ timeout: 10_000 });

  await enterTab(page, 'movies');
  await expect(page.locator('#view-movies')).toBeVisible();
  // The heap is judged once the dropped guide had time to be collected.
  await page.waitForTimeout(2500);
  await enterTab(page, 'live');
  await expect(toast(page, '2 channels loaded')).toBeVisible();
});

test('the home screen is readable on a light theme', async ({ page }) => {
  await seedXtream(page, { iptv_theme: JSON.stringify('daylight') });
  await page.goto('/');

  const tile = page.locator('#view-home .home-tile[data-section="live"]');
  await expect(tile).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'daylight');
  const [text, background] = await tile.evaluate((el) => {
    const style = getComputedStyle(el);
    return [style.color, style.backgroundColor];
  });
  expect(text).not.toBe(background);
});

test('the loading splash covers the home screen and holds the keys while Live loads', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/get.php*', async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U });
  });
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#view-loading')).toBeVisible();
  const covered = await page.evaluate(() =>
    !!document.elementFromPoint(960, 540)?.closest('#view-loading'));
  expect(covered).toBe(true);

  // Keys do not reach the home screen underneath.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-movies')).toBeHidden();

  release();
  await expect(page.locator('#view-channels .channel-item').first()).toBeVisible();
  await expect(page.locator('#view-loading')).toBeHidden();
  await expect(page.locator('#view-movies')).toBeHidden();
});

test('Back during a slow Live load returns home and the late load does not pull the user back', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/get.php*', async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: 'application/x-mpegurl', body: SAMPLE_M3U });
  });
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();

  await page.keyboard.press('Enter');
  await expect(page.locator('#view-loading')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-loading')).toBeHidden();
  await expect(page.locator('#view-home')).toBeVisible();

  release();
  await page.waitForTimeout(500);
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#view-channels')).toBeHidden();
});

// channelKey mirrors src/utils/channel.ts (fnv1a of the URL sans query/fragment).
function channelKey(url: string): string {
  const stable = url.split('#')[0].split('?')[0];
  let h = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) { h ^= stable.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

test('a reminder on air still prompts after the channel list was dropped', async ({ page }) => {
  await page.addInitScript((key) => {
    // A heap over the cap frees the channel list as soon as Live is left.
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      get: () => ({ usedJSHeapSize: 4 * 1024 * 1024 * 1024 }),
    });
    if (localStorage.getItem('seeded')) return;
    localStorage.setItem('seeded', '1');
    const now = Date.now();
    localStorage.setItem('iptv_reminders', JSON.stringify([
      { channelKey: key, channelName: 'Channel One', title: 'Alpha', startMs: now + 5_000, stopMs: now + 3_600_000 },
    ]));
  }, channelKey('http://streams.example.com/one.m3u8'));
  await seedPlaylist(page);
  await routePlaylist(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-channels .channel-item').first()).toBeVisible();
  // Back once goes to the search icon, twice in a short while goes home.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#view-home')).toBeVisible();
  // The programme starts while the channel list is not in memory.
  await page.waitForTimeout(5000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.reminder-prompt:not(.hidden)')).toBeVisible();
  await expect(page.locator('.reminder-message')).toContainText('Alpha');
});

test('Search opened from Settings, which Home opened, looks through the channels', async ({ page }) => {
  await seedXtream(page);
  await routeLiveManifest(page);
  await page.goto('/');
  await expect(tiles(page).first()).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#view-settings')).toBeVisible();

  await enterTab(page, 'search');
  await page.locator('.tab-bar-search-input').fill('one');
  await expect(page.locator('#view-search .search-channel-row').first()).toContainText('Channel One');
});
