// Reads the stream types an MPEG-TS stream declares in its PAT and PMT, so a
// failed live stream can be named ("HEVC video") without decoding anything.

export interface TsStreams {
  video: string | null;
  audio: string[];
}

const PACKET = 188;
const VIDEO_TYPES: Record<number, string> = {
  0x01: 'mpeg1', 0x02: 'mpeg2', 0x10: 'mpeg4', 0x1b: 'h264', 0x24: 'hevc', 0xea: 'vc1',
};
const AUDIO_TYPES: Record<number, string> = {
  0x03: 'mp2', 0x04: 'mp2', 0x0f: 'aac', 0x11: 'aac', 0x81: 'ac3', 0x87: 'eac3',
};

function alignment(bytes: Uint8Array): number {
  for (let start = 0; start < PACKET && start + PACKET * 3 < bytes.length; start++) {
    if (bytes[start] === 0x47 && bytes[start + PACKET] === 0x47 && bytes[start + PACKET * 2] === 0x47) {
      return start;
    }
  }
  return -1;
}

// The payload of a packet that starts a section, after the pointer field.
function sectionStart(bytes: Uint8Array, packet: number): number {
  if ((bytes[packet + 1] & 0x40) === 0) return -1;
  const control = (bytes[packet + 3] >> 4) & 0x03;
  if (control === 0 || control === 2) return -1;
  let offset = packet + 4;
  if (control === 3) offset += 1 + bytes[offset];
  offset += 1 + bytes[offset];
  return offset < packet + PACKET ? offset : -1;
}

/** The video and audio codecs declared by the first program, or null when no
 *  complete PAT and PMT fit in `bytes`. Sections spanning packets are not read. */
export function parseTsStreams(bytes: Uint8Array): TsStreams | null {
  const first = alignment(bytes);
  if (first < 0) return null;
  let pmtPid = -1;
  for (let packet = first; packet + PACKET <= bytes.length; packet += PACKET) {
    if (bytes[packet] !== 0x47) return null;
    const pid = ((bytes[packet + 1] & 0x1f) << 8) | bytes[packet + 2];
    const section = sectionStart(bytes, packet);
    if (section < 0) continue;
    if (pid === 0 && pmtPid < 0 && bytes[section] === 0x00) {
      const end = section + 3 + (((bytes[section + 1] & 0x0f) << 8) | bytes[section + 2]) - 4;
      for (let entry = section + 8; entry + 4 <= end && entry + 4 <= packet + PACKET; entry += 4) {
        if (((bytes[entry] << 8) | bytes[entry + 1]) !== 0) {
          pmtPid = ((bytes[entry + 2] & 0x1f) << 8) | bytes[entry + 3];
          break;
        }
      }
    } else if (pid === pmtPid && bytes[section] === 0x02) {
      const length = ((bytes[section + 1] & 0x0f) << 8) | bytes[section + 2];
      const end = Math.min(section + 3 + length - 4, packet + PACKET);
      let entry = section + 12 + (((bytes[section + 10] & 0x0f) << 8) | bytes[section + 11]);
      const result: TsStreams = { video: null, audio: [] };
      while (entry + 5 <= end) {
        const type = bytes[entry];
        const video = VIDEO_TYPES[type];
        const audio = AUDIO_TYPES[type];
        if (video && !result.video) result.video = video;
        else if (audio && result.audio.indexOf(audio) < 0) result.audio.push(audio);
        entry += 5 + (((bytes[entry + 3] & 0x0f) << 8) | bytes[entry + 4]);
      }
      return result;
    }
  }
  return null;
}
