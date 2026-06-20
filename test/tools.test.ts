import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { makeTools } from '../src/mcp/tools';
import { saveAccount } from '../src/config/store';
import { AccountConfigSchema } from '../src/config/schema';
import { getCursor } from '../src/state/cursors';
import type { SessionPool } from '../src/mcp/session';
import type { IrcClient } from '../src/irc-core/client';
import type { HistoryMessage, ReactionIndex } from '../src/irc-core/types';
import type { ToolResult } from '../src/mcp/tools';

// Helper: cast structuredContent to Record for test assertions.
function sc(result: ToolResult): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

let tmpDir: string;
let origConfigDir: string | undefined;
let origSecretBackend: string | undefined;
let origStateDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-tools-'));
  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  origSecretBackend = process.env.IRCV3_MCP_SECRET_BACKEND;
  origStateDir = process.env.IRCV3_MCP_STATE_DIR;
  process.env.IRCV3_MCP_CONFIG_DIR = tmpDir;
  process.env.IRCV3_MCP_SECRET_BACKEND = 'file';
  process.env.IRCV3_MCP_STATE_DIR = tmpDir;
  // Save a default account (allowRaw: true) so irc_send_raw lookup succeeds in all tests
  saveAccount(
    AccountConfigSchema.parse({
      name: 'default',
      host: 'irc.test.com',
      nick: 'testnick',
      default: true,
      allowRaw: true,
    }),
  );
});

afterEach(() => {
  if (origConfigDir === undefined) {
    delete process.env.IRCV3_MCP_CONFIG_DIR;
  } else {
    process.env.IRCV3_MCP_CONFIG_DIR = origConfigDir;
  }
  if (origSecretBackend === undefined) {
    delete process.env.IRCV3_MCP_SECRET_BACKEND;
  } else {
    process.env.IRCV3_MCP_SECRET_BACKEND = origSecretBackend;
  }
  if (origStateDir === undefined) {
    delete process.env.IRCV3_MCP_STATE_DIR;
  } else {
    process.env.IRCV3_MCP_STATE_DIR = origStateDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleMessages: HistoryMessage[] = [
  {
    msgid: 'msg1',
    time: '2026-06-19T10:00:00.000Z',
    target: '#test',
    nick: 'alice',
    kind: 'privmsg',
    text: 'hello world',
  },
  {
    msgid: 'msg2',
    time: '2026-06-19T10:01:00.000Z',
    target: '#test',
    nick: 'bob',
    kind: 'privmsg',
    text: 'hi alice',
  },
];

const noReactions: ReactionIndex = new Map();

function makePool(overrides: Partial<IrcClient> = {}): { pool: SessionPool; client: IrcClient } {
  const client: IrcClient = {
    connected: true,
    nick: 'testnick',
    isupport: {
      network: 'TestNet',
      prefix: [],
      chanmodes: { a: '', b: '', c: '', d: '' },
      chantypes: '#',
      casemapping: 'rfc1459',
      msgreftypes: [],
      raw: {},
    },
    enabledCaps: new Set(['message-tags', 'server-time']),
    reactions: noReactions,
    readHistory: vi.fn().mockResolvedValue(sampleMessages),
    listConversations: vi
      .fn()
      .mockResolvedValue([{ target: '#test', latestTime: '2026-06-19T10:01:00.000Z' }]),
    listMembers: vi.fn().mockResolvedValue([
      { nick: 'alice', prefixes: '@' },
      { nick: 'bob', prefixes: '' },
    ]),
    whois: vi.fn().mockResolvedValue({
      nick: 'alice',
      account: 'alice_acct',
      realname: 'Alice',
      lines: ['Alice'],
    }),
    sendMessage: vi.fn().mockResolvedValue({ ok: true, msgid: 'm1' }),
    sendWithTyping: vi.fn().mockResolvedValue({ ok: true, msgid: 'm1' }),
    sendTyping: vi.fn(),
    recentEvents: vi.fn().mockReturnValue([
      {
        seq: 1,
        time: '2026-06-19T10:00:00.000Z',
        kind: 'privmsg',
        target: '#test',
        nick: 'alice',
        text: 'hi',
        raw: ':alice PRIVMSG #test :hi',
      },
    ]),
    lastEventSeq: vi.fn().mockReturnValue(1),
    react: vi.fn().mockResolvedValue(undefined),
    join: vi.fn(),
    part: vi.fn(),
    markRead: vi.fn(),
    redact: vi.fn(),
    send: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as IrcClient;

  const pool = {
    get: vi.fn().mockResolvedValue(client),
    status: vi
      .fn()
      .mockReturnValue([
        { name: 'testnet', host: 'irc.test.com', default: true, connected: true, nick: 'testnick' },
      ]),
    closeAll: vi.fn().mockResolvedValue(undefined),
  } as unknown as SessionPool;

  return { pool, client };
}

describe('makeTools', () => {
  it('returns a tool def for each expected tool name', () => {
    const { pool } = makePool();
    const tools = makeTools({ pool });
    const names = tools.map((t) => t.name);
    expect(names).toContain('irc_list_networks');
    expect(names).toContain('irc_status');
    expect(names).toContain('irc_read_history');
    expect(names).toContain('irc_list_conversations');
    expect(names).toContain('irc_list_members');
    expect(names).toContain('irc_whois');
    expect(names).toContain('irc_recent_events');
    expect(names).toContain('irc_send_message');
    expect(names).toContain('irc_send_with_typing');
    expect(names).toContain('irc_start_typing');
    expect(names).toContain('irc_stop_typing');
    expect(names).toContain('irc_react');
    expect(names).toContain('irc_join');
    expect(names).toContain('irc_part');
    expect(names).toContain('irc_mark_read');
    expect(names).toContain('irc_redact');
    expect(names).toContain('irc_send_raw');
  });

  describe('annotations', () => {
    it('read tools have readOnlyHint true', () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      for (const name of [
        'irc_list_networks',
        'irc_status',
        'irc_read_history',
        'irc_list_conversations',
        'irc_list_members',
        'irc_whois',
        'irc_recent_events',
      ]) {
        const t = tools.find((x) => x.name === name)!;
        expect(t.config.annotations?.readOnlyHint, `${name} readOnlyHint`).toBe(true);
      }
    });

    it('irc_redact has destructiveHint true', () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_redact')!;
      expect(t.config.annotations?.destructiveHint).toBe(true);
    });

    it('irc_send_raw has destructiveHint true', () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_raw')!;
      expect(t.config.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('irc_list_networks', () => {
    it('returns structured networks from pool.status()', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_list_networks')!;
      const result = await t.handler({});
      const networks = sc(result).networks as Array<{ name: string }>;
      expect(networks).toHaveLength(1);
      expect(networks[0].name).toBe('testnet');
      expect(result.content[0].text).toBeTruthy();
    });
  });

  describe('irc_recent_events', () => {
    it('returns buffered events and a cursor', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_recent_events')!;
      const result = await t.handler({ target: '#test', since_seq: 0 });
      const out = sc(result) as { events: unknown[]; cursor: number };
      expect(out.events).toHaveLength(1);
      expect(out.cursor).toBe(1);
    });
  });

  describe('irc_status', () => {
    it('returns connection info from client', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_status')!;
      const result = await t.handler({ account: 'testnet' });
      expect(sc(result).nick).toBe('testnick');
      expect(sc(result).connected).toBe(true);
      expect(sc(result).network).toBe('TestNet');
      expect(Array.isArray(sc(result).caps)).toBe(true);
    });
  });

  describe('irc_read_history', () => {
    it('returns markdown transcript by default', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test' });
      expect(sc(result).markdown).toBeTruthy();
      expect(sc(result).markdown).toContain('alice');
      expect(result.content[0].text).toContain('alice');
    });

    it('includes messages in structuredContent', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test', format: 'both' });
      expect(sc(result).messages).toHaveLength(2);
    });

    it('returns only JSON when format is structured', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test', format: 'structured' });
      expect(sc(result).markdown).toBeUndefined();
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it('returns isError when non-latest mode has no msgid', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test', mode: 'before' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('msgid');
    });

    it('persists a cursor for the newest message after reading history', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      await t.handler({ target: '#test' });
      const cursor = getCursor('default', '#test');
      expect(cursor?.msgid).toBe('msg2');
      expect(cursor?.time).toBe('2026-06-19T10:01:00.000Z');
    });
  });

  describe('irc_send_message', () => {
    it('sends text and returns msgid', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_message')!;
      const result = await t.handler({ target: '#test', text: 'hello' });
      expect(sc(result)).toEqual({ ok: true, msgid: 'm1' });
    });

    it('sends lines array', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_message')!;
      await t.handler({ target: '#test', lines: ['line1', 'line2'] });
      expect(client.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ lines: ['line1', 'line2'] }),
      );
    });

    it('returns isError when neither text nor lines provided', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_message')!;
      const result = await t.handler({ target: '#test' });
      expect(result.isError).toBe(true);
    });
  });

  describe('irc_react', () => {
    it('calls client.react and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_react')!;
      const result = await t.handler({ target: '#test', msgid: 'msg1', emoji: '👋' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.react).toHaveBeenCalledWith({
        target: '#test',
        msgid: 'msg1',
        emoji: '👋',
        remove: undefined,
      });
    });
  });

  describe('irc_send_with_typing', () => {
    it('calls client.sendWithTyping and returns ok with msgid', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_with_typing')!;
      const result = await t.handler({ target: '#test', text: 'hello', wpm: 120 });
      expect(sc(result)).toEqual({ ok: true, msgid: 'm1' });
      expect(client.sendWithTyping).toHaveBeenCalledWith(
        expect.objectContaining({ target: '#test', lines: ['hello'], wpm: 120 }),
      );
    });

    it('returns isError when neither text nor lines provided', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_with_typing')!;
      const result = await t.handler({ target: '#test' });
      expect(result.isError).toBe(true);
    });
  });

  describe('irc_start_typing / irc_stop_typing', () => {
    it('start sends an active typing notification', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_start_typing')!;
      const result = await t.handler({ target: '#test' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.sendTyping).toHaveBeenCalledWith('#test', 'active');
    });

    it('stop sends a done typing notification', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_stop_typing')!;
      const result = await t.handler({ target: '#test' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.sendTyping).toHaveBeenCalledWith('#test', 'done');
    });
  });

  describe('irc_redact', () => {
    it('calls client.redact and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_redact')!;
      const result = await t.handler({ target: '#test', msgid: 'msg1', reason: 'spam' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.redact).toHaveBeenCalledWith('#test', 'msg1', 'spam');
    });
  });

  describe('irc_send_raw', () => {
    it('calls client.send and returns sent', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_raw')!;
      const result = await t.handler({ account: 'default', line: 'PING :server' });
      expect(sc(result)).toEqual({ sent: true });
      expect(client.send).toHaveBeenCalledWith('PING :server');
    });

    it('returns isError when account.allowRaw is false', async () => {
      saveAccount(
        AccountConfigSchema.parse({
          name: 'noraw',
          host: 'irc.noraw.com',
          nick: 'nr',
          allowRaw: false,
        }),
      );
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_raw')!;
      const result = await t.handler({ account: 'noraw', line: 'PING :server' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("raw IRC is disabled for account 'noraw'");
      expect(client.send).not.toHaveBeenCalled();
    });
  });

  describe('irc_list_members', () => {
    it('returns members list', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_list_members')!;
      const result = await t.handler({ channel: '#test' });
      const members = sc(result).members as Array<{ nick: string }>;
      expect(members).toHaveLength(2);
      expect(members[0].nick).toBe('alice');
    });
  });

  describe('irc_whois', () => {
    it('returns whois info', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_whois')!;
      const result = await t.handler({ nick: 'alice' });
      expect(sc(result).nick).toBe('alice');
      expect(sc(result).account).toBe('alice_acct');
    });
  });

  describe('irc_join', () => {
    it('calls client.join and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_join')!;
      const result = await t.handler({ channel: '#newchan' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith('#newchan', undefined);
    });
  });

  describe('irc_part', () => {
    it('calls client.part and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_part')!;
      const result = await t.handler({ channel: '#test', reason: 'bye' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.part).toHaveBeenCalledWith('#test', 'bye');
    });
  });

  describe('irc_mark_read', () => {
    it('calls client.markRead and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_mark_read')!;
      const result = await t.handler({ target: '#test', timestamp: '2026-06-19T10:01:00.000Z' });
      expect(sc(result)).toEqual({ ok: true });
      expect(client.markRead).toHaveBeenCalledWith('#test', '2026-06-19T10:01:00.000Z');
    });

    it('persists a cursor that getCursor returns', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_mark_read')!;
      await t.handler({ target: '#cursorchan', timestamp: '2026-06-19T12:00:00.000Z' });
      const cursor = getCursor('default', '#cursorchan');
      expect(cursor?.time).toBe('2026-06-19T12:00:00.000Z');
    });
  });

  describe('irc_list_conversations', () => {
    it('returns conversations list', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_list_conversations')!;
      const result = await t.handler({});
      const conversations = sc(result).conversations as Array<{ target: string }>;
      expect(conversations).toHaveLength(1);
      expect(conversations[0].target).toBe('#test');
    });
  });

  describe('error handling', () => {
    it('returns isError result when client throws', async () => {
      const { pool } = makePool({
        sendMessage: vi
          .fn()
          .mockRejectedValue(new Error('Network error')) as IrcClient['sendMessage'],
      });
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_message')!;
      const result = await t.handler({ target: '#test', text: 'hi' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Network error');
    });
  });
});
