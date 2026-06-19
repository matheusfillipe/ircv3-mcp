import { EventEmitter } from 'events';
import type { IrcMessage } from './types';

function parseCapList(raw: string): Array<[string, string | undefined]> {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const eq = token.indexOf('=');
      if (eq === -1) return [token, undefined];
      return [token.slice(0, eq), token.slice(eq + 1)];
    });
}

export class CapNegotiator extends EventEmitter {
  available: Map<string, string | undefined> = new Map();
  enabled: Set<string> = new Set();

  private lsAccum: Array<[string, string | undefined]> = [];

  feed(msg: IrcMessage): void {
    // params[0]: target (* or nick), params[1]: subcommand
    // for LS multiline: params[2] may be '*', params[last] is cap list (possibly with leading ':' stripped by parser)
    const sub = msg.params[1]?.toUpperCase();
    const rest = msg.params.slice(2);

    // Determine if there's a '*' multiline indicator and extract cap string
    let isMulti = false;
    let capStr = '';
    if (rest[0] === '*') {
      isMulti = true;
      capStr = rest.slice(1).join(' ');
    } else {
      capStr = rest.join(' ');
    }

    switch (sub) {
      case 'LS': {
        const caps = parseCapList(capStr);
        this.lsAccum.push(...caps);
        if (!isMulti) {
          for (const [name, val] of this.lsAccum) {
            this.available.set(name, val);
          }
          this.lsAccum = [];
          this.emit('ls', this.available);
        }
        break;
      }
      case 'ACK': {
        const names = parseCapList(capStr).map(([n]) => n);
        for (const n of names) this.enabled.add(n);
        this.emit('ack', names);
        break;
      }
      case 'NAK': {
        const names = parseCapList(capStr).map(([n]) => n);
        this.emit('nak', names);
        break;
      }
      case 'NEW': {
        const caps = parseCapList(capStr);
        for (const [name, val] of caps) this.available.set(name, val);
        this.emit(
          'new',
          caps.map(([n]) => n),
        );
        break;
      }
      case 'DEL': {
        const names = parseCapList(capStr).map(([n]) => n);
        for (const n of names) {
          this.available.delete(n);
          this.enabled.delete(n);
        }
        this.emit('del', names);
        break;
      }
    }
  }

  static reqLine(names: string[]): string {
    return `CAP REQ :${names.join(' ')}`;
  }

  reqLine(names: string[]): string {
    return CapNegotiator.reqLine(names);
  }
}
