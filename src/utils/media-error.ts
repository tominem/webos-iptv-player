// The standard MediaError codes. An error object printed to the console shows
// as "Object" over the remote debugger, so a log line carries this text.
const MEDIA_ERROR_NAMES: Readonly<Record<number, string>> = {
  1: 'MEDIA_ERR_ABORTED',
  2: 'MEDIA_ERR_NETWORK',
  3: 'MEDIA_ERR_DECODE',
  4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
};

export function describeMediaError(error: { code: number; message?: string } | null | undefined): string {
  if (!error) return 'no error info';
  const name = MEDIA_ERROR_NAMES[error.code];
  const code = name ? `${name}(${String(error.code)})` : `code=${String(error.code)}`;
  return error.message ? `${code} ${error.message}` : code;
}
