import { describe, expect, it } from 'vitest';
import { formatRating } from './rating';

describe('formatRating', () => {
  it('shows a provider rating with one decimal', () => {
    expect(formatRating('7')).toBe('7.0');
    expect(formatRating('6.4')).toBe('6.4');
    expect(formatRating('8.25')).toBe('8.3');
    expect(formatRating(' 5.5 ')).toBe('5.5');
    expect(formatRating('10')).toBe('10.0');
  });

  it('shows nothing for a missing, zero or unreadable rating', () => {
    expect(formatRating('')).toBeNull();
    expect(formatRating(undefined)).toBeNull();
    expect(formatRating('0')).toBeNull();
    expect(formatRating('0.0')).toBeNull();
    expect(formatRating('n/a')).toBeNull();
    expect(formatRating('-3')).toBeNull();
  });

  it('shows nothing for a value that is not on a ten point scale', () => {
    expect(formatRating('85')).toBeNull();
  });
});
