interface Category {
  id: string;
  name: string;
}

// Some providers list a movie category among their series categories too, under
// the same id and name; Series shows only the ones that are its own.
export function withoutMovieCategories<T extends Category>(series: T[], movies: Category[]): T[] {
  const repeated = new Set(movies.map(category => `${category.id}|${category.name}`));
  return series.filter(category => !repeated.has(`${category.id}|${category.name}`));
}
