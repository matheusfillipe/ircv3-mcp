import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, getAccount } from '../src/config/store';

const examplePath = fileURLToPath(new URL('../docs/config.example.toml', import.meta.url));

describe('shipped config.example.toml', () => {
  let dir: string;
  const prev = process.env.IRCV3_MCP_CONFIG_DIR;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ircv3-cfgex-'));
    process.env.IRCV3_MCP_CONFIG_DIR = dir;
    copyFileSync(examplePath, join(dir, 'config.toml'));
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.IRCV3_MCP_CONFIG_DIR;
    else process.env.IRCV3_MCP_CONFIG_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it('parses and validates against the schema', () => {
    const cfg = loadConfig();
    expect(cfg.accounts.length).toBeGreaterThan(0);
    const acc = getAccount('libera');
    expect(acc.host).toBe('irc.libera.chat');
    expect(acc.tls).toBe(true);
    expect(acc.sasl?.mech).toBe('PLAIN');
  });

  it('does not carry a password field', () => {
    const acc = getAccount('libera');
    expect(acc).not.toHaveProperty('password');
    expect(acc.sasl).not.toHaveProperty('password');
  });
});
