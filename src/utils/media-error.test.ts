// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { describeMediaError } from './media-error';

describe('describeMediaError', () => {
  it('names each standard code', () => {
    expect(describeMediaError({ code: 1 })).toBe('MEDIA_ERR_ABORTED(1)');
    expect(describeMediaError({ code: 2 })).toBe('MEDIA_ERR_NETWORK(2)');
    expect(describeMediaError({ code: 3 })).toBe('MEDIA_ERR_DECODE(3)');
    expect(describeMediaError({ code: 4 })).toBe('MEDIA_ERR_SRC_NOT_SUPPORTED(4)');
  });

  it('appends the engine message when there is one', () => {
    expect(describeMediaError({ code: 2, message: 'PIPELINE_ERROR_READ' }))
      .toBe('MEDIA_ERR_NETWORK(2) PIPELINE_ERROR_READ');
  });

  it('keeps an unknown code readable', () => {
    expect(describeMediaError({ code: 99, message: '' })).toBe('code=99');
  });

  it('says so when the element has no error', () => {
    expect(describeMediaError(null)).toBe('no error info');
    expect(describeMediaError(undefined)).toBe('no error info');
  });
});
