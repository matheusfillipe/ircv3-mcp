import { Duplex } from 'stream';
import { IrcClient } from '../../src/irc-core/client';

export interface FakeServer {
  socket: Duplex;
  /** Send a line from the server to the client. */
  push: (line: string) => void;
  /** All lines written by the client (excluding \r\n). */
  clientWrites: () => string[];
  client: IrcClient;
}

export function makeFakeSocket(): {
  socket: Duplex;
  push: (line: string) => void;
  clientWrites: () => string[];
} {
  const writes: string[] = [];

  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      const str = typeof chunk === 'string' ? chunk : (chunk as Buffer).toString('utf8');
      for (const l of str.split('\r\n')) {
        if (l.length > 0) writes.push(l);
      }
      callback();
    },
  });

  return {
    socket,
    push: (line: string) => socket.push(line + '\r\n'),
    clientWrites: () => writes,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Bootstrap a connected IrcClient using a fake socket.
 * Completes the minimal CAP+001 handshake and resolves once the client
 * reports `connected = true`.
 */
export async function makeConnectedClient(opts?: {
  caps?: string[];
  nick?: string;
}): Promise<FakeServer> {
  const caps = opts?.caps ?? [];
  const nick = opts?.nick ?? 'testbot';
  const { socket, push, clientWrites } = makeFakeSocket();

  const client = new IrcClient({
    host: 'irc.example.com',
    port: 6697,
    nick,
    sasl: null,
    desiredCaps: caps,
    socketFactory: () => socket as unknown as import('stream').Duplex,
  });

  const connectPromise = client.connect();
  await delay(5);

  const capsStr = caps.length > 0 ? caps.join(' ') : '';
  push(`:srv CAP * LS :${capsStr}`);
  await delay(5);

  if (caps.length > 0) {
    push(`:srv CAP * ACK :${capsStr}`);
    await delay(5);
  }

  push(`:srv 001 ${nick} :Welcome`);
  await connectPromise;

  return { socket, push, clientWrites, client };
}
