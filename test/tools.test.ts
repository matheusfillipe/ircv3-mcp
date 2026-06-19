import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { makeTools } from '../src/mcp/tools';
import { saveAccount } from '../src/config/store';
import { AccountConfigSchema } from '../src/config/schema';
import type { SessionPool } from '../src/mcp/session';
import type { IrcClient } from '../src/irc-core/client';
import type { HistoryMessage, ReactionIndex } from '../src/irc-core/types';

let tmpDir: string;
let origConfigDir: string | undefined;
let origSecretBackend: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-tools-'));
  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  origSecretBackend = process.env.IRCV3_MCP_SECRET_BACKEND;
  process.env.IRCV3_MCP_CONFIG_DIR = tmpDir;
  process.env.IRCV3_MCP_SECRET_BACKEND = 'file';
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
    sendMessage: vi.fn().mockResolvedValue({ msgid: 'm1' }),
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
    expect(names).toContain('irc_send_message');
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
      expect(result.structuredContent.networks).toHaveLength(1);
      expect(result.structuredContent.networks[0].name).toBe('testnet');
      expect(result.content[0].text).toBeTruthy();
    });
  });

  describe('irc_status', () => {
    it('returns connection info from client', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_status')!;
      const result = await t.handler({ account: 'testnet' });
      expect(result.structuredContent.nick).toBe('testnick');
      expect(result.structuredContent.connected).toBe(true);
      expect(result.structuredContent.network).toBe('TestNet');
      expect(Array.isArray(result.structuredContent.caps)).toBe(true);
    });
  });

  describe('irc_read_history', () => {
    it('returns markdown transcript by default', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test' });
      expect(result.structuredContent.markdown).toBeTruthy();
      expect(result.structuredContent.markdown).toContain('alice');
      expect(result.content[0].text).toContain('alice');
    });

    it('includes messages in structuredContent', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test', format: 'both' });
      expect(result.structuredContent.messages).toHaveLength(2);
    });

    it('returns only JSON when format is structured', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_read_history')!;
      const result = await t.handler({ target: '#test', format: 'structured' });
      expect(result.structuredContent.markdown).toBeUndefined();
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
  });

  describe('irc_send_message', () => {
    it('sends text and returns msgid', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_message')!;
      const result = await t.handler({ target: '#test', text: 'hello' });
      expect(result.structuredContent).toEqual({ msgid: 'm1' });
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
      expect(result.structuredContent).toEqual({ ok: true });
      expect(client.react).toHaveBeenCalledWith({
        target: '#test',
        msgid: 'msg1',
        emoji: '👋',
        remove: undefined,
      });
    });
  });

  describe('irc_redact', () => {
    it('calls client.redact and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_redact')!;
      const result = await t.handler({ target: '#test', msgid: 'msg1', reason: 'spam' });
      expect(result.structuredContent).toEqual({ ok: true });
      expect(client.redact).toHaveBeenCalledWith('#test', 'msg1', 'spam');
    });
  });

  describe('irc_send_raw', () => {
    it('calls client.send and returns sent', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_send_raw')!;
      const result = await t.handler({ account: 'default', line: 'PING :server' });
      expect(result.structuredContent).toEqual({ sent: true });
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
      expect(result.structuredContent.members).toHaveLength(2);
      expect(result.structuredContent.members[0].nick).toBe('alice');
    });
  });

  describe('irc_whois', () => {
    it('returns whois info', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_whois')!;
      const result = await t.handler({ nick: 'alice' });
      expect(result.structuredContent.nick).toBe('alice');
      expect(result.structuredContent.account).toBe('alice_acct');
    });
  });

  describe('irc_join', () => {
    it('calls client.join and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_join')!;
      const result = await t.handler({ channel: '#newchan' });
      expect(result.structuredContent).toEqual({ ok: true });
      expect(client.join).toHaveBeenCalledWith('#newchan', undefined);
    });
  });

  describe('irc_part', () => {
    it('calls client.part and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_part')!;
      const result = await t.handler({ channel: '#test', reason: 'bye' });
      expect(result.structuredContent).toEqual({ ok: true });
      expect(client.part).toHaveBeenCalledWith('#test', 'bye');
    });
  });

  describe('irc_mark_read', () => {
    it('calls client.markRead and returns ok', async () => {
      const { pool, client } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_mark_read')!;
      const result = await t.handler({ target: '#test', timestamp: '2026-06-19T10:01:00.000Z' });
      expect(result.structuredContent).toEqual({ ok: true });
      expect(client.markRead).toHaveBeenCalledWith('#test', '2026-06-19T10:01:00.000Z');
    });
  });

  describe('irc_list_conversations', () => {
    it('returns conversations list', async () => {
      const { pool } = makePool();
      const tools = makeTools({ pool });
      const t = tools.find((x) => x.name === 'irc_list_conversations')!;
      const result = await t.handler({});
      expect(result.structuredContent.conversations).toHaveLength(1);
      expect(result.structuredContent.conversations[0].target).toBe('#test');
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
