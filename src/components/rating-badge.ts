import { html, raw, type Safe } from '../utils/dom';
import { formatRating } from '../utils/rating';
import { RATING_STAR_ICON } from './icons';

// The score on a poster's corner; nothing for a title the provider did not rate.
export function ratingBadge(rating: string | undefined): Safe | '' {
  const score = formatRating(rating);
  if (!score) return '';
  return html`<span class="catalog-rating">${raw(RATING_STAR_ICON)}<span>${score}</span></span>`;
}
