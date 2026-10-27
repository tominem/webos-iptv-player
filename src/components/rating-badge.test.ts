import { describe, expect, it } from 'vitest';
import { ratingBadge } from './rating-badge';

describe('ratingBadge', () => {
  it('is a star and the score for a rated title', () => {
    const markup = String(ratingBadge('7.5'));
    expect(markup).toContain('catalog-rating');
    expect(markup).toContain('7.5');
    expect(markup).toContain('<svg');
  });

  it('is empty for an unrated title', () => {
    expect(String(ratingBadge('0'))).toBe('');
    expect(String(ratingBadge(''))).toBe('');
  });
});
