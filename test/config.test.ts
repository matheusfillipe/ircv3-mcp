import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import {
  saveAccount,
  loadConfig,
  removeAccount,
  listAccounts,
  getAccount,
} from '../src/config/store';
import { AccountConfigSchema } from '../src/config/schema';

let tmpDir: string;
let origConfigDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-'));
  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  process.env.IRCV3_MCP_CONFIG_DIR = tmpDir;
});

afterEach(() => {
  if (origConfigDir === undefined) {
    delete process.env.IRCV3_MCP_CONFIG_DIR;
  } else {
    process.env.IRCV3_MCP_CONFIG_DIR = origConfigDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

const base = {
  name: 'testnet',
  host: 'irc.example.com',
  nick: 'testnick',
};

describe('saveAccount / loadConfig round-trip', () => {
  it('persists an account through TOML and reloads it', () => {
    saveAccount(AccountConfigSchema.parse(base));
    const cfg = loadConfig();
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].name).toBe('testnet');
    expect(cfg.accounts[0].host).toBe('irc.example.com');
    expect(cfg.accounts[0].nick).toBe('testnick');
    expect(cfg.accounts[0].port).toBe(6697);
    expect(cfg.accounts[0].tls).toBe(true);
  });

  it('upserts an account with the same name', () => {
    saveAccount(AccountConfigSchema.parse(base));
    saveAccount(AccountConfigSchema.parse({ ...base, nick: 'newnick' }));
    const cfg = loadConfig();
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].nick).toBe('newnick');
  });

  it('appends a second account with a different name', () => {
    saveAccount(AccountConfigSchema.parse(base));
    saveAccount(AccountConfigSchema.parse({ ...base, name: 'othernet' }));
    expect(listAccounts()).toHaveLength(2);
  });
});

describe('getAccount default selection', () => {
  it('returns the account marked as default', () => {
    saveAccount(AccountConfigSchema.parse({ ...base, name: 'a' }));
    saveAccount(AccountConfigSchema.parse({ ...base, name: 'b', default: true }));
    expect(getAccount().name).toBe('b');
  });

  it('returns the only account when exactly one exists', () => {
    saveAccount(AccountConfigSchema.parse(base));
    expect(getAccount().name).toBe('testnet');
  });

  it('throws when multiple accounts exist and no default', () => {
    saveAccount(AccountConfigSchema.parse({ ...base, name: 'a' }));
    saveAccount(AccountConfigSchema.parse({ ...base, name: 'b' }));
    expect(() => getAccount()).toThrow();
  });

  it('throws when named account is not found', () => {
    saveAccount(AccountConfigSchema.parse(base));
    expect(() => getAccount('missing')).toThrow("Account 'missing' not found");
  });

  it('returns the named account when it exists', () => {
    saveAccount(AccountConfigSchema.parse(base));
    expect(getAccount('testnet').name).toBe('testnet');
  });
});

describe('removeAccount', () => {
  it('returns true when the account existed and removes it', () => {
    saveAccount(AccountConfigSchema.parse(base));
    expect(removeAccount('testnet')).toBe(true);
    expect(listAccounts()).toHaveLength(0);
  });

  it('returns false when the account does not exist', () => {
    expect(removeAccount('nope')).toBe(false);
  });
});

describe('schema validation', () => {
  it('rejects an account missing nick', () => {
    expect(() => AccountConfigSchema.parse({ name: 'net', host: 'irc.example.com' })).toThrow();
  });

  it('rejects an account with empty name', () => {
    expect(() =>
      AccountConfigSchema.parse({ name: '', host: 'irc.example.com', nick: 'n' }),
    ).toThrow();
  });
});

describe('password never written to TOML', () => {
  it('does not write a password field to the config file', () => {
    // Even if someone smuggles a password field via an extended object, it
    // must not survive TOML serialisation (schema strips unknown keys via zod)
    const acc = AccountConfigSchema.parse({ ...base, password: 'hunter2' } as never);
    saveAccount(acc);
    const text = readFileSync(join(tmpDir, 'config.toml'), 'utf8');
    expect(text).not.toContain('password');
    expect(text).not.toContain('hunter2');
  });
});
