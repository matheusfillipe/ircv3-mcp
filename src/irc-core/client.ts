import { EventEmitter } from 'events';
import { TlsTransport } from './transport';
import { parseLine, formatLine } from './parser';
import { CapNegotiator } from './caps';
import { parseIsupport } from './isupport';
import { BatchTracker } from './batch';
import { LabelMap } from './labels';
import { plainResponse } from './sasl/plain';
import { externalResponse } from './sasl/external';
import { chunkAuthenticate } from './sasl/chunk';
import { ScramSha256 } from './sasl/scram';
import type { IrcMessage, Isupport, SaslMech, Tags } from './types';

export interface IrcClientOptions {
  host: string;
  port: number;
  tls?: boolean;
  rejectUnauthorized?: boolean;
  nick: string;
  username?: string;
  realname?: string;
  sasl?: { mech: SaslMech; account: string; password: string } | null;
  channels?: string[];
  desiredCaps?: string[];
  socketFactory?: Parameters<TlsTransport['connect']>[1];
}

const DEFAULT_DESIRED_CAPS = [
  'message-tags',
  'server-time',
  'account-tag',
  'account-notify',
  'away-notify',
  'extended-join',
  'chghost',
  'setname',
  'multi-prefix',
  'userhost-in-names',
  'echo-message',
  'batch',
  'labeled-response',
  'sasl',
  'standard-replies',
  'draft/chathistory',
  'draft/multiline',
  'draft/message-redaction',
  'draft/react',
  'draft/read-marker',
  'draft/event-playback',
];

export class IrcClient extends EventEmitter {
  nick: string;
  isupport: Isupport;
  enabledCaps: Set<string>;
  connected: boolean;

  private opts: IrcClientOptions;
  private transport: TlsTransport;
  private caps: CapNegotiator;
  private batches: BatchTracker;
  private labels: LabelMap;

  /** Pending SCRAM instance kept across AUTHENTICATE challenge/response. */
  private scram: ScramSha256 | null = null;

  constructor(opts: IrcClientOptions) {
    super();
    this.opts = opts;
    this.nick = opts.nick;
    this.connected = false;
    this.enabledCaps = new Set();
    this.transport = new TlsTransport();
    this.caps = new CapNegotiator();
    this.batches = new BatchTracker();
    this.labels = new LabelMap();
    this.isupport = {
      prefix: [],
      chanmodes: { a: '', b: '', c: '', d: '' },
      chantypes: '#',
      casemapping: 'rfc1459',
      msgreftypes: [],
      raw: {},
    };
  }

  connect(): Promise<void> {
    const { host, port, tls = true, rejectUnauthorized = true, socketFactory } = this.opts;
    const desiredCaps = this.opts.desiredCaps ?? DEFAULT_DESIRED_CAPS;

    return new Promise<void>((resolve, reject) => {
      let resolved = false;

      const finish = (err?: Error) => {
        if (resolved) return;
        resolved = true;
        if (err) reject(err);
        else resolve();
      };

      this.transport
        .connect({ host, port, tls, rejectUnauthorized }, socketFactory)
        .then(() => {
          this.transport.on('line', (raw: string) => {
            const msg = parseLine(raw);
            this.dispatch(msg, finish);
          });

          this.transport.on('close', () => {
            this.connected = false;
            this.emit('close');
          });

          this.transport.on('error', (err: Error) => {
            finish(err);
            this.emit('error', err);
          });

          // Begin capability negotiation and registration
          this.write('CAP LS 302');
          this.write(`NICK ${this.opts.nick}`);
          const username = this.opts.username ?? this.opts.nick;
          const realname = this.opts.realname ?? this.opts.nick;
          this.write(`USER ${username} 0 * :${realname}`);

          this.caps.on('ls', (available: Map<string, string | undefined>) => {
            const requested = desiredCaps.filter((c) => available.has(c));
            if (requested.length > 0) {
              this.write(this.caps.reqLine(requested));
            } else {
              this.write('CAP END');
            }
          });

          this.caps.on('ack', (names: string[]) => {
            for (const n of names) this.enabledCaps.add(n);
            if (this.opts.sasl && this.enabledCaps.has('sasl')) {
              this.startSasl(this.opts.sasl.mech, finish);
            } else {
              this.write('CAP END');
            }
          });

          this.caps.on('nak', () => {
            this.write('CAP END');
          });
        })
        .catch(finish);
    });
  }

  private startSasl(mech: SaslMech, onError: (err: Error) => void): void {
    if (mech === 'SCRAM-SHA-256') {
      this.scram = new ScramSha256(this.opts.sasl!.account, this.opts.sasl!.password);
    }
    this.write(`AUTHENTICATE ${mech}`);
    void onError;
  }

  private handleAuthenticate(msg: IrcMessage, finish: (err?: Error) => void): void {
    const sasl = this.opts.sasl!;
    const mech = sasl.mech;
    // Server sends AUTHENTICATE + (empty challenge) or AUTHENTICATE <base64>
    const challenge = msg.params[0] ?? '+';

    let response: string;

    if (mech === 'PLAIN') {
      response = plainResponse(sasl.account, sasl.password, sasl.account);
    } else if (mech === 'EXTERNAL') {
      response = externalResponse();
    } else if (mech === 'SCRAM-SHA-256') {
      if (!this.scram) {
        this.scram = new ScramSha256(sasl.account, sasl.password);
      }
      if (challenge === '+') {
        // Send client-first as base64
        const plaintext = this.scram.clientFirst();
        response = Buffer.from(plaintext, 'utf8').toString('base64');
      } else {
        // challenge is base64-encoded serverFirst — decode to plaintext for clientFinal
        const serverFirst = Buffer.from(challenge, 'base64').toString('utf8');
        const plaintext = this.scram.clientFinal(serverFirst);
        response = Buffer.from(plaintext, 'utf8').toString('base64');
      }
    } else {
      finish(new Error(`Unsupported SASL mechanism: ${mech}`));
      return;
    }

    const chunks = chunkAuthenticate(response);
    for (const chunk of chunks) {
      this.write(`AUTHENTICATE ${chunk}`);
    }
  }

  private dispatch(msg: IrcMessage, finish: (err?: Error) => void): void {
    const { command, params } = msg;

    this.emit('message', msg);

    // PING handling
    if (command === 'PING') {
      const token = params[0] ?? '';
      this.write(`PONG :${token}`);
      return;
    }

    // CAP negotiation
    if (command === 'CAP') {
      this.caps.feed(msg);
      return;
    }

    // AUTHENTICATE (SASL challenge)
    if (command === 'AUTHENTICATE') {
      if (this.opts.sasl) {
        this.handleAuthenticate(msg, finish);
      }
      return;
    }

    // SASL success numerics
    if (command === '900' || command === '903') {
      if (command === '903') {
        // RPL_SASLSUCCESS — end capability negotiation
        this.write('CAP END');
      }
      return;
    }

    // SASL failure numerics
    if (command === '902' || command === '904' || command === '905' || command === '906') {
      finish(new Error(`SASL authentication failed: ${command} ${params.join(' ')}`));
      return;
    }

    // RPL_ISUPPORT (005)
    if (command === '005') {
      // params[0] is the nick, params[last] is the human-readable description
      const tokens = params.slice(1, -1);
      const parsed = parseIsupport(tokens);
      this.mergeIsupport(parsed);
      return;
    }

    // RPL_WELCOME (001) — registration complete
    if (command === '001') {
      this.connected = true;
      if (this.isupport.bot) {
        this.write(`MODE ${this.nick} +${this.isupport.bot}`);
      }
      for (const channel of this.opts.channels ?? []) {
        this.write(`JOIN ${channel}`);
      }
      finish();
      return;
    }

    // BATCH handling
    if (command === 'BATCH') {
      const sigil = params[0]?.[0];
      const ref = params[0]?.slice(1) ?? '';

      if (sigil === '+') {
        // BATCH open
        const batchType = params[1] ?? '';
        const batchParams = params.slice(2);
        const batchTags = msg.tags;

        // If this BATCH open itself carries a batch tag, add it to the parent
        if (msg.tags['batch'] !== undefined) {
          this.batches.add(msg);
        }

        this.batches.open(ref, batchType, batchParams, batchTags);
      } else if (sigil === '-') {
        // BATCH close
        const batchData = this.batches.close(ref);
        if (batchData) {
          // Check if this batch is tracked via labeled-response
          const label = batchData.tags['label'];
          if (label && this.labels.has(label)) {
            this.labels.resolve(label, batchData.messages);
          }
          this.emit('batch', ref, batchData);
        }
      }
      return;
    }

    // Route messages that belong to an open batch
    if (msg.tags['batch'] !== undefined) {
      if (this.batches.add(msg)) {
        // Contained in a batch — also emit as message but don't do further routing
        this.emitConvenience(msg);
        return;
      }
    }

    // Handle labeled-response single message (non-batch)
    const label = msg.tags['label'];
    if (label && this.labels.has(label)) {
      if (command === 'ACK') {
        this.labels.resolve(label, []);
      } else {
        this.labels.resolve(label, [msg]);
      }
    }

    this.emitConvenience(msg);
  }

  private emitConvenience(msg: IrcMessage): void {
    const cmd = msg.command.toUpperCase();
    if (cmd === 'PRIVMSG') this.emit('privmsg', msg);
    else if (cmd === 'NOTICE') this.emit('notice', msg);
    else if (cmd === 'TAGMSG') this.emit('tagmsg', msg);
    else if (cmd === 'JOIN') this.emit('join', msg);
  }

  private mergeIsupport(parsed: Isupport): void {
    if (parsed.prefix.length > 0) this.isupport.prefix = parsed.prefix;
    if (parsed.chanmodes.a || parsed.chanmodes.b || parsed.chanmodes.c || parsed.chanmodes.d) {
      this.isupport.chanmodes = parsed.chanmodes;
    }
    if (parsed.chantypes) this.isupport.chantypes = parsed.chantypes;
    if (parsed.casemapping) this.isupport.casemapping = parsed.casemapping;
    if (parsed.network) this.isupport.network = parsed.network;
    if (parsed.chathistory !== undefined) this.isupport.chathistory = parsed.chathistory;
    if (parsed.msgreftypes.length > 0) this.isupport.msgreftypes = parsed.msgreftypes;
    if (parsed.bot !== undefined) this.isupport.bot = parsed.bot;
    // Merge raw tokens
    for (const [k, v] of Object.entries(parsed.raw)) {
      this.isupport.raw[k] = v;
    }
  }

  send(line: string): void {
    this.transport.write(line);
  }

  sendCommand(command: string, params: string[], tags?: Tags): void {
    const msg: IrcMessage = { tags: tags ?? {}, command, params };
    const line = formatLine(msg);
    // formatLine appends \r\n, strip it for transport.write (which adds its own)
    this.transport.write(line.replace(/\r\n$/, ''));
  }

  request(
    command: string,
    params: string[],
    opts: { tags?: Tags; timeoutMs?: number } = {},
  ): Promise<IrcMessage[]> {
    const timeoutMs = opts.timeoutMs ?? 10000;

    if (!this.enabledCaps.has('labeled-response')) {
      this.sendCommand(command, params, opts.tags);
      return Promise.resolve([]);
    }

    const label = this.labels.next();
    const tags: Tags = { ...opts.tags, label };
    const promise = this.labels.track(label, timeoutMs);
    this.sendCommand(command, params, tags);
    return promise;
  }

  quit(reason = 'bye'): void {
    this.transport.write(`QUIT :${reason}`);
    this.transport.close();
  }

  private write(line: string): void {
    this.transport.write(line);
  }
}
