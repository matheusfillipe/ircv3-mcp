import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import type { Duplex } from 'stream';
import { TlsTransport } from '../src/irc-core/transport';

function makeSocket(): PassThrough {
  const pt = new PassThrough();
  // Simulate connect immediately
  return pt;
}

function makeTransportWithSocket(): { transport: TlsTransport; socket: PassThrough } {
  const socket = makeSocket();
  const transport = new TlsTransport();
  return { transport, socket };
}

describe('TlsTransport', () => {
  it('emits two line events for a single chunk with two complete lines', async () => {
    const { transport, socket } = makeTransportWithSocket();
    const lines: string[] = [];
    transport.on('line', (l: string) => lines.push(l));

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);
    socket.push(Buffer.from('PING :server1\r\nPONG :server2\r\n'));

    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(['PING :server1', 'PONG :server2']);
  });

  it('handles bytes split across a \\r\\n boundary across two data chunks', async () => {
    const { transport, socket } = makeTransportWithSocket();
    const lines: string[] = [];
    transport.on('line', (l: string) => lines.push(l));

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);

    socket.push(Buffer.from('PING :x\r'));
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual([]); // no line yet, \r not followed by \n

    socket.push(Buffer.from('\nPONG :y\r\n'));
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(['PING :x', 'PONG :y']);
  });

  it('handles lone \\n terminator', async () => {
    const { transport, socket } = makeTransportWithSocket();
    const lines: string[] = [];
    transport.on('line', (l: string) => lines.push(l));

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);
    socket.push(Buffer.from('PING :lone\nPONG :done\n'));
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(['PING :lone', 'PONG :done']);
  });

  it('write() pushes line + CRLF to the socket', async () => {
    const { transport, socket } = makeTransportWithSocket();
    const received: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => received.push(chunk));

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);
    transport.write('PING x');
    await new Promise((r) => setImmediate(r));

    const combined = Buffer.concat(received).toString('utf8');
    expect(combined).toBe('PING x\r\n');
  });

  it('keeps partial fragment buffered until completed', async () => {
    const { transport, socket } = makeTransportWithSocket();
    const lines: string[] = [];
    transport.on('line', (l: string) => lines.push(l));

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);

    socket.push(Buffer.from('PING :partial'));
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual([]);

    socket.push(Buffer.from('\r\n'));
    await new Promise((r) => setImmediate(r));
    expect(lines).toEqual(['PING :partial']);
  });

  it('emits close when socket closes', async () => {
    const { transport, socket } = makeTransportWithSocket();
    let closed = false;
    transport.on('close', () => {
      closed = true;
    });

    await transport.connect({ host: 'localhost', port: 6667 }, () => socket as unknown as Duplex);
    socket.destroy();
    await new Promise((r) => setTimeout(r, 10));
    expect(closed).toBe(true);
  });
});
