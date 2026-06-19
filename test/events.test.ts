import { describe, it, expect } from 'vitest';
import { makeConnectedClient, delay } from './helpers/fakeServer';

describe('live event buffer', () => {
  it('records incoming events with target/kind filtering and a cursor', async () => {
    const { client, push } = await makeConnectedClient({
      caps: ['message-tags', 'server-time'],
      nick: 'me',
    });

    push(':alice!u@h PRIVMSG #chan :hello');
    push(':bob!u@h JOIN #chan');
    push(':alice!u@h PRIVMSG #other :hi there');
    await delay(10);

    const chanOnly = client.recentEvents({ target: '#chan' });
    expect(chanOnly.every((e) => e.target === '#chan')).toBe(true);
    expect(chanOnly.some((e) => e.kind === 'privmsg' && e.text === 'hello')).toBe(true);
    expect(chanOnly.some((e) => e.kind === 'join')).toBe(true);

    const privmsgs = client.recentEvents({ kinds: ['privmsg'] });
    expect(privmsgs.every((e) => e.kind === 'privmsg')).toBe(true);
    expect(privmsgs.length).toBeGreaterThanOrEqual(2);

    const cursor = client.lastEventSeq();
    push(':carol!u@h PRIVMSG #chan :new one');
    await delay(10);
    const since = client.recentEvents({ sinceSeq: cursor });
    expect(since).toHaveLength(1);
    expect(since[0].text).toBe('new one');
    expect(client.lastEventSeq()).toBeGreaterThan(cursor);

    client.quit();
  });

  it('does not buffer protocol noise (PING)', async () => {
    const { client, push } = await makeConnectedClient({ caps: [], nick: 'me' });
    const before = client.lastEventSeq();
    push('PING :tok');
    await delay(10);
    expect(client.recentEvents({ sinceSeq: before })).toHaveLength(0);
    client.quit();
  });
});
