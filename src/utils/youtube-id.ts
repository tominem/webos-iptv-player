const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const URL_FORMS = [
  /[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
  /youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
  /\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
];

// Providers send either the bare video id or a YouTube link; '' when it is neither.
export function youtubeVideoId(raw: string): string {
  const value = raw.trim();
  if (VIDEO_ID.test(value)) return value;
  for (const form of URL_FORMS) {
    const match = form.exec(value);
    if (match) return match[1];
  }
  return '';
}
