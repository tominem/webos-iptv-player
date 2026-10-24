import { describe, expect, it } from 'vitest';
import { parseTsStreams } from './ts-streams';

const PACKET = 188;

function packet(pid: number, section: number[]): number[] {
  const out = [0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0x00, ...section];
  while (out.length < PACKET) out.push(0xff);
  return out;
}

function pat(pmtPid: number): number[] {
  const body = [0x00, 0x00, 0x00, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (pmtPid >> 8), pmtPid & 0xff, 0, 0, 0, 0];
  const length = body.length - 3;
  body[1] = 0xb0 | (length >> 8);
  body[2] = length & 0xff;
  return packet(0, body);
}

function pmt(pid: number, streams: Array<[number, number]>): number[] {
  const entries = streams.flatMap(([type, esPid]) => [type, 0xe0 | (esPid >> 8), esPid & 0xff, 0xf0, 0x00]);
  const body = [0x02, 0x00, 0x00, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00, ...entries, 0, 0, 0, 0];
  const length = body.length - 3;
  body[1] = 0xb0 | (length >> 8);
  body[2] = length & 0xff;
  return packet(pid, body);
}

function stream(...streams: Array<[number, number]>): Uint8Array {
  const filler = (n: number): number[] => Array.from({ length: PACKET }, (_, i) => (i === 0 ? 0x47 : n));
  return new Uint8Array([...pat(0x100), ...pmt(0x100, streams), ...filler(1), ...filler(2)]);
}

describe('parseTsStreams', () => {
  it('names the video and audio codecs of the first program', () => {
    expect(parseTsStreams(stream([0x24, 0x101], [0x0f, 0x102], [0x81, 0x103])))
      .toEqual({ video: 'hevc', audio: ['aac', 'ac3'] });
    expect(parseTsStreams(stream([0x1b, 0x101], [0x03, 0x102]))).toEqual({ video: 'h264', audio: ['mp2'] });
  });

  it('ignores stream types it does not know and repeated audio codecs', () => {
    expect(parseTsStreams(stream([0x15, 0x200], [0x0f, 0x102], [0x11, 0x103])))
      .toEqual({ video: null, audio: ['aac'] });
  });

  it('finds the packets when the capture starts mid-packet', () => {
    const bytes = stream([0x1b, 0x101], [0x0f, 0x102]);
    const shifted = new Uint8Array([9, 9, 9, ...bytes]);
    expect(parseTsStreams(shifted)).toEqual({ video: 'h264', audio: ['aac'] });
  });

  it('returns null without a complete PAT and PMT, or for non-TS data', () => {
    expect(parseTsStreams(new Uint8Array(0))).toBeNull();
    expect(parseTsStreams(new TextEncoder().encode('#EXTM3U\n'.repeat(200)))).toBeNull();
    expect(parseTsStreams(stream([0x1b, 0x101]).subarray(0, PACKET * 2))).toBeNull();
  });
});
