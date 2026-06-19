import { describe, it, expect } from 'vitest';
import { makeFakeSocket, delay } from './helpers/fakeServer';
import { IrcClient } from '../src/irc-core/client';

/**
 * Creates a connected client that has ISUPPORT CHATHISTORY=3, so each
 * CHATHISTORY request returns at most 3 messages.  The client is set up with
 * batch + draft/chathistory caps negotiated.
 */
async function makeHistoryClient(): Promise<{
  client: IrcClient;
  push: (line: string) => void;
  clientWrites: () => string[];
}> {
  const { socket, push, clientWrites } = makeFakeSocket();

  const client = new IrcClient({
    host: 'irc.example.com',
    port: 6697,
    nick: 'testbot',
    sasl: null,
    desiredCaps: ['batch', 'draft/chathistory'],
    socketFactory: () => socket as unknown as import('stream').Duplex,
  });

  const connectPromise = client.connect();
  await delay(5);

  push(':srv CAP * LS :batch draft/chathistory');
  await delay(5);
  push(':srv CAP * ACK :batch draft/chathistory');
  await delay(5);
  // Announce CHATHISTORY=3 so each page is at most 3 messages
  push(':srv 005 testbot CHATHISTORY=3 :are supported by this server');
  await delay(5);
  push(':srv 001 testbot :Welcome');
  await connectPromise;

  return { client, push, clientWrites };
}

function makeHistoryMsg(
  target: string,
  msgid: string,
  time: string,
  text: string,
  batchRef: string,
): string {
  return `@batch=${batchRef};msgid=${msgid};time=${time} :alice!a@h PRIVMSG ${target} :${text}`;
}

describe('readHistory pagination', () => {
  it('second page uses CHATHISTORY BEFORE, not LATEST', async () => {
    const { client, clientWrites, push } = await makeHistoryClient();

    // Request 6 messages; server has CHATHISTORY=3 so each page yields at most 3
    const historyPromise = client.readHistory({
      target: '#chan',
      mode: 'latest',
      selector: { type: 'star' },
      limit: 6,
    });

    await delay(5);

    // First page: exactly 3 messages (= pageLimit, so pagination should continue)
    push(':srv BATCH +b1 chathistory #chan');
    push(makeHistoryMsg('#chan', 'msg-001', '2024-01-01T10:00:00.000Z', 'msg1', 'b1'));
    push(makeHistoryMsg('#chan', 'msg-002', '2024-01-01T10:00:01.000Z', 'msg2', 'b1'));
    push(makeHistoryMsg('#chan', 'msg-003', '2024-01-01T10:00:02.000Z', 'msg3', 'b1'));
    push(':srv BATCH -b1');

    // Wait for client to process first page and send second CHATHISTORY request
    await delay(20);

    // Second page: empty — signals end of history
    push(':srv BATCH +b2 chathistory #chan');
    push(':srv BATCH -b2');

    await delay(10);
    await historyPromise;

    const chathistoryWrites = clientWrites().filter((l) => l.startsWith('CHATHISTORY'));
    expect(chathistoryWrites.length).toBeGreaterThanOrEqual(2);
    expect(chathistoryWrites[0]).toMatch(/^CHATHISTORY LATEST/);
    // The second request must be BEFORE (not LATEST) targeting the oldest msgid
    expect(chathistoryWrites[1]).toMatch(/^CHATHISTORY BEFORE/);
    // After sorting ascending by time, msg-001 is oldest
    expect(chathistoryWrites[1]).toContain('msgid=msg-001');
  });
});

describe('chathistory batch target case-insensitive match', () => {
  it('resolves readHistory when batch target differs only in case', async () => {
    const { client, push } = await makeHistoryClient();

    const historyPromise = client.readHistory({
      target: '#Chan',
      mode: 'latest',
      selector: { type: 'star' },
      limit: 3,
    });

    await delay(5);

    // Server responds with lowercased target in batch params
    push(':srv BATCH +bcase chathistory #chan');
    push('@batch=bcase;msgid=msg-a;time=2024-01-01T10:00:00.000Z :alice!a@h PRIVMSG #chan :hello');
    push(':srv BATCH -bcase');

    await delay(10);

    const msgs = await historyPromise;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].msgid).toBe('msg-a');
  });
});
