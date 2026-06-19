import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { loadAgentDocs, buildServer } from '../src/mcp/server';
import { SessionPool } from '../src/mcp/session';
import { saveAccount } from '../src/config/store';
import { AccountConfigSchema } from '../src/config/schema';
import type { IrcClient } from '../src/irc-core/client';

const repoDocsDir = fileURLToPath(new URL('../docs/agent', import.meta.url));

let tmpDir: string;
let origConfigDir: string | undefined;
let origSecretBackend: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-resources-'));
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

describe('loadAgentDocs', () => {
  it('returns at least irc-for-agents from the repo docs dir', () => {
    const docs = loadAgentDocs(repoDocsDir);
    const found = docs.find((d) => d.name === 'irc-for-agents');
    expect(found).toBeDefined();
    expect(found!.text.length).toBeGreaterThan(100);
  });

  it('extracts title from the first # heading', () => {
    const docs = loadAgentDocs(repoDocsDir);
    const found = docs.find((d) => d.name === 'irc-for-agents');
    expect(found!.title).toBe('IRC for Agents');
  });

  it('returns empty array when dir does not exist', () => {
    const docs = loadAgentDocs('/nonexistent/path/that/does/not/exist');
    expect(docs).toEqual([]);
  });
});

describe('buildServer', () => {
  it('does not throw when constructing the server', () => {
    saveAccount(AccountConfigSchema.parse({ name: 'testnet', host: 'irc.test.com', nick: 'bot' }));

    const fakeClient = {
      connected: true,
      nick: 'bot',
      quit: vi.fn().mockResolvedValue(undefined),
    } as unknown as IrcClient;

    const pool = new SessionPool({
      connect: vi.fn().mockResolvedValue(fakeClient),
    });

    expect(() => buildServer({ pool, docsDir: repoDocsDir })).not.toThrow();
  });

  it('builds server with empty docs dir gracefully', () => {
    saveAccount(AccountConfigSchema.parse({ name: 'testnet', host: 'irc.test.com', nick: 'bot' }));

    const pool = new SessionPool({ connect: vi.fn() });
    expect(() => buildServer({ pool, docsDir: '/nonexistent/path' })).not.toThrow();
  });
});
