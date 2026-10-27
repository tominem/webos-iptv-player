// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SeekPreview } from './seek-preview';

let container: HTMLElement;
let preview: SeekPreview;

function bar(left: number, width: number): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 900, bottom: 910, height: 10, x: left, y: 900, toJSON: () => ({}),
  }) as DOMRect;
  return el;
}

const popup = () => container.querySelector<HTMLElement>('.osd-seek-preview')!;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  preview = new SeekPreview(container);
});

describe('SeekPreview', () => {
  it('creates nothing until it is shown', () => {
    expect(container.querySelector('.osd-seek-preview')).toBeNull();
    expect(preview.visible).toBe(false);
  });

  it('shows the time over the bar position it stands for', () => {
    preview.show(bar(200, 1000), 0.5, '12:34');
    expect(preview.visible).toBe(true);
    expect(popup().classList.contains('hidden')).toBe(false);
    expect(popup().querySelector('.osd-seek-preview-time')?.textContent).toBe('12:34');
    // Centered on the bar's midpoint, above it.
    expect(popup().style.left).toBe('700px');
    expect(popup().style.bottom).toBe(`${String(window.innerHeight - 900 + 24)}px`);
  });

  it('stands above the opaque OSD panel that holds the bar, not inside it', () => {
    const panel = document.createElement('div');
    panel.className = 'player-osd';
    panel.getBoundingClientRect = () => ({ top: 800, height: 140, toJSON: () => ({}) }) as DOMRect;
    const inner = bar(200, 1000);
    panel.appendChild(inner);
    preview.show(inner, 0.5, '12:34');
    expect(popup().style.bottom).toBe(`${String(window.innerHeight - 800 + 24)}px`);
  });

  it('keeps itself on screen at both ends of the bar', () => {
    preview.show(bar(100, 1000), 0, '0:00');
    expect(parseFloat(popup().style.left)).toBeGreaterThanOrEqual(80 + 160);
    preview.show(bar(100, 1720), 1, '2:00:00');
    expect(parseFloat(popup().style.left)).toBeLessThanOrEqual(1920 - 80 - 160);
  });

  it('assumes a full HD screen when the window reports no width', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 });
    try {
      preview.show(bar(0, 3000), 1, '2:00:00');
      expect(parseFloat(popup().style.left)).toBe(1920 - 80 - 160);
      expect(popup().style.bottom).toBe(`${String(1080 - 900 + 24)}px`);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    }
  });

  it('can be hidden before it was ever shown', () => {
    preview.hide();
    expect(container.querySelector('.osd-seek-preview')).toBeNull();
  });

  it('falls back to the screen edge when the bar is missing', () => {
    preview.show(null, 0.5, '1:00');
    expect(popup().style.bottom).toBe('80px');
    expect(popup().classList.contains('hidden')).toBe(false);
  });

  it('puts the frame in the popup, and takes it out when there is none', () => {
    const canvas = document.createElement('canvas');
    preview.show(bar(0, 1000), 0.2, '1:00');
    preview.setFrame(canvas);
    expect(popup().contains(canvas)).toBe(true);
    expect(popup().classList.contains('has-frame')).toBe(true);
    preview.setFrame(canvas);
    expect(popup().querySelectorAll('canvas')).toHaveLength(1);
    preview.setFrame(null);
    expect(popup().contains(canvas)).toBe(false);
    expect(popup().classList.contains('has-frame')).toBe(false);
  });

  it('ignores a frame while hidden', () => {
    preview.setFrame(document.createElement('canvas'));
    expect(container.querySelector('.osd-seek-preview')).toBeNull();
  });

  it('hides and drops its frame', () => {
    const canvas = document.createElement('canvas');
    preview.show(bar(0, 1000), 0.2, '1:00');
    preview.setFrame(canvas);
    preview.hide();
    expect(preview.visible).toBe(false);
    expect(popup().classList.contains('hidden')).toBe(true);
    expect(popup().contains(canvas)).toBe(false);
    preview.hide();
    expect(preview.visible).toBe(false);
  });
});
