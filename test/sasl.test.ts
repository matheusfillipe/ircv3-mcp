import { describe, it, expect } from 'vitest';
import { buildPlain, plainResponse } from '../src/irc-core/sasl/plain';
import { externalResponse } from '../src/irc-core/sasl/external';
import { chunkAuthenticate } from '../src/irc-core/sasl/chunk';

describe('SASL PLAIN', () => {
  it('buildPlain produces authzid\\0authcid\\0passwd bytes', () => {
    const buf = buildPlain('jilles', 'sesame', 'jilles');
    const parts = buf.toString('binary').split('\0');
    expect(parts).toEqual(['jilles', 'jilles', 'sesame']);
  });

  it('plainResponse matches RFC vector', () => {
    expect(plainResponse('jilles', 'sesame', 'jilles')).toBe('amlsbGVzAGppbGxlcwBzZXNhbWU=');
  });

  it('plainResponse with empty authzid', () => {
    const result = plainResponse('jilles', 'sesame');
    const decoded = Buffer.from(result, 'base64').toString('binary');
    const parts = decoded.split('\0');
    expect(parts).toEqual(['', 'jilles', 'sesame']);
  });
});

describe('SASL EXTERNAL', () => {
  it('empty authzid returns base64 of empty string', () => {
    expect(externalResponse()).toBe(Buffer.from('').toString('base64'));
  });

  it('authzid encodes correctly', () => {
    expect(externalResponse('me')).toBe(Buffer.from('me').toString('base64'));
  });
});

describe('chunkAuthenticate', () => {
  it('empty string returns ["+"]', () => {
    expect(chunkAuthenticate('')).toEqual(['+']);
  });

  it('399-char string → 1 chunk', () => {
    const s = 'A'.repeat(399);
    expect(chunkAuthenticate(s)).toEqual([s]);
  });

  it('400-char string → 2 chunks (data + "+")', () => {
    const s = 'A'.repeat(400);
    expect(chunkAuthenticate(s)).toEqual([s, '+']);
  });

  it('401-char string → 2 chunks', () => {
    const s = 'A'.repeat(401);
    expect(chunkAuthenticate(s)).toEqual(['A'.repeat(400), 'A']);
  });

  it('800-char string → 3 chunks (400 + 400 + "+")', () => {
    const s = 'A'.repeat(800);
    expect(chunkAuthenticate(s)).toEqual(['A'.repeat(400), 'A'.repeat(400), '+']);
  });
});
