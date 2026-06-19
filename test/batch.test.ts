import { describe, it, expect } from 'vitest';
import { BatchTracker, assembleMultiline } from '../src/irc-core/batch';
import type { IrcMessage } from '../src/irc-core/types';

function msg(command: string, params: string[], tags: Record<string, string> = {}): IrcMessage {
  return { tags, command, params };
}

describe('BatchTracker', () => {
  it('open / isOpen / close round-trip', () => {
    const bt = new BatchTracker();
    bt.open('ref1', 'chathistory', ['#channel'], {});
    expect(bt.isOpen('ref1')).toBe(true);
    const result = bt.close('ref1');
    expect(result).toBeDefined();
    expect(result!.type).toBe('chathistory');
    expect(result!.params).toEqual(['#channel']);
    expect(bt.isOpen('ref1')).toBe(false);
  });

  it('add() returns true for matching batch tag and appends message', () => {
    const bt = new BatchTracker();
    bt.open('r1', 'chathistory', ['#chan'], {});
    const m = msg('PRIVMSG', ['#chan', 'hello'], { batch: 'r1' });
    expect(bt.add(m)).toBe(true);
    const result = bt.close('r1')!;
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toBe(m);
  });

  it('add() returns false for unknown batch ref', () => {
    const bt = new BatchTracker();
    const m = msg('PRIVMSG', ['#chan', 'hello'], { batch: 'unknown' });
    expect(bt.add(m)).toBe(false);
  });

  it('add() returns false for message without batch tag', () => {
    const bt = new BatchTracker();
    bt.open('r1', 'chathistory', ['#chan'], {});
    const m = msg('PRIVMSG', ['#chan', 'hello']);
    expect(bt.add(m)).toBe(false);
  });

  it('close() returns undefined for unknown ref', () => {
    const bt = new BatchTracker();
    expect(bt.close('nope')).toBeUndefined();
  });

  it('preserves insertion order for chathistory batch', () => {
    const bt = new BatchTracker();
    bt.open('hist', 'chathistory', ['#chan'], {});
    const m1 = msg('PRIVMSG', ['#chan', 'first'], { batch: 'hist' });
    const m2 = msg('PRIVMSG', ['#chan', 'second'], { batch: 'hist' });
    const m3 = msg('PRIVMSG', ['#chan', 'third'], { batch: 'hist' });
    bt.add(m1);
    bt.add(m2);
    bt.add(m3);
    const result = bt.close('hist')!;
    expect(result.messages.map((m) => m.params[1])).toEqual(['first', 'second', 'third']);
  });

  it('handles nested batch ref (inner BATCH open carries a batch tag)', () => {
    const bt = new BatchTracker();
    // Outer batch opened normally
    bt.open('outer', 'chathistory', ['#chan'], {});
    // Inner BATCH START line carries batch=outer, making it a child of outer
    const innerStart = msg('BATCH', ['+inner', 'multiline', '#chan'], { batch: 'outer' });
    // add inner start to outer; client code also calls open for inner
    bt.add(innerStart);
    bt.open('inner', 'multiline', ['#chan'], { batch: 'outer' });
    // messages go to inner
    const child = msg('PRIVMSG', ['#chan', 'line1'], { batch: 'inner' });
    bt.add(child);
    // close inner — pops it
    const innerResult = bt.close('inner')!;
    expect(innerResult.messages).toHaveLength(1);
    // outer still open and holds the BATCH START line
    const outerResult = bt.close('outer')!;
    expect(outerResult.messages).toContain(innerStart);
  });
});

describe('assembleMultiline', () => {
  it('joins lines with newline by default', () => {
    const batch = {
      params: ['#chan'],
      messages: [
        msg('PRIVMSG', ['#chan', 'line one'], { batch: 'r1' }),
        msg('PRIVMSG', ['#chan', 'line two'], { batch: 'r1' }),
      ],
    };
    const result = assembleMultiline(batch);
    expect(result.target).toBe('#chan');
    expect(result.text).toBe('line one\nline two');
    expect(result.lines).toEqual(['line one', 'line two']);
  });

  it('concat tag joins to previous with no separator', () => {
    const batch = {
      params: ['#chan'],
      messages: [
        msg('PRIVMSG', ['#chan', 'hello '], { batch: 'r1' }),
        msg('PRIVMSG', ['#chan', 'world'], { batch: 'r1', 'draft/multiline-concat': '' }),
      ],
    };
    const result = assembleMultiline(batch);
    expect(result.text).toBe('hello world');
    expect(result.lines).toEqual(['hello world']);
  });

  it('mixed concat and newline', () => {
    const batch = {
      params: ['#chan'],
      messages: [
        msg('PRIVMSG', ['#chan', 'a'], { batch: 'r1' }),
        msg('PRIVMSG', ['#chan', 'b'], { batch: 'r1', 'draft/multiline-concat': '' }),
        msg('PRIVMSG', ['#chan', 'c'], { batch: 'r1' }),
      ],
    };
    const result = assembleMultiline(batch);
    expect(result.text).toBe('ab\nc');
    expect(result.lines).toEqual(['ab', 'c']);
  });

  it('ignores non-PRIVMSG/NOTICE messages', () => {
    const batch = {
      params: ['#chan'],
      messages: [
        msg('PRIVMSG', ['#chan', 'hello'], { batch: 'r1' }),
        msg('TAGMSG', ['#chan'], { batch: 'r1' }),
        msg('NOTICE', ['#chan', 'world'], { batch: 'r1' }),
      ],
    };
    const result = assembleMultiline(batch);
    expect(result.lines).toEqual(['hello', 'world']);
  });
});
