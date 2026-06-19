import { describe, it, expect } from 'vitest';
import { parseIsupport } from '../src/irc-core/isupport';

const REALISTIC_TOKENS = [
  'CHANTYPES=#',
  'EXCEPTS',
  'INVEX',
  'CHANMODES=eIbq,k,flj,CFLMPQ',
  'CHANLEN=50',
  'PREFIX=(ov)@+',
  'MAXLIST=bqeI:100',
  'MODES=4',
  'NETWORK=Libera.Chat',
  'STATUSMSG=@+',
  'CALLERID=g',
  'CASEMAPPING=rfc1459',
  'CHATHISTORY=1000',
  'MSGREFTYPES=timestamp,msgid',
  'BOT=B',
];

describe('parseIsupport', () => {
  it('parses PREFIX into rank-ordered mode/symbol pairs', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.prefix).toEqual([
      { mode: 'o', symbol: '@' },
      { mode: 'v', symbol: '+' },
    ]);
  });

  it('parses CHANMODES into groups a,b,c,d', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.chanmodes).toEqual({ a: 'eIbq', b: 'k', c: 'flj', d: 'CFLMPQ' });
  });

  it('parses CASEMAPPING', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.casemapping).toBe('rfc1459');
  });

  it('parses NETWORK', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.network).toBe('Libera.Chat');
  });

  it('parses CHATHISTORY as a number', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.chathistory).toBe(1000);
  });

  it('parses MSGREFTYPES as an array', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.msgreftypes).toEqual(['timestamp', 'msgid']);
  });

  it('parses BOT', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.bot).toBe('B');
  });

  it('stores all raw tokens', () => {
    const result = parseIsupport(REALISTIC_TOKENS);
    expect(result.raw['CHANTYPES']).toBe('#');
    expect(result.raw['EXCEPTS']).toBe(true);
    expect(result.raw['CHATHISTORY']).toBe('1000');
  });

  it('defaults casemapping to rfc1459 when absent', () => {
    const result = parseIsupport(['CHANTYPES=#']);
    expect(result.casemapping).toBe('rfc1459');
  });

  it('defaults prefix to empty array when absent', () => {
    const result = parseIsupport(['CHANTYPES=#']);
    expect(result.prefix).toEqual([]);
  });

  it('defaults msgreftypes to empty array when absent', () => {
    const result = parseIsupport(['CHANTYPES=#']);
    expect(result.msgreftypes).toEqual([]);
  });

  it('defaults chantypes to # when absent', () => {
    const result = parseIsupport([]);
    expect(result.chantypes).toBe('#');
  });

  it('handles negation token -KEY', () => {
    const result = parseIsupport(['-EXCEPTS']);
    // negated tokens are stored with false or removed from raw
    expect(result.raw['-EXCEPTS']).toBeUndefined();
    expect(result.raw['EXCEPTS']).toBeUndefined();
  });
});
