import type { Isupport } from './types';

export function casefold(name: string, mapping: Isupport['casemapping']): string {
  let result = '';
  for (const ch of name) {
    const lower = ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch;
    if (mapping === 'ascii') {
      result += lower;
    } else if (mapping === 'rfc1459') {
      if (lower === '[') result += '{';
      else if (lower === ']') result += '}';
      else if (lower === '\\') result += '|';
      else if (lower === '~') result += '^';
      else result += lower;
    } else {
      // rfc1459-strict: same as rfc1459 but ~ does not map to ^
      if (lower === '[') result += '{';
      else if (lower === ']') result += '}';
      else if (lower === '\\') result += '|';
      else result += lower;
    }
  }
  return result;
}

export function nameEquals(a: string, b: string, mapping: Isupport['casemapping']): boolean {
  return casefold(a, mapping) === casefold(b, mapping);
}
