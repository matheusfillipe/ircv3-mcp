import type { IrcMessage, Source } from './types';
import { parseTags, encodeTags } from './tags';

export function parseSource(raw: string): Source {
  const hasExcl = raw.includes('!');
  const hasAt = raw.includes('@');
  const isServer = !hasExcl && !hasAt && raw.includes('.');

  if (hasExcl) {
    const exclIdx = raw.indexOf('!');
    const atIdx = raw.indexOf('@');
    const nick = raw.slice(0, exclIdx);
    const user = atIdx !== -1 ? raw.slice(exclIdx + 1, atIdx) : raw.slice(exclIdx + 1);
    const host = atIdx !== -1 ? raw.slice(atIdx + 1) : undefined;
    return { raw, nick, user, host, isServer };
  }

  if (hasAt) {
    const atIdx = raw.indexOf('@');
    return { raw, nick: raw.slice(0, atIdx), host: raw.slice(atIdx + 1), isServer };
  }

  return { raw, nick: isServer ? undefined : raw, isServer };
}

export function parseLine(raw: string): IrcMessage {
  // strip trailing CRLF or LF
  let line = raw;
  if (line.endsWith('\r\n')) line = line.slice(0, -2);
  else if (line.endsWith('\n')) line = line.slice(0, -1);

  let tags: IrcMessage['tags'] = {};
  let source: Source | undefined;
  let rest = line;

  if (rest.startsWith('@')) {
    const spaceIdx = rest.indexOf(' ');
    tags = parseTags(rest.slice(1, spaceIdx));
    rest = rest.slice(spaceIdx + 1);
  }

  if (rest.startsWith(':')) {
    const spaceIdx = rest.indexOf(' ');
    source = parseSource(rest.slice(1, spaceIdx));
    rest = rest.slice(spaceIdx + 1);
  }

  const params: string[] = [];
  let pos = 0;
  const parts = rest.split(' ');
  const command = parts[0];
  pos = 1;

  while (pos < parts.length) {
    const part = parts[pos];
    if (part.startsWith(':')) {
      // trailing param — everything from here to end, stripping the leading colon
      const trailingStart = rest.indexOf(' :');
      if (trailingStart !== -1) {
        params.push(rest.slice(trailingStart + 2));
      } else {
        params.push(part.slice(1));
      }
      break;
    }
    if (part !== '') params.push(part);
    pos++;
  }

  return { tags, source, command, params };
}

export function formatLine(msg: IrcMessage): string {
  const parts: string[] = [];

  if (Object.keys(msg.tags).length > 0) {
    parts.push(`@${encodeTags(msg.tags)}`);
  }

  if (msg.source) {
    parts.push(`:${msg.source.raw}`);
  }

  parts.push(msg.command);

  const params = msg.params;
  if (params.length > 0) {
    const last = params[params.length - 1];
    const middles = params.slice(0, -1);
    for (const p of middles) {
      parts.push(p);
    }
    // emit last param as trailing if it's empty, contains spaces, or starts with ':'
    if (last === '' || last.includes(' ') || last.startsWith(':')) {
      parts.push(`:${last}`);
    } else {
      parts.push(last);
    }
  }

  return parts.join(' ') + '\r\n';
}

export function byteLenNoTags(msg: IrcMessage): number {
  const full = formatLine(msg);
  const fullBytes = Buffer.byteLength(full, 'utf8');

  if (Object.keys(msg.tags).length > 0) {
    const tagSection = `@${encodeTags(msg.tags)} `;
    const tagBytes = Buffer.byteLength(tagSection, 'utf8');
    return fullBytes - tagBytes;
  }

  return fullBytes;
}

export function withinLimits(msg: IrcMessage): { body: boolean; tags: boolean } {
  const full = formatLine(msg);

  let tagBytes = 0;
  if (Object.keys(msg.tags).length > 0) {
    tagBytes = Buffer.byteLength(`@${encodeTags(msg.tags)} `, 'utf8');
  }

  const bodyBytes = Buffer.byteLength(full, 'utf8') - tagBytes;

  return {
    body: bodyBytes <= 512,
    tags: tagBytes <= 8191,
  };
}
