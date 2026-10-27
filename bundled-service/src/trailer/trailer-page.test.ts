import { describe, it, expect } from 'vitest';
import { isVideoId, trailerPageHtml } from './trailer-page';

describe('isVideoId', () => {
  it('accepts an eleven character YouTube id and nothing else', () => {
    expect(isVideoId('abcDEF_-123')).toBe(true);
    expect(isVideoId('')).toBe(false);
    expect(isVideoId('short')).toBe(false);
    expect(isVideoId('abcDEF_-1234')).toBe(false);
    expect(isVideoId('abc"><script>')).toBe(false);
  });
});

describe('trailerPageHtml', () => {
  it('frames the embedded player for the video, with autoplay and its script API', () => {
    const page = trailerPageHtml('abcDEF_-123');
    expect(page).toMatch(/^<!DOCTYPE html>/);
    expect(page).toContain('src="https://www.youtube.com/embed/abcDEF_-123?enablejsapi=1&autoplay=1&');
    expect(page).toContain('id="player"');
  });

  it('can load the player without playing it, and plays on command', () => {
    const page = trailerPageHtml('abcDEF_-123', false);
    expect(page).toContain('&autoplay=0&');
    expect(trailerPageHtml('abcDEF_-123')).toContain('&autoplay=1&');
    expect(page).toContain('data.command === "play"');
    // A play asked for before the player is ready is held until it is.
    expect(page).toContain('wantPlay');
  });

  it('relays the player state and errors to the app and the toggle command back', () => {
    const page = trailerPageHtml('abcDEF_-123');
    expect(page).toContain('"iptv-trailer"');
    expect(page).toContain('onStateChange');
    expect(page).toContain('onError');
    expect(page).toContain('pauseVideo');
    expect(page).toContain('playVideo');
  });

  it('relays the playing position and length, and seeks on request', () => {
    const page = trailerPageHtml('abcDEF_-123');
    expect(page).toContain('infoDelivery');
    expect(page).toContain('data.info.currentTime');
    expect(page).toContain('data.info.duration');
    expect(page).toContain('seekTo');
  });

  it('is valid ES5 for the TV browser script', () => {
    const script = trailerPageHtml('abcDEF_-123').split('<script>')[1].split('</script>')[0];
    // eslint-disable-next-line no-new-func
    expect(() => new Function(script)).not.toThrow();
    expect(script).not.toMatch(/=>|\blet\b|\bconst\b/);
  });
});
