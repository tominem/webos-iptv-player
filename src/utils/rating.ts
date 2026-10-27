// Providers send a ten point rating as text, with "0" or "" for unrated titles.
export function formatRating(raw: string | undefined): string | null {
  const value = parseFloat(raw ?? '');
  if (!(value > 0) || value > 10) return null;
  return value.toFixed(1);
}
