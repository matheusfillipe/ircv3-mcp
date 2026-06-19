import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { saveAccount } from '../src/config/store';
import { AccountConfigSchema } from '../src/config/schema';
import { SessionPool } from '../src/mcp/session';
import type { IrcClient } from '../src/irc-core/client';

let tmpDir: string;
let origConfigDir: string | undefined;
let origSecretBackend: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-session-'));
  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  origSecretBackend = process.env.IRCV3_MCP_SECRET_BACKEND;
  process.env.IRCV3_MCP_CONFIG_DIR = tmpDir;
  process.env.IRCV3_MCP_SECRET_BACKEND = 'file';
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

function fakeClient(name: string): IrcClient {
  return {
    connected: true,
    nick: name,
    quit: vi.fn().mockResolvedValue(undefined),
  } as unknown as IrcClient;
}

describe('SessionPool', () => {
  it('connects once and reuses the cached client on second get', async () => {
    saveAccount(AccountConfigSchema.parse({ name: 'a', host: 'irc.a.com', nick: 'botnick' }));

    const spy = vi.fn().mockResolvedValue(fakeClient('botnick'));
    const pool = new SessionPool({ connect: spy });

    const c1 = await pool.get('a');
    const c2 = await pool.get('a');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(c1).toBe(c2);
  });

  it('get() with no name returns the default account', async () => {
    saveAccount(
      AccountConfigSchema.parse({ name: 'def', host: 'irc.def.com', nick: 'n', default: true }),
    );
    saveAccount(AccountConfigSchema.parse({ name: 'other', host: 'irc.other.com', nick: 'm' }));

    const spy = vi.fn().mockImplementation(async (acc) => fakeClient(acc.nick as string));
    const pool = new SessionPool({ connect: spy });

    const c = await pool.get();
    expect(spy).toHaveBeenCalledOnce();
    expect(c.nick).toBe('n');
  });

  it('reconnects when the cached client is no longer connected', async () => {
    saveAccount(AccountConfigSchema.parse({ name: 'b', host: 'irc.b.com', nick: 'n' }));

    const disconnected = { connected: false, nick: 'n', quit: vi.fn() } as unknown as IrcClient;
    const reconnected = fakeClient('n');

    const spy = vi.fn().mockResolvedValueOnce(disconnected).mockResolvedValueOnce(reconnected);
    const pool = new SessionPool({ connect: spy });

    await pool.get('b');
    const c2 = await pool.get('b');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(c2).toBe(reconnected);
  });

  it('status() reflects accounts from config and cache', async () => {
    saveAccount(
      AccountConfigSchema.parse({ name: 'x', host: 'irc.x.com', nick: 'xn', default: true }),
    );
    saveAccount(AccountConfigSchema.parse({ name: 'y', host: 'irc.y.com', nick: 'yn' }));

    const spy = vi.fn().mockResolvedValue(fakeClient('xn'));
    const pool = new SessionPool({ connect: spy });

    // Connect only x
    await pool.get('x');

    const status = pool.status();
    expect(status).toHaveLength(2);

    const xStatus = status.find((s) => s.name === 'x')!;
    expect(xStatus.connected).toBe(true);
    expect(xStatus.host).toBe('irc.x.com');
    expect(xStatus.default).toBe(true);

    const yStatus = status.find((s) => s.name === 'y')!;
    expect(yStatus.connected).toBe(false);
  });

  it('closeAll() calls quit() on all cached clients and clears cache', async () => {
    saveAccount(AccountConfigSchema.parse({ name: 'p', host: 'irc.p.com', nick: 'pn' }));
    saveAccount(AccountConfigSchema.parse({ name: 'q', host: 'irc.q.com', nick: 'qn' }));

    const clientP = fakeClient('pn');
    const clientQ = fakeClient('qn');

    const spy = vi.fn().mockResolvedValueOnce(clientP).mockResolvedValueOnce(clientQ);
    const pool = new SessionPool({ connect: spy });

    await pool.get('p');
    await pool.get('q');
    await pool.closeAll();

    expect(clientP.quit).toHaveBeenCalledOnce();
    expect(clientQ.quit).toHaveBeenCalledOnce();

    // After closeAll, status shows all disconnected
    const status = pool.status();
    expect(status.every((s) => !s.connected)).toBe(true);
  });
});
