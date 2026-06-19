/**
 * Shared types for the IRCv3 protocol engine. This module has no runtime
 * dependencies and is the contract every other irc-core module builds on.
 */

/** Parsed message tags. Valueless tags map to the empty string. */
export type Tags = Record<string, string>;

/** The `nick!user@host` (or server name) prefix of a message. */
export interface Source {
  raw: string;
  nick?: string;
  user?: string;
  host?: string;
  /** True when the prefix is a bare server name (no `!`/`@`). */
  isServer: boolean;
}

/** A single parsed IRC protocol line. */
export interface IrcMessage {
  tags: Tags;
  source?: Source;
  command: string;
  params: string[];
}

export type SaslMech = 'PLAIN' | 'EXTERNAL' | 'SCRAM-SHA-256';

/** Parsed RPL_ISUPPORT (005) values relevant to this client. */
export interface Isupport {
  /** Channel-membership prefix mapping in rank order, e.g. [{mode:'o',symbol:'@'},...]. */
  prefix: Array<{ mode: string; symbol: string }>;
  /** CHANMODES groups A,B,C,D. */
  chanmodes: { a: string; b: string; c: string; d: string };
  chantypes: string;
  casemapping: 'ascii' | 'rfc1459' | 'rfc1459-strict';
  network?: string;
  /** Max messages returnable per CHATHISTORY request (0 = unlimited). */
  chathistory?: number;
  /** Supported CHATHISTORY selector types in preference order. */
  msgreftypes: string[];
  /** Character set by `BOT=` token, if the server flags bots. */
  bot?: string;
  /** All raw tokens, for tokens not modelled above. */
  raw: Record<string, string | true>;
}

export type MessageKind =
  | 'privmsg'
  | 'notice'
  | 'tagmsg'
  | 'join'
  | 'part'
  | 'quit'
  | 'nick'
  | 'mode'
  | 'topic';

/** A normalized message as surfaced to the MCP layer / renderer. */
export interface HistoryMessage {
  msgid?: string;
  /** ISO-8601 UTC timestamp from server-time, if present. */
  time?: string;
  target: string;
  nick?: string;
  account?: string;
  kind: MessageKind;
  /** Single-line text, or the joined text of a multiline message. */
  text?: string;
  /** Original lines for a multiline message (before joining). */
  lines?: string[];
  /** msgid of the parent message this is a reply to (`+reply`). */
  replyTo?: string;
  /** True when this message was redacted. */
  redacted?: boolean;
}

/** Aggregated reaction for a parent message. */
export interface Reaction {
  emoji: string;
  by: string[];
  count: number;
}

/** Map of parent msgid -> reactions on it. */
export type ReactionIndex = Map<string, Reaction[]>;

/** A buffered live protocol event, for the recent-events watch buffer. */
export interface EventRecord {
  /** Monotonic sequence number, unique per connection. */
  seq: number;
  /** ISO-8601 timestamp (server-time when present, else receipt time). */
  time: string;
  /** Lowercased command (privmsg, notice, join, part, quit, nick, mode, topic, tagmsg, ...). */
  kind: string;
  target?: string;
  nick?: string;
  account?: string;
  text?: string;
  msgid?: string;
  /** The raw IRC line (without CRLF) for inspection. */
  raw: string;
}
