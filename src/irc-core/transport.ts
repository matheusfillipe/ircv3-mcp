import { EventEmitter } from 'events';
import type { Duplex } from 'stream';
import * as net from 'net';
import * as tls from 'tls';

export interface ConnectOpts {
  host: string;
  port: number;
  tls?: boolean;
  rejectUnauthorized?: boolean;
}

export class TlsTransport extends EventEmitter {
  private socket: Duplex | null = null;
  private buf = '';

  connect(opts: ConnectOpts, socketFactory?: (opts: ConnectOpts) => Duplex): Promise<void> {
    const { host, port, tls: useTls = true, rejectUnauthorized = true } = opts;

    return new Promise((resolve, reject) => {
      let sock: Duplex;

      if (socketFactory) {
        sock = socketFactory(opts);
        this.attachSocket(sock);
        // socketFactory sockets are immediately "connected"
        resolve();
        return;
      }

      if (useTls) {
        const tlsSock = tls.connect({ host, port, servername: host, rejectUnauthorized });
        sock = tlsSock as unknown as Duplex;
        const onConnect = () => {
          cleanup();
          this.attachSocket(sock);
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          tlsSock.off('secureConnect', onConnect);
          tlsSock.off('error', onError);
        };
        tlsSock.once('secureConnect', onConnect);
        tlsSock.once('error', onError);
      } else {
        const netSock = net.connect({ host, port });
        sock = netSock as unknown as Duplex;
        const onConnect = () => {
          cleanup();
          this.attachSocket(sock);
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          netSock.off('connect', onConnect);
          netSock.off('error', onError);
        };
        netSock.once('connect', onConnect);
        netSock.once('error', onError);
      }
    });
  }

  private attachSocket(sock: Duplex): void {
    this.socket = sock;

    sock.on('data', (chunk: Buffer | string) => {
      this.buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      this.drainLines();
    });

    sock.on('close', () => {
      this.emit('close');
    });

    sock.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  private drainLines(): void {
    let pos: number;
    while ((pos = this.findLineEnd()) !== -1) {
      let line = this.buf.slice(0, pos);
      const after = this.buf[pos] === '\r' ? pos + 2 : pos + 1;
      this.buf = this.buf.slice(after);
      // Strip trailing \r if present (handles \r\n split where \r landed at end of line)
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.emit('line', line);
    }
  }

  private findLineEnd(): number {
    for (let i = 0; i < this.buf.length; i++) {
      if (this.buf[i] === '\n') return i > 0 && this.buf[i - 1] === '\r' ? i - 1 : i;
    }
    return -1;
  }

  write(line: string): void {
    this.socket?.write(line + '\r\n', 'utf8');
  }

  close(): void {
    this.socket?.end();
  }
}
