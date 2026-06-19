import { describe, it, expect } from 'vitest';
import type { IrcMessage } from '../src/irc-core/types';
import { CapNegotiator } from '../src/irc-core/caps';

function msg(params: string[]): IrcMessage {
  return { tags: {}, source: undefined, command: 'CAP', params };
}

describe('CapNegotiator', () => {
  it('two-line LS accumulates and emits on final line', () => {
    const neg = new CapNegotiator();
    let lsResult: Map<string, string | undefined> | null = null;
    neg.on('ls', (m: Map<string, string | undefined>) => {
      lsResult = m;
    });

    neg.feed(msg(['*', 'LS', '*', 'a b']));
    expect(lsResult).toBeNull();

    neg.feed(msg(['*', 'LS', 'c=1 d']));
    expect(lsResult).not.toBeNull();
    expect(lsResult!.get('a')).toBeUndefined();
    expect(lsResult!.has('a')).toBe(true);
    expect(lsResult!.has('b')).toBe(true);
    expect(lsResult!.get('c')).toBe('1');
    expect(lsResult!.has('d')).toBe(true);
  });

  it('single LS emits immediately', () => {
    const neg = new CapNegotiator();
    let lsResult: Map<string, string | undefined> | null = null;
    neg.on('ls', (m: Map<string, string | undefined>) => {
      lsResult = m;
    });

    neg.feed(msg(['*', 'LS', 'multi-prefix sasl=PLAIN,EXTERNAL']));
    expect(lsResult).not.toBeNull();
    expect(lsResult!.has('multi-prefix')).toBe(true);
    expect(lsResult!.get('sasl')).toBe('PLAIN,EXTERNAL');
  });

  it('ACK marks caps enabled', () => {
    const neg = new CapNegotiator();
    const acked: string[] = [];
    neg.on('ack', (names: string[]) => acked.push(...names));

    neg.feed(msg(['*', 'ACK', 'multi-prefix sasl']));
    expect(neg.enabled.has('multi-prefix')).toBe(true);
    expect(neg.enabled.has('sasl')).toBe(true);
    expect(acked).toEqual(['multi-prefix', 'sasl']);
  });

  it('NAK leaves caps disabled', () => {
    const neg = new CapNegotiator();
    const naked: string[] = [];
    neg.on('nak', (names: string[]) => naked.push(...names));

    neg.feed(msg(['*', 'NAK', 'some-cap']));
    expect(neg.enabled.has('some-cap')).toBe(false);
    expect(naked).toEqual(['some-cap']);
  });

  it('NEW adds to available', () => {
    const neg = new CapNegotiator();
    const newCaps: string[] = [];
    neg.on('new', (names: string[]) => newCaps.push(...names));

    neg.feed(msg(['*', 'NEW', 'echo-message draft/read-marker=v1']));
    expect(neg.available.has('echo-message')).toBe(true);
    expect(neg.available.get('draft/read-marker')).toBe('v1');
    expect(newCaps).toEqual(['echo-message', 'draft/read-marker']);
  });

  it('DEL removes from available and enabled', () => {
    const neg = new CapNegotiator();
    const delCaps: string[] = [];
    neg.on('del', (names: string[]) => delCaps.push(...names));

    // Set up state
    neg.feed(msg(['*', 'LS', 'echo-message']));
    neg.feed(msg(['*', 'ACK', 'echo-message']));
    expect(neg.available.has('echo-message')).toBe(true);
    expect(neg.enabled.has('echo-message')).toBe(true);

    neg.feed(msg(['*', 'DEL', 'echo-message']));
    expect(neg.available.has('echo-message')).toBe(false);
    expect(neg.enabled.has('echo-message')).toBe(false);
    expect(delCaps).toEqual(['echo-message']);
  });

  it('reqLine returns correct string', () => {
    const line = CapNegotiator.reqLine(['multi-prefix', 'sasl', 'echo-message']);
    expect(line).toBe('CAP REQ :multi-prefix sasl echo-message');
  });
});
