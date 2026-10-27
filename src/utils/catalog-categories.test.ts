import { describe, expect, it } from 'vitest';
import { withoutMovieCategories } from './catalog-categories';

const cat = (id: string, name: string) => ({ id, name });

describe('withoutMovieCategories', () => {
  it('drops a series category that is a movie category the provider repeated', () => {
    const series = [cat('1', 'Series A'), cat('385', 'Movies | Top 10'), cat('386', 'Series | Top 10')];
    const movies = [cat('385', 'Movies | Top 10'), cat('2', 'Movies B')];
    expect(withoutMovieCategories(series, movies)).toEqual([cat('1', 'Series A'), cat('386', 'Series | Top 10')]);
  });

  it('keeps a series category that only shares an id or only a name with a movie one', () => {
    const series = [cat('5', 'Series C'), cat('6', 'Shared name')];
    const movies = [cat('5', 'Movies C'), cat('7', 'Shared name')];
    expect(withoutMovieCategories(series, movies)).toEqual(series);
  });

  it('keeps everything when there are no movie categories', () => {
    const series = [cat('1', 'Series A')];
    expect(withoutMovieCategories(series, [])).toEqual(series);
  });
});
