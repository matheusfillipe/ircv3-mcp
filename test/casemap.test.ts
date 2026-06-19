import { describe, it, expect } from 'vitest';
import { casefold, nameEquals } from '../src/irc-core/casemap';

describe('casefold', () => {
  describe('ascii', () => {
    it('lowercases A-Z', () => {
      expect(casefold('HELLO', 'ascii')).toBe('hello');
    });

    it('leaves brackets unchanged', () => {
      expect(casefold('Nick[]', 'ascii')).toBe('nick[]');
    });

    it('leaves backslash unchanged', () => {
      expect(casefold('Nick\\', 'ascii')).toBe('nick\\');
    });

    it('leaves tilde unchanged', () => {
      expect(casefold('~nick', 'ascii')).toBe('~nick');
    });
  });

  describe('rfc1459', () => {
    it('lowercases A-Z', () => {
      expect(casefold('HELLO', 'rfc1459')).toBe('hello');
    });

    it('maps [ to {', () => {
      expect(casefold('[', 'rfc1459')).toBe('{');
    });

    it('maps ] to }', () => {
      expect(casefold(']', 'rfc1459')).toBe('}');
    });

    it('maps \\ to |', () => {
      expect(casefold('\\', 'rfc1459')).toBe('|');
    });

    it('maps ~ to ^', () => {
      expect(casefold('~', 'rfc1459')).toBe('^');
    });

    it('Nick[] equals nick{} under rfc1459', () => {
      expect(casefold('Nick[]', 'rfc1459')).toBe('nick{}');
    });
  });

  describe('rfc1459-strict', () => {
    it('lowercases A-Z', () => {
      expect(casefold('HELLO', 'rfc1459-strict')).toBe('hello');
    });

    it('maps [ to {', () => {
      expect(casefold('[', 'rfc1459-strict')).toBe('{');
    });

    it('maps ] to }', () => {
      expect(casefold(']', 'rfc1459-strict')).toBe('}');
    });

    it('maps \\ to |', () => {
      expect(casefold('\\', 'rfc1459-strict')).toBe('|');
    });

    it('does NOT map ~ to ^ (strict)', () => {
      expect(casefold('~', 'rfc1459-strict')).toBe('~');
    });

    it('~ and ^ are NOT equal under rfc1459-strict', () => {
      expect(casefold('~nick', 'rfc1459-strict')).not.toBe(casefold('^nick', 'rfc1459-strict'));
    });
  });
});

describe('nameEquals', () => {
  it('Nick[] equals nick{} under rfc1459', () => {
    expect(nameEquals('Nick[]', 'nick{}', 'rfc1459')).toBe(true);
  });

  it('~nick equals ^nick under rfc1459', () => {
    expect(nameEquals('~nick', '^nick', 'rfc1459')).toBe(true);
  });

  it('~nick does NOT equal ^nick under rfc1459-strict', () => {
    expect(nameEquals('~nick', '^nick', 'rfc1459-strict')).toBe(false);
  });

  it('Nick[] does NOT equal nick{} under ascii', () => {
    expect(nameEquals('Nick[]', 'nick{}', 'ascii')).toBe(false);
  });

  it('HELLO equals hello under all mappings', () => {
    expect(nameEquals('HELLO', 'hello', 'ascii')).toBe(true);
    expect(nameEquals('HELLO', 'hello', 'rfc1459')).toBe(true);
    expect(nameEquals('HELLO', 'hello', 'rfc1459-strict')).toBe(true);
  });
});
