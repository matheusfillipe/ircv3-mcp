import { describe, it, expect } from 'vitest';
import { Duplex } from 'stream';
import { IrcClient } from '../src/irc-core/client';
import { plainResponse } from '../src/irc-core/sasl/plain';

/**
 * Creates a fake socket pair for testing.
 * - Client writes go to `clientWrites`.
 * - `push(line)` sends a server→client line.
 */
function makeFakeSocket(): {
  socket: Duplex;
  push: (line: string) => void;
  clientWrites: () => string[];
} {
  const clientWrites: string[] = [];

  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const str = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      for (const l of str.split('\r\n')) {
        if (l.length > 0) clientWrites.push(l);
      }
      callback();
    },
  });

  return {
    socket,
    push: (line: string) => socket.push(line + '\r\n'),
    clientWrites: () => clientWrites,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('IrcClient handshake', () => {
  it('sends CAP LS 302, NICK, USER on connect', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(10);

    expect(clientWrites()).toContain('CAP LS 302');
    expect(clientWrites()).toContain('NICK testbot');
    expect(clientWrites().some((l) => l.startsWith('USER testbot'))).toBe(true);

    // Feed server lines to resolve
    push(':srv CAP * LS :');
    await delay(5);
    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;
  });

  it('sends CAP REQ after CAP LS with matching caps', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: ['message-tags', 'server-time', 'batch', 'labeled-response'],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    // Server advertises a subset
    push(':srv CAP * LS :message-tags server-time batch labeled-response');
    await delay(10);

    const reqLine = clientWrites().find((l) => l.startsWith('CAP REQ'));
    expect(reqLine).toBeDefined();
    expect(reqLine).toContain('message-tags');
    expect(reqLine).toContain('server-time');

    // ACK → no sasl → CAP END
    push(':srv CAP * ACK :message-tags server-time batch labeled-response');
    await delay(10);
    expect(clientWrites()).toContain('CAP END');

    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;
  });

  it('full SASL PLAIN handshake', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: { mech: 'PLAIN', account: 'testuser', password: 'secret' },
      desiredCaps: [
        'sasl',
        'message-tags',
        'batch',
        'labeled-response',
        'echo-message',
        'server-time',
      ],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :sasl=PLAIN message-tags server-time batch labeled-response echo-message');
    await delay(10);

    push(':srv CAP * ACK :sasl message-tags server-time batch labeled-response echo-message');
    await delay(10);

    expect(clientWrites()).toContain('AUTHENTICATE PLAIN');

    // Server sends empty challenge
    push('AUTHENTICATE +');
    await delay(10);

    const expected = plainResponse('testuser', 'secret', 'testuser');
    expect(clientWrites()).toContain(`AUTHENTICATE ${expected}`);

    // SASL success
    push(':srv 903 testbot :SASL authentication successful');
    await delay(10);
    expect(clientWrites()).toContain('CAP END');

    // 001 resolves
    push(':srv 001 testbot :Welcome\r\n');
    push(':srv 005 testbot NETWORK=TestNet :are supported by this server');
    await connectPromise;
    expect(client.connected).toBe(true);
  });

  it('SASL 904 rejects connect()', async () => {
    const { socket, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: { mech: 'PLAIN', account: 'baduser', password: 'wrong' },
      desiredCaps: ['sasl'],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    // Attach a rejection handler immediately so Node doesn't see an unhandled rejection
    const caught = connectPromise.catch((e: unknown) => e);

    await delay(5);

    push(':srv CAP * LS :sasl=PLAIN');
    await delay(5);
    push(':srv CAP * ACK :sasl');
    await delay(5);
    push('AUTHENTICATE +');
    await delay(5);
    push(':srv 904 testbot :SASL authentication failed');
    await delay(5);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('904');
  });

  it('no SASL: sends CAP END right after ACK', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: ['message-tags'],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :message-tags');
    await delay(5);
    push(':srv CAP * ACK :message-tags');
    await delay(5);

    expect(clientWrites()).toContain('CAP END');

    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;
  });

  it('PING → PONG', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: [],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    // With empty desiredCaps, CAP REQ won't be sent and negotiator fires on LS
    push(':srv CAP * LS :');
    await delay(5);
    expect(clientWrites()).toContain('CAP END');

    push('PING :pingtoken');
    await delay(5);
    expect(clientWrites()).toContain('PONG :pingtoken');

    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;
  });

  it('005 populates isupport', async () => {
    const { socket, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: [],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :');
    await delay(5);
    push(
      ':srv 005 testbot NETWORK=TestNet CHANMODES=b,k,l,m PREFIX=(ov)@+ CHANTYPES=# :are supported',
    );
    await delay(5);
    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;

    expect(client.isupport.network).toBe('TestNet');
    expect(client.isupport.chantypes).toBe('#');
    expect(client.isupport.prefix).toEqual([
      { mode: 'o', symbol: '@' },
      { mode: 'v', symbol: '+' },
    ]);
  });

  it('MODE +B sent when 005 has BOT=B', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: [],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :');
    await delay(5);
    // 005 arrives before 001
    push(':srv 005 testbot BOT=B :are supported');
    await delay(5);
    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;

    expect(clientWrites()).toContain('MODE testbot +B');
  });

  it('request() resolves from a labeled single reply', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: ['labeled-response'],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :labeled-response');
    await delay(5);
    push(':srv CAP * ACK :labeled-response');
    await delay(5);
    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;

    // Now send a labeled request
    const promise = client.request('WHOIS', ['othernick'], { timeoutMs: 2000 });
    await delay(5);

    // Find the label from the outgoing WHOIS line
    const whoisLine = clientWrites().find((l) => l.includes('WHOIS'));
    expect(whoisLine).toBeDefined();
    const labelMatch = whoisLine!.match(/@[^;]*label=([^;\s]+)/);
    expect(labelMatch).toBeDefined();
    const label = labelMatch![1];

    // Server sends back a labeled reply
    push(`@label=${label} :srv 311 testbot othernick user host * :Real Name`);
    await delay(5);

    const msgs = await promise;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].command).toBe('311');
  });

  it('request() resolves from a labeled-response batch close', async () => {
    const { socket, clientWrites, push } = makeFakeSocket();
    const client = new IrcClient({
      host: 'irc.example.com',
      port: 6697,
      nick: 'testbot',
      sasl: null,
      desiredCaps: ['labeled-response', 'batch'],
      socketFactory: () => socket as unknown as import('stream').Duplex,
    });

    const connectPromise = client.connect();
    await delay(5);

    push(':srv CAP * LS :labeled-response batch');
    await delay(5);
    push(':srv CAP * ACK :labeled-response batch');
    await delay(5);
    push(':srv 001 testbot :Welcome\r\n');
    await connectPromise;

    const promise = client.request('WHOIS', ['someone'], { timeoutMs: 2000 });
    await delay(5);

    const whoisLine = clientWrites().find((l) => l.includes('WHOIS'));
    const labelMatch = whoisLine!.match(/@[^;]*label=([^;\s]+)/);
    const label = labelMatch![1];

    // Server opens a labeled-response batch that carries the label tag
    push(`@label=${label} :srv BATCH +bref labeled-response`);
    await delay(5);
    push('@batch=bref :srv 311 testbot someone user host * :Real Name');
    await delay(5);
    push(':srv BATCH -bref');
    await delay(5);

    const msgs = await promise;
    expect(msgs.length).toBeGreaterThan(0);
  });
});
