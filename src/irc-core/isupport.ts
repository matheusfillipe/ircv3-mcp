import type { Isupport } from './types';

function parsePrefix(value: string): Array<{ mode: string; symbol: string }> {
  // Format: (modes)symbols e.g. (ov)@+
  const match = value.match(/^\(([^)]*)\)(.*)$/);
  if (!match) return [];
  const modes = match[1];
  const symbols = match[2];
  const result: Array<{ mode: string; symbol: string }> = [];
  for (let i = 0; i < modes.length && i < symbols.length; i++) {
    result.push({ mode: modes[i], symbol: symbols[i] });
  }
  return result;
}

function parseChanmodes(value: string): Isupport['chanmodes'] {
  const parts = value.split(',');
  return {
    a: parts[0] ?? '',
    b: parts[1] ?? '',
    c: parts[2] ?? '',
    d: parts[3] ?? '',
  };
}

export function parseIsupport(tokens: string[]): Isupport {
  const raw: Record<string, string | true> = {};

  const result: Isupport = {
    prefix: [],
    chanmodes: { a: '', b: '', c: '', d: '' },
    chantypes: '#',
    casemapping: 'rfc1459',
    msgreftypes: [],
    raw,
  };

  for (const token of tokens) {
    if (token.startsWith('-')) {
      continue;
    }

    const eqIdx = token.indexOf('=');
    if (eqIdx === -1) {
      raw[token] = true;
    } else {
      const key = token.slice(0, eqIdx);
      const value = token.slice(eqIdx + 1);
      raw[key] = value;

      switch (key) {
        case 'PREFIX':
          result.prefix = parsePrefix(value);
          break;
        case 'CHANMODES':
          result.chanmodes = parseChanmodes(value);
          break;
        case 'CHANTYPES':
          result.chantypes = value;
          break;
        case 'CASEMAPPING':
          result.casemapping = value as Isupport['casemapping'];
          break;
        case 'NETWORK':
          result.network = value;
          break;
        case 'CHATHISTORY':
          result.chathistory = parseInt(value, 10);
          break;
        case 'MSGREFTYPES':
          result.msgreftypes = value ? value.split(',') : [];
          break;
        case 'BOT':
          result.bot = value;
          break;
      }
    }
  }

  return result;
}
