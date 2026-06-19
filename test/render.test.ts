import { describe, it, expect } from 'vitest';
import { renderTranscript } from '../src/mcp/render';
import type { HistoryMessage, ReactionIndex } from '../src/irc-core/types';

const noReactions: ReactionIndex = new Map();

function msg(
  overrides: Partial<HistoryMessage> & { kind?: HistoryMessage['kind'] },
): HistoryMessage {
  return {
    target: '#test',
    kind: 'privmsg',
    ...overrides,
  };
}

describe('renderTranscript', () => {
  it('renders a single PRIVMSG with time, nick, and msgid', () => {
    const messages = [
      msg({ time: '2026-06-19T12:00:01.000Z', nick: 'alice', text: 'hello', msgid: 'm1' }),
    ];
    const result = renderTranscript(messages, noReactions);
    expect(result).toBe('`12:00:01` **alice**: hello · id:m1');
  });

  it('shows account tag in header', () => {
    const messages = [
      msg({
        time: '2026-06-19T12:00:01.000Z',
        nick: 'alice',
        account: 'alice_acct',
        text: 'hi',
        msgid: 'm2',
      }),
    ];
    const result = renderTranscript(messages, noReactions);
    expect(result).toBe('`12:00:01` **alice** (alice_acct): hi · id:m2');
  });

  it('renders NOTICE with (notice) tag', () => {
    const messages = [
      msg({
        time: '2026-06-19T12:00:02.000Z',
        nick: 'server',
        kind: 'notice',
        text: 'welcome',
        msgid: 'm3',
      }),
    ];
    const result = renderTranscript(messages, noReactions);
    expect(result).toBe('`12:00:02` **server** (notice): welcome · id:m3');
  });

  it('renders multiline message with header then 4-space-indented lines', () => {
    const messages = [
      msg({
        time: '2026-06-19T12:00:03.000Z',
        nick: 'bob',
        text: 'line1\nline2\nline3',
        lines: ['line1', 'line2', 'line3'],
        msgid: 'm4',
      }),
    ];
    const result = renderTranscript(messages, noReactions);
    expect(result).toBe('`12:00:03` **bob**:\n    line1\n    line2\n    line3 · id:m4');
  });

  it('renders reply with ↳ quote line before the message', () => {
    const parent = msg({
      time: '2026-06-19T12:00:00.000Z',
      nick: 'alice',
      text: 'original message here',
      msgid: 'parent1',
    });
    const reply = msg({
      time: '2026-06-19T12:00:05.000Z',
      nick: 'bob',
      text: 'I agree',
      msgid: 'reply1',
      replyTo: 'parent1',
    });
    const result = renderTranscript([parent, reply], noReactions);
    const lines = result.split('\n');
    expect(lines[1]).toBe('    ↳ replying to alice: "original message here"');
    expect(lines[2]).toBe('`12:00:05` **bob**: I agree · id:reply1');
  });

  it('truncates reply snippet to 60 chars', () => {
    const longText = 'a'.repeat(80);
    const parent = msg({ nick: 'alice', text: longText, msgid: 'p2' });
    const reply = msg({ nick: 'bob', text: 'ok', msgid: 'r2', replyTo: 'p2' });
    const result = renderTranscript([parent, reply], noReactions);
    expect(result).toContain(`"${'a'.repeat(60)}"`);
    expect(result).not.toContain(`"${'a'.repeat(61)}`);
  });

  it('renders reactions under a message', () => {
    const m = msg({ time: '2026-06-19T12:00:06.000Z', nick: 'alice', text: 'hi', msgid: 'm5' });
    const reactions: ReactionIndex = new Map([
      [
        'm5',
        [
          { emoji: '👋', by: ['bob', 'carol'], count: 2 },
          { emoji: '🎉', by: ['dave'], count: 1 },
        ],
      ],
    ]);
    const result = renderTranscript([m], reactions);
    const lines = result.split('\n');
    expect(lines[0]).toBe('`12:00:06` **alice**: hi · id:m5');
    expect(lines[1]).toBe('    ↳ 👋 ×2 (bob, carol)');
    expect(lines[2]).toBe('    ↳ 🎉 ×1 (dave)');
  });

  it('renders redacted message as ~~[redacted]~~', () => {
    const m = msg({ nick: 'alice', text: 'secret content', redacted: true, msgid: 'm6' });
    const result = renderTranscript([m], noReactions);
    expect(result).toBe('**alice**: ~~[redacted]~~ · id:m6');
  });

  it('skips tagmsg with no text', () => {
    const messages = [
      msg({ nick: 'alice', text: 'hello', msgid: 'm7' }),
      { target: '#test', kind: 'tagmsg' as const, nick: 'bob', msgid: 'carrier1' },
      msg({ nick: 'carol', text: 'world', msgid: 'm8' }),
    ];
    const result = renderTranscript(messages, noReactions);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(result).toContain('alice');
    expect(result).not.toContain('bob');
    expect(result).toContain('carol');
  });

  it('omits id suffix when showMsgid is false', () => {
    const messages = [msg({ nick: 'alice', text: 'hello', msgid: 'm9' })];
    const result = renderTranscript(messages, noReactions, { showMsgid: false });
    expect(result).toBe('**alice**: hello');
    expect(result).not.toContain('id:');
  });

  it('omits time backticks when time is absent', () => {
    const messages = [msg({ nick: 'alice', text: 'hello', msgid: 'm10' })];
    const result = renderTranscript(messages, noReactions);
    expect(result).toBe('**alice**: hello · id:m10');
    expect(result).not.toContain('`');
  });

  it('handles reply to unknown parent', () => {
    const reply = msg({ nick: 'bob', text: 'ok', msgid: 'r3', replyTo: 'nonexistent' });
    const result = renderTranscript([reply], noReactions);
    expect(result).toContain('↳ replying to <unknown>');
    expect(result).not.toContain('"');
  });

  it('collapses newlines in reply snippet', () => {
    const parent = msg({ nick: 'alice', text: 'line1\nline2', msgid: 'p3' });
    const reply = msg({ nick: 'bob', text: 'noted', msgid: 'r4', replyTo: 'p3' });
    const result = renderTranscript([parent, reply], noReactions);
    expect(result).toContain('"line1 line2"');
  });

  it('separates multiple messages with single newlines', () => {
    const messages = [
      msg({ nick: 'alice', text: 'first', msgid: 'a1' }),
      msg({ nick: 'bob', text: 'second', msgid: 'b1' }),
      msg({ nick: 'carol', text: 'third', msgid: 'c1' }),
    ];
    const result = renderTranscript(messages, noReactions);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('returns empty string for empty message array', () => {
    expect(renderTranscript([], noReactions)).toBe('');
  });
});
