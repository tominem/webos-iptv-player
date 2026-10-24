import { CONFIG } from '../config';
import { parseTsStreams } from '../utils/ts-streams';
import { diagnosticStreamUrl } from '../utils/url';
import { createLogger } from '../utils/logger';
import { isWebOS } from '../utils/platform';
import { proxiedUrl } from './service-http';

const log = createLogger('StreamDiagnosis');

export type StreamFailure = 'offline' | 'denied' | 'busy' | 'unreachable' | 'format' | 'unknown';

export interface StreamDiagnosis {
  reason: StreamFailure;
  status?: number;
  video?: string;
  audio?: string[];
}

// Codecs a failed stream is blamed on; the others decode on the TV.
const SUSPECT_VIDEO = ['hevc', 'vc1', 'mpeg4'];

function failureForStatus(status: number): StreamFailure {
  if (status === 404 || status === 410) return 'offline';
  if (status === 401 || status === 403) return 'denied';
  if (status === 429 || status >= 500) return 'busy';
  return 'unknown';
}

async function readPrefix(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.length) {
        chunks.push(value);
        received += value.length;
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** Why a stream that failed to play failed, from one short request to it. Meant
 *  for the moment after playback has already failed, when no stream is open. */
export async function diagnoseStream(url: string, userAgent?: string): Promise<StreamDiagnosis> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.PLAYER.FAILURE_DIAGNOSIS_TIMEOUT_MS);
  let diagnosis: StreamDiagnosis = { reason: 'unknown' };
  try {
    const target = proxiedUrl(url, userAgent);
    const response = await fetch(target, {
      signal: controller.signal,
      ...(userAgent && target === url ? { headers: { 'User-Agent': userAgent } } : {}),
    });
    if (!response.ok) {
      diagnosis = { reason: failureForStatus(response.status), status: response.status };
    } else {
      const bytes = await readPrefix(response, CONFIG.PLAYER.FAILURE_DIAGNOSIS_BYTES);
      if (bytes.length === 0) {
        diagnosis = { reason: 'offline', status: response.status };
      } else {
        const streams = parseTsStreams(bytes);
        diagnosis = { reason: 'unknown', status: response.status };
        if (streams) {
          if (streams.video) diagnosis.video = streams.video;
          if (streams.audio.length) diagnosis.audio = streams.audio;
          if (streams.video && SUSPECT_VIDEO.indexOf(streams.video) >= 0) diagnosis.reason = 'format';
        }
      }
    }
  } catch (error) {
    const timedOut = controller.signal.aborted;
    diagnosis = { reason: timedOut || isWebOS() ? 'unreachable' : 'unknown' };
    log.debug('Stream diagnosis request failed', error);
  } finally {
    clearTimeout(timer);
  }
  log.info(
    'Playback failure diagnosed',
    'event=playback.diagnosis',
    `reason=${diagnosis.reason}`,
    `http=${diagnosis.status === undefined ? 'none' : String(diagnosis.status)}`,
    `video=${diagnosis.video ?? 'unknown'}`,
    `audio=${diagnosis.audio ? diagnosis.audio.join(',') : 'unknown'}`,
    `url=${diagnosticStreamUrl(url)}`,
  );
  return diagnosis;
}
