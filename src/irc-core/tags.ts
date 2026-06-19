import type { Tags } from './types';

const UNESCAPE: Record<string, string> = {
  ':': ';',
  s: ' ',
  '\\': '\\',
  r: '\r',
  n: '\n',
};

function unescapeValue(s: string): string {
  let result = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\\') {
      if (i + 1 >= s.length) {
        // lone trailing backslash is dropped
        break;
      }
      const next = s[i + 1];
      result += UNESCAPE[next] ?? next;
      i += 2;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

function escapeValue(s: string): string {
  let result = '';
  for (const ch of s) {
    if (ch === ';') result += '\\:';
    else if (ch === ' ') result += '\\s';
    else if (ch === '\\') result += '\\\\';
    else if (ch === '\r') result += '\\r';
    else if (ch === '\n') result += '\\n';
    else result += ch;
  }
  return result;
}

export function parseTags(s: string): Tags {
  if (!s) return {};
  const tags: Tags = {};
  for (const token of s.split(';')) {
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq === -1) {
      tags[token] = '';
    } else {
      tags[token.slice(0, eq)] = unescapeValue(token.slice(eq + 1));
    }
  }
  return tags;
}

export function encodeTags(t: Tags): string {
  return Object.entries(t)
    .map(([k, v]) => (v === '' ? k : `${k}=${escapeValue(v)}`))
    .join(';');
}
