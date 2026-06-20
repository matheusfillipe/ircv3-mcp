import { describe, it, expect, vi } from 'vitest';
import { typingDurationMs, TYPING_REFRESH_MS } from '../src/irc-core/client';
import { makeConnectedClient, delay } from './helpers/fakeServer';

describe('typingDurationMs', () => {
  it('scales with text length at the default 90 wpm', () => {
    const short = typingDurationMs(20);
    const long = typingDurationMs(200);
    expect(long).toBeGreaterThan(short);
    expect(typingDurationMs(75)).toBe(10000);
  });

  it('clamps below minMs and above maxMs', () => {
    expect(typingDurationMs(1, { minMs: 500, maxMs: 8000 })).toBe(500);
    expect(typingDurationMs(100000, { minMs: 500, maxMs: 8000 })).toBe(8000);
  });

  it('keeps maxMs as a hard cap even when minMs exceeds it', () => {
    expect(typingDurationMs(1, { minMs: 20000, maxMs: 15000 })).toBe(15000);
  });

  it('honours a custom wpm', () => {
    const fast = typingDurationMs(100, { wpm: 600, minMs: 0, maxMs: 60000 });
    const slow = typingDurationMs(100, { wpm: 30, minMs: 0, maxMs: 60000 });
    expect(slow).toBeGreaterThan(fast);
  });
});

describe('sendTyping', () => {
  it('emits a TAGMSG with +typing=active by default', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    client.sendTyping('#chan');
    await delay(5);

    const line = clientWrites().find((l) => l.includes('TAGMSG'));
    expect(line).toBeDefined();
    expect(line).toContain('+typing=active');
    expect(line).toContain('TAGMSG #chan');
  });

  it('emits +typing=done for the done state', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    client.sendTyping('#chan', 'done');
    await delay(5);

    const line = clientWrites().find((l) => l.includes('TAGMSG'));
    expect(line).toContain('+typing=done');
  });
});

describe('sendWithTyping', () => {
  it('sends an active notification before the message', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    vi.useFakeTimers();
    try {
      const sent = client.sendWithTyping({ target: '#chan', lines: ['hi'], wpm: 90 });
      await vi.advanceTimersByTimeAsync(typingDurationMs(2, { wpm: 90 }));
      const result = await sent;
      expect(result.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    const writes = clientWrites();
    const typingIdx = writes.findIndex((l) => l.includes('+typing=active'));
    const msgIdx = writes.findIndex((l) => l.includes('PRIVMSG #chan'));
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(msgIdx).toBeGreaterThan(typingIdx);
  });

  it('refreshes active no sooner than the 3s throttle, then sends', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    const text = 'x'.repeat(60);
    const duration = typingDurationMs(text.length, { wpm: 90 });
    const expectedActive = 1 + Math.floor((duration - 1) / TYPING_REFRESH_MS);

    vi.useFakeTimers();
    try {
      const sent = client.sendWithTyping({ target: '#chan', lines: [text], wpm: 90 });
      await vi.advanceTimersByTimeAsync(duration);
      await sent;
    } finally {
      vi.useRealTimers();
    }

    const writes = clientWrites();
    const activeCount = writes.filter((l) => l.includes('+typing=active')).length;
    expect(activeCount).toBe(expectedActive);
    expect(activeCount).toBeGreaterThanOrEqual(2);
    expect(writes[writes.length - 1]).toContain('PRIVMSG #chan');
  });
});
