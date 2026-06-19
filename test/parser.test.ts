import { describe, it, expect } from 'vitest';
import {
  parseLine,
  formatLine,
  parseSource,
  byteLenNoTags,
  withinLimits,
} from '../src/irc-core/parser';

describe('parseSource', () => {
  it('parses nick!user@host', () => {
    const s = parseSource('nick!u@h');
    expect(s.nick).toBe('nick');
    expect(s.user).toBe('u');
    expect(s.host).toBe('h');
    expect(s.isServer).toBe(false);
  });

  it('parses nick!user@host.example.com', () => {
    const s = parseSource('nick!user@host.example.com');
    expect(s.nick).toBe('nick');
    expect(s.user).toBe('user');
    expect(s.host).toBe('host.example.com');
    expect(s.isServer).toBe(false);
  });

  it('marks bare server name as isServer', () => {
    const s = parseSource('irc.example.com');
    expect(s.isServer).toBe(true);
    expect(s.nick).toBeUndefined();
  });

  it('parses nick with no host', () => {
    const s = parseSource('nick');
    expect(s.nick).toBe('nick');
    expect(s.isServer).toBe(false);
  });
});

describe('parseLine', () => {
  it('parses full message with tags and source', () => {
    const msg = parseLine('@a=b;c=d :nick!u@h PRIVMSG #chan :hello world');
    expect(msg.tags).toEqual({ a: 'b', c: 'd' });
    expect(msg.source?.nick).toBe('nick');
    expect(msg.source?.user).toBe('u');
    expect(msg.source?.host).toBe('h');
    expect(msg.command).toBe('PRIVMSG');
    expect(msg.params).toEqual(['#chan', 'hello world']);
  });

  it('parses numeric with server source and middle params', () => {
    const msg = parseLine(':server.example.com 005 nick TOKEN=1 :are supported');
    expect(msg.source?.isServer).toBe(true);
    expect(msg.command).toBe('005');
    expect(msg.params[0]).toBe('nick');
    expect(msg.params[1]).toBe('TOKEN=1');
    expect(msg.params[2]).toBe('are supported');
  });

  it('parses message with empty trailing param', () => {
    const msg = parseLine(':nick!u@h PRIVMSG #chan :');
    expect(msg.params[1]).toBe('');
  });

  it('parses message whose trailing has no spaces', () => {
    const msg = parseLine(':nick!u@h PRIVMSG #chan :hello');
    expect(msg.params[1]).toBe('hello');
  });

  it('parses PING with one non-trailing param', () => {
    const msg = parseLine('PING :server.example.com');
    expect(msg.command).toBe('PING');
    expect(msg.params[0]).toBe('server.example.com');
  });

  it('parses PING as middle param when no colon', () => {
    const msg = parseLine('PING server.example.com');
    expect(msg.command).toBe('PING');
    expect(msg.params[0]).toBe('server.example.com');
  });

  it('parses TAGMSG with tags and no trailing', () => {
    const msg = parseLine('@+draft/react=👋 :nick!u@h TAGMSG #chan');
    expect(msg.tags['+draft/react']).toBe('👋');
    expect(msg.command).toBe('TAGMSG');
    expect(msg.params).toEqual(['#chan']);
  });

  it('strips trailing \\r\\n', () => {
    const msg = parseLine('PING server\r\n');
    expect(msg.command).toBe('PING');
  });

  it('strips trailing \\n', () => {
    const msg = parseLine('PING server\n');
    expect(msg.command).toBe('PING');
  });

  it('middle params never start with :', () => {
    const msg = parseLine(':server 005 nick TOKEN=1 NEXT=2 :supported');
    const middles = msg.params.slice(0, -1);
    for (const p of middles) {
      expect(p.startsWith(':')).toBe(false);
    }
  });
});

describe('formatLine', () => {
  it('round-trips full message with tags and source', () => {
    const raw = '@a=b;c=d :nick!u@h PRIVMSG #chan :hello world';
    const msg = parseLine(raw);
    expect(formatLine(msg)).toBe(raw + '\r\n');
  });

  it('round-trips numeric server message', () => {
    const raw = ':server.example.com 005 nick TOKEN=1 :are supported';
    const msg = parseLine(raw);
    expect(formatLine(msg)).toBe(raw + '\r\n');
  });

  it('formats empty trailing as :( trailing colon)', () => {
    const msg = parseLine(':nick!u@h PRIVMSG #chan :');
    const formatted = formatLine(msg);
    expect(formatted).toContain(' :');
    expect(formatted.endsWith('\r\n')).toBe(true);
  });

  it('formats trailing with spaces as : prefixed', () => {
    const msg = parseLine('@a=b;c=d :nick!u@h PRIVMSG #chan :hello world');
    const formatted = formatLine(msg);
    expect(formatted).toContain(':hello world');
  });

  it('formats no-space trailing without colon prefix (as middle)', () => {
    const msg = parseLine('PING server');
    const formatted = formatLine(msg);
    // no-space trailing that does not need quoting can be emitted as middle
    expect(formatted).toContain('server');
    expect(formatted.endsWith('\r\n')).toBe(true);
  });

  it('omits @tags prefix when tags are empty', () => {
    const msg = parseLine('PING server');
    expect(formatLine(msg).startsWith('@')).toBe(false);
  });

  it('omits :source when no source', () => {
    const msg = parseLine('PING server');
    expect(formatLine(msg).startsWith(':')).toBe(false);
  });
});

describe('byteLenNoTags', () => {
  it('returns byte length excluding tag section (CRLF included)', () => {
    // 'hello world' has a space so it formats as ':hello world' (trailing param)
    const msg = parseLine('@a=b;c=d :nick!u@h PRIVMSG #chan :hello world');
    const formatted = formatLine(msg);
    const fullBytes = Buffer.byteLength(formatted, 'utf8');
    const tagSection = Buffer.byteLength('@a=b;c=d ');
    expect(byteLenNoTags(msg)).toBe(fullBytes - tagSection);
  });

  it('equals full byte length when no tags', () => {
    const msg = parseLine('PING server');
    const full = Buffer.byteLength('PING server\r\n');
    expect(byteLenNoTags(msg)).toBe(full);
  });
});

describe('withinLimits', () => {
  it('returns body:true tags:true for a normal message', () => {
    const msg = parseLine('@a=b :nick!u@h PRIVMSG #chan :hi');
    const result = withinLimits(msg);
    expect(result.body).toBe(true);
    expect(result.tags).toBe(true);
  });

  it('flags body:false when non-tag portion exceeds 512 bytes', () => {
    // build a message with a very long param
    const longParam = 'x'.repeat(520);
    const msg = parseLine(`PRIVMSG #chan :${longParam}`);
    const result = withinLimits(msg);
    expect(result.body).toBe(false);
  });

  it('flags tags:false when tag section exceeds 8191 bytes', () => {
    // build enormous tag section
    const bigValue = 'x'.repeat(8200);
    const msg = parseLine(`@key=${bigValue} PRIVMSG #chan :hi`);
    const result = withinLimits(msg);
    expect(result.tags).toBe(false);
  });
});
