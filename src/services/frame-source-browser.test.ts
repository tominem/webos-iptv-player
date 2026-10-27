// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { browserFrameDeps } from './frame-source';

describe('browserFrameDeps', () => {
  it('keeps the frame video in the page, off screen and out of the way', () => {
    const video = browserFrameDeps.createVideo() as unknown as HTMLVideoElement;
    expect(video.tagName).toBe('VIDEO');
    expect(document.body.contains(video)).toBe(true);
    expect(video.style.pointerEvents).toBe('none');
    expect(video.style.opacity).toBe('0');
    video.remove();
  });

  it('makes a canvas for the frames', () => {
    expect((browserFrameDeps.createCanvas() as unknown as HTMLElement).tagName).toBe('CANVAS');
  });
});
