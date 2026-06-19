import { describe, it, expect, vi } from 'vitest';
import { LabelMap } from '../src/irc-core/labels';
import type { IrcMessage } from '../src/irc-core/types';

function msg(command: string): IrcMessage {
  return { tags: {}, command, params: [] };
}

describe('LabelMap', () => {
  it('next() returns incrementing string tokens', () => {
    const lm = new LabelMap();
    expect(lm.next()).toBe('1');
    expect(lm.next()).toBe('2');
    expect(lm.next()).toBe('3');
  });

  it('track → resolve returns messages', async () => {
    const lm = new LabelMap();
    const label = lm.next();
    const promise = lm.track(label, 1000);
    const msgs = [msg('PRIVMSG')];
    lm.resolve(label, msgs);
    await expect(promise).resolves.toBe(msgs);
  });

  it('track → reject rejects with error', async () => {
    const lm = new LabelMap();
    const label = lm.next();
    const promise = lm.track(label, 1000);
    const err = new Error('SASL failed');
    lm.reject(label, err);
    await expect(promise).rejects.toThrow('SASL failed');
  });

  it('times out and rejects after timeoutMs', async () => {
    vi.useFakeTimers();
    const lm = new LabelMap();
    const label = lm.next();
    const promise = lm.track(label, 500);
    vi.advanceTimersByTime(501);
    await expect(promise).rejects.toThrow('timed out');
    vi.useRealTimers();
  });

  it('has() returns true while pending, false after resolve', () => {
    const lm = new LabelMap();
    const label = lm.next();
    lm.track(label, 1000);
    expect(lm.has(label)).toBe(true);
    lm.resolve(label, []);
    expect(lm.has(label)).toBe(false);
  });

  it('resolve clears the timer so no spurious rejection fires', async () => {
    vi.useFakeTimers();
    const lm = new LabelMap();
    const label = lm.next();
    const promise = lm.track(label, 100);
    lm.resolve(label, []);
    await promise;
    // Advancing past original timeout should not throw
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });
});
