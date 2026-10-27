import { describe, expect, it } from 'vitest';
import { youtubeVideoId } from './youtube-id';

describe('youtubeVideoId', () => {
  it('takes a bare video id', () => {
    expect(youtubeVideoId('abcDEF_-123')).toBe('abcDEF_-123');
    expect(youtubeVideoId('  abcDEF_-123 ')).toBe('abcDEF_-123');
  });

  it('takes the id out of the usual link forms', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcDEF_-123')).toBe('abcDEF_-123');
    expect(youtubeVideoId('https://www.youtube.com/watch?list=pl1&v=abcDEF_-123&t=5')).toBe('abcDEF_-123');
    expect(youtubeVideoId('https://youtu.be/abcDEF_-123?si=x')).toBe('abcDEF_-123');
    expect(youtubeVideoId('https://www.youtube.com/embed/abcDEF_-123')).toBe('abcDEF_-123');
    expect(youtubeVideoId('https://www.youtube.com/shorts/abcDEF_-123')).toBe('abcDEF_-123');
  });

  it('gives nothing for text that is not a video', () => {
    expect(youtubeVideoId('')).toBe('');
    expect(youtubeVideoId('not a video')).toBe('');
    expect(youtubeVideoId('abc')).toBe('');
    expect(youtubeVideoId('https://host/watch?v=tooShort')).toBe('');
    expect(youtubeVideoId('https://host/watch?v=abcDEF_-123456')).toBe('');
  });
});
