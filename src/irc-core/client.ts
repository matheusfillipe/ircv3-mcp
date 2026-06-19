import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import { TlsTransport } from './transport';
import { parseLine, formatLine } from './parser';
import { CapNegotiator } from './caps';
import { parseIsupport } from './isupport';
import { BatchTracker } from './batch';
import { assembleMultiline } from './batch';
import { LabelMap } from './labels';
import { plainResponse } from './sasl/plain';
import { externalResponse } from './sasl/external';
import { chunkAuthenticate } from './sasl/chunk';
import { ScramSha256 } from './sasl/scram';
import { buildChathistory, buildTargets, clampLimit } from './chathistory';
import type { IrcMessage, Isupport, SaslMech, Tags, HistoryMessage, ReactionIndex } from './types';
import type { HistoryMode, Selector } from './chathistory';

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

  /** Aggregated reactions keyed by the parent message's msgid. */
  reactions: ReactionIndex = new Map();

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

    this.handleReaction(msg);
    this.emitConvenience(msg);
  }

  /**
   * Maintain the reactions index when an incoming TAGMSG carries
   * `+draft/react` or `+draft/unreact` tags.
   */
  private handleReaction(msg: IrcMessage): void {
    if (msg.command !== 'TAGMSG') return;
    const parentMsgid = msg.tags['+reply'];
    if (!parentMsgid) return;

    const reactEmoji = msg.tags['+draft/react'];
    const unreactEmoji = msg.tags['+draft/unreact'];
    const nick = msg.source?.nick;
    if (!nick) return;

    const emoji = reactEmoji ?? unreactEmoji;
    if (!emoji) return;

    const isUnreact = unreactEmoji !== undefined;

    let list = this.reactions.get(parentMsgid);
    if (!list) {
      list = [];
      this.reactions.set(parentMsgid, list);
    }

    const existing = list.find((r) => r.emoji === emoji);

    if (isUnreact) {
      if (existing) {
        existing.by = existing.by.filter((n) => n !== nick);
        existing.count = existing.by.length;
        if (existing.count === 0) {
          const idx = list.indexOf(existing);
          list.splice(idx, 1);
        }
      }
    } else {
      if (existing) {
        if (!existing.by.includes(nick)) {
          existing.by.push(nick);
          existing.count = existing.by.length;
        }
      } else {
        list.push({ emoji, by: [nick], count: 1 });
      }
    }
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

  /**
   * Map a raw PRIVMSG/NOTICE/TAGMSG to a normalized HistoryMessage.
   */
  private toHistoryMessage(msg: IrcMessage): HistoryMessage {
    const kind =
      msg.command === 'NOTICE' ? 'notice' : msg.command === 'TAGMSG' ? 'tagmsg' : 'privmsg';
    return {
      msgid: msg.tags['msgid'],
      time: msg.tags['time'],
      target: msg.params[0] ?? '',
      nick: msg.source?.nick,
      account: msg.tags['account'],
      kind,
      text: msg.params[msg.params.length - 1],
      replyTo: msg.tags['+reply'],
    };
  }

  /**
   * Send a message (PRIVMSG/NOTICE), with optional multiline batch support.
   * Returns the msgid of the echo'd message when labeled-response + echo-message are both active.
   */
  async sendMessage(opts: {
    target: string;
    lines: string[];
    notice?: boolean;
    inReplyTo?: string;
  }): Promise<{ msgid?: string }> {
    const { target, lines, notice = false, inReplyTo } = opts;
    const command = notice ? 'NOTICE' : 'PRIVMSG';
    const replyTags: Tags = inReplyTo ? { '+reply': inReplyTo } : {};

    if (lines.length === 0) return {};

    const hasLabeled = this.enabledCaps.has('labeled-response');
    const hasEcho = this.enabledCaps.has('echo-message');
    const hasMultiline = this.enabledCaps.has('draft/multiline');

    if (lines.length === 1) {
      const tags: Tags = { ...replyTags };
      if (hasLabeled && hasEcho) {
        const msgs = await this.request(command, [target, lines[0]!], { tags });
        const echo = msgs.find((m) => m.command === command);
        return { msgid: echo?.tags['msgid'] };
      }
      this.sendCommand(
        command,
        [target, lines[0]!],
        Object.keys(tags).length > 0 ? tags : undefined,
      );
      return {};
    }

    // Multi-line path
    if (hasMultiline) {
      const ref = randomBytes(8)
        .toString('base64url')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 12);
      const openTags: Tags = { ...replyTags };
      this.sendCommand('BATCH', [`+${ref}`, 'draft/multiline', target], openTags);
      for (const line of lines) {
        this.sendCommand(command, [target, line], { batch: ref });
      }
      this.sendCommand('BATCH', [`-${ref}`]);
      return {};
    }

    // Fallback: send each line individually
    for (let i = 0; i < lines.length; i++) {
      const tags: Tags = i === 0 ? { ...replyTags } : {};
      this.sendCommand(
        command,
        [target, lines[i]!],
        Object.keys(tags).length > 0 ? tags : undefined,
      );
    }
    return {};
  }

  /**
   * Fetch history from a target channel/user via CHATHISTORY.
   * Automatically paginates backward for 'latest' and 'before' modes.
   */
  async readHistory(opts: {
    target: string;
    mode?: HistoryMode;
    selector?: Selector;
    limit?: number;
    timeoutMs?: number;
  }): Promise<HistoryMessage[]> {
    const {
      target,
      mode = 'latest',
      selector = mode === 'latest' ? ({ type: 'star' } satisfies Selector) : undefined,
      timeoutMs = 15000,
    } = opts;
    if (!selector) return [];

    const limit = clampLimit(opts.limit ?? 50, this.isupport);
    const collected: HistoryMessage[] = [];
    const MAX_PAGES = 20;

    let remaining = limit;
    let currentSelector = selector;
    let page = 0;

    while (remaining > 0 && page < MAX_PAGES) {
      const pageLimit = remaining;
      let cmdLine: string;
      if (mode === 'between') {
        cmdLine = buildChathistory('between', target, {
          selector1: currentSelector,
          selector2: selector,
          limit: pageLimit,
        });
      } else {
        cmdLine = buildChathistory(mode, target, { selector: currentSelector, limit: pageLimit });
      }

      const [cmd, ...rest] = cmdLine.split(' ');
      const pageMsgs = await this.collectHistoryBatch(cmd!, rest, target, timeoutMs);

      if (pageMsgs.length === 0) break;

      collected.push(...pageMsgs);
      remaining -= pageMsgs.length;
      page++;

      // Only paginate for latest/before modes
      if (mode !== 'latest' && mode !== 'before') break;
      if (pageMsgs.length < pageLimit) break;

      // Next page: BEFORE the oldest received message
      const oldestMsgid = pageMsgs[0]?.msgid;
      if (!oldestMsgid) break;
      currentSelector = { type: 'msgid', value: oldestMsgid };
    }

    // Sort ascending by time, then msgid
    collected.sort((a, b) => {
      if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
      if (a.msgid && b.msgid && a.msgid !== b.msgid) return a.msgid < b.msgid ? -1 : 1;
      return 0;
    });

    return collected;
  }

  /**
   * Send CHATHISTORY TARGETS and collect the response batch.
   */
  async listConversations(opts: {
    start: string;
    end: string;
    limit?: number;
  }): Promise<{ target: string; latestTime?: string }[]> {
    const limit = clampLimit(opts.limit ?? 50, this.isupport);
    const cmdLine = buildTargets(opts.start, opts.end, limit);
    const [cmd, ...rest] = cmdLine.split(' ');

    const msgs = await this.collectHistoryBatch(cmd!, rest, undefined, 15000, [
      'draft/chathistory-targets',
      'chathistory-targets',
    ]);

    return msgs.map((m) => ({ target: m.target, latestTime: m.time }));
  }

  /**
   * Send a TAGMSG reaction (or unreaction) for a message.
   */
  react(opts: { target: string; msgid: string; emoji: string; remove?: boolean }): Promise<void> {
    const { target, msgid, emoji, remove = false } = opts;
    const tags: Tags = {
      '+reply': msgid,
      [remove ? '+draft/unreact' : '+draft/react']: emoji,
    };
    this.sendCommand('TAGMSG', [target], tags);
    return Promise.resolve();
  }

  /**
   * Send a MARKREAD for a target at the given timestamp.
   */
  markRead(target: string, timestamp: string): void {
    this.sendCommand('MARKREAD', [target, `timestamp=${timestamp}`]);
  }

  /**
   * Send a CHATHISTORY command and resolve with the parsed HistoryMessage array
   * from the first matching chathistory batch.
   */
  private collectHistoryBatch(
    cmd: string,
    params: string[],
    target: string | undefined,
    timeoutMs: number,
    batchTypes?: string[],
  ): Promise<HistoryMessage[]> {
    return new Promise<HistoryMessage[]>((resolve, reject) => {
      const defaultTypes = ['chathistory'];
      const types = batchTypes ?? defaultTypes;

      const timer = setTimeout(() => {
        this.off('batch', onBatch);
        reject(new Error(`CHATHISTORY timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onBatch = (
        _ref: string,
        batchData: { type: string; params: string[]; messages: IrcMessage[] },
      ) => {
        if (!types.includes(batchData.type)) return;
        // Match target when specified
        if (target !== undefined && batchData.params[0] !== target) return;

        clearTimeout(timer);
        this.off('batch', onBatch);

        const msgs: HistoryMessage[] = [];
        // Detect nested draft/multiline sub-batches by grouping messages by their batch tag
        const subBatches = new Map<string, IrcMessage[]>();

        for (const m of batchData.messages) {
          const subRef = m.tags['batch'];
          if (subRef && m.command === 'BATCH') continue; // already tracked
          if (subRef && subRef !== _ref) {
            let sub = subBatches.get(subRef);
            if (!sub) {
              sub = [];
              subBatches.set(subRef, sub);
            }
            sub.push(m);
            continue;
          }
          if (m.command === 'PRIVMSG' || m.command === 'NOTICE' || m.command === 'TAGMSG') {
            msgs.push(this.toHistoryMessage(m));
          }
        }

        // Assemble any multiline sub-batches (they appear as nested BATCHes)
        for (const [, subMsgs] of subBatches) {
          const assembled = assembleMultiline({ params: [target ?? ''], messages: subMsgs });
          const first = subMsgs.find((m) => m.command === 'PRIVMSG' || m.command === 'NOTICE');
          if (first) {
            const base = this.toHistoryMessage(first);
            msgs.push({ ...base, text: assembled.text, lines: assembled.lines });
          }
        }

        resolve(msgs);
      };

      this.on('batch', onBatch);
      this.sendCommand(cmd, params);
    });
  }

  quit(reason = 'bye'): void {
    this.transport.write(`QUIT :${reason}`);
    this.transport.close();
  }

  private write(line: string): void {
    this.transport.write(line);
  }
}
