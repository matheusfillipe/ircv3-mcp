import { describe, it, expect } from 'vitest';
import { parseTags, encodeTags } from '../src/irc-core/tags';

describe('parseTags', () => {
  it('parses simple key=value and valueless key', () => {
    expect(parseTags('a=b;c')).toEqual({ a: 'b', c: '' });
  });

  it('parses multiple key=value pairs', () => {
    expect(parseTags('a=b;c=d')).toEqual({ a: 'b', c: 'd' });
  });

  it('keeps client-only + prefix verbatim', () => {
    const result = parseTags('+draft/react=👋');
    expect(result['+draft/react']).toBe('👋');
  });

  it('emoji value travels raw', () => {
    expect(parseTags('key=🎉')).toEqual({ key: '🎉' });
  });

  it('unescapes \\: to semicolon', () => {
    expect(parseTags('a=hello\\:world')).toEqual({ a: 'hello;world' });
  });

  it('unescapes \\s to space', () => {
    expect(parseTags('a=hello\\sworld')).toEqual({ a: 'hello world' });
  });

  it('unescapes \\\\ to backslash', () => {
    expect(parseTags('a=hello\\\\world')).toEqual({ a: 'hello\\world' });
  });

  it('unescapes \\r to CR', () => {
    expect(parseTags('a=\\r')).toEqual({ a: '\r' });
  });

  it('unescapes \\n to LF', () => {
    expect(parseTags('a=\\n')).toEqual({ a: '\n' });
  });

  it('drops lone trailing backslash', () => {
    expect(parseTags('a=hello\\')).toEqual({ a: 'hello' });
  });

  it('unknown escape \\b drops backslash, keeps b', () => {
    expect(parseTags('a=\\b')).toEqual({ a: 'b' });
  });

  it('empty string input returns empty object', () => {
    expect(parseTags('')).toEqual({});
  });
});

describe('encodeTags', () => {
  it('encodes key=value pairs', () => {
    expect(encodeTags({ a: 'b', c: 'd' })).toMatch(/a=b/);
  });

  it('encodes valueless key as bare key (no =)', () => {
    const result = encodeTags({ a: '' });
    expect(result).toBe('a');
  });

  it('escapes semicolons in values', () => {
    expect(encodeTags({ a: 'hello;world' })).toBe('a=hello\\:world');
  });

  it('escapes spaces in values', () => {
    expect(encodeTags({ a: 'hello world' })).toBe('a=hello\\sworld');
  });

  it('escapes backslashes in values', () => {
    expect(encodeTags({ a: 'hello\\world' })).toBe('a=hello\\\\world');
  });

  it('escapes CR in values', () => {
    expect(encodeTags({ a: '\r' })).toBe('a=\\r');
  });

  it('escapes LF in values', () => {
    expect(encodeTags({ a: '\n' })).toBe('a=\\n');
  });

  it('emoji values travel raw', () => {
    expect(encodeTags({ key: '🎉' })).toBe('key=🎉');
  });

  it('client tag with emoji value round-trips', () => {
    const tags = parseTags('+draft/react=👋');
    const encoded = encodeTags(tags);
    expect(encoded).toBe('+draft/react=👋');
  });

  it('full escape round-trip', () => {
    const original = 'a=hello\\:world;b=foo\\sbar;c=back\\\\slash';
    const tags = parseTags(original);
    const encoded = encodeTags(tags);
    const parsed2 = parseTags(encoded);
    expect(parsed2).toEqual(tags);
  });
});
