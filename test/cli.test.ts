import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { run, cmdAddAccount, cmdList, cmdRemove } from '../src/cli';
import { listAccounts, getAccount } from '../src/config/store';
import { getSecret } from '../src/secrets/index';
import { randomBytes } from 'node:crypto';

// Environment isolation helpers
let tmpConfigDir: string;
let tmpStateDir: string;
let origConfigDir: string | undefined;
let origStateDir: string | undefined;
let origBackend: string | undefined;
let origSecretKey: string | undefined;

beforeEach(() => {
  tmpConfigDir = mkdtempSync(join(os.tmpdir(), 'ircv3-cli-test-'));
  tmpStateDir = mkdtempSync(join(os.tmpdir(), 'ircv3-cli-state-'));

  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  origStateDir = process.env.IRCV3_MCP_STATE_DIR;
  origBackend = process.env.IRCV3_MCP_SECRET_BACKEND;
  origSecretKey = process.env.IRCV3_MCP_SECRET_KEY;

  process.env.IRCV3_MCP_CONFIG_DIR = tmpConfigDir;
  process.env.IRCV3_MCP_STATE_DIR = tmpStateDir;
  process.env.IRCV3_MCP_SECRET_BACKEND = 'file';
  process.env.IRCV3_MCP_SECRET_KEY = randomBytes(32).toString('hex');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpConfigDir, { recursive: true, force: true });
  rmSync(tmpStateDir, { recursive: true, force: true });

  if (origConfigDir === undefined) delete process.env.IRCV3_MCP_CONFIG_DIR;
  else process.env.IRCV3_MCP_CONFIG_DIR = origConfigDir;

  if (origStateDir === undefined) delete process.env.IRCV3_MCP_STATE_DIR;
  else process.env.IRCV3_MCP_STATE_DIR = origStateDir;

  if (origBackend === undefined) delete process.env.IRCV3_MCP_SECRET_BACKEND;
  else process.env.IRCV3_MCP_SECRET_BACKEND = origBackend;

  if (origSecretKey === undefined) delete process.env.IRCV3_MCP_SECRET_KEY;
  else process.env.IRCV3_MCP_SECRET_KEY = origSecretKey;
});

// Capture stdout output
function captureStdout(): { get: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  return {
    get: () => chunks.join(''),
    restore: () => spy.mockRestore(),
  };
}

describe('--version', () => {
  it('returns 0 and prints version', async () => {
    const cap = captureStdout();
    const code = await run(['--version']);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.get()).toMatch(/ircv3-mcp \d+\.\d+\.\d+/);
  });

  it('-v alias also works', async () => {
    const cap = captureStdout();
    const code = await run(['-v']);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.get()).toMatch(/ircv3-mcp/);
  });
});

describe('--help', () => {
  it('returns 0 and prints help text', async () => {
    const cap = captureStdout();
    const code = await run(['--help']);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.get()).toContain('add-account');
  });

  it('help subcommand also works', async () => {
    const cap = captureStdout();
    const code = await run(['help']);
    cap.restore();
    expect(code).toBe(0);
    expect(cap.get()).toContain('list');
  });
});

describe('add-account', () => {
  it('saves account and secret when --password-stdin with SASL', async () => {
    const passwordReader = async () => 'secret123';
    const outLines: string[] = [];

    const code = await cmdAddAccount(
      ['libera'],
      [
        '--host',
        'irc.libera.chat',
        '--nick',
        'botty',
        '--sasl',
        'PLAIN',
        '--account',
        'botty',
        '--password-stdin',
      ],
      { passwordReader, stdout: (s) => outLines.push(s) },
    );

    expect(code).toBe(0);
    expect(outLines.join('')).toContain('libera');

    const accounts = listAccounts();
    const libera = accounts.find((a) => a.name === 'libera');
    expect(libera).toBeDefined();
    expect(libera?.host).toBe('irc.libera.chat');
    expect(libera?.nick).toBe('botty');
    expect(libera?.sasl?.mech).toBe('PLAIN');
    expect(libera?.sasl?.account).toBe('botty');

    const secret = getSecret('libera');
    expect(secret).toBe('secret123');
  });

  it('saves account with no secret when no --password-stdin', async () => {
    const code = await cmdAddAccount(
      ['freenode'],
      ['--host', 'irc.freenode.net', '--nick', 'testbot'],
      {},
    );
    expect(code).toBe(0);
    const accounts = listAccounts();
    expect(accounts.some((a) => a.name === 'freenode')).toBe(true);
    expect(getSecret('freenode')).toBeNull();
  });

  it('sets default flag when --default is passed', async () => {
    const code = await cmdAddAccount(
      ['mynet'],
      ['--host', 'irc.example.com', '--nick', 'testbot', '--default'],
      {},
    );
    expect(code).toBe(0);
    const acc = getAccount('mynet');
    expect(acc.default).toBe(true);
  });

  it('parses channels from --channels csv', async () => {
    const code = await cmdAddAccount(
      ['mynet'],
      ['--host', 'irc.example.com', '--nick', 'testbot', '--channels', '#foo,#bar'],
      {},
    );
    expect(code).toBe(0);
    const acc = getAccount('mynet');
    expect(acc.channels).toEqual(['#foo', '#bar']);
  });

  it('defaults sasl account to nick when --sasl given without --account', async () => {
    const code = await cmdAddAccount(
      ['mynet'],
      ['--host', 'irc.example.com', '--nick', 'mynick', '--sasl', 'PLAIN', '--password-stdin'],
      { passwordReader: async () => 'pw' },
    );
    expect(code).toBe(0);
    const acc = getAccount('mynet');
    expect(acc.sasl?.account).toBe('mynick');
  });

  it('returns 1 when --host is missing', async () => {
    const errLines: string[] = [];
    const code = await cmdAddAccount(['badacc'], ['--nick', 'n'], {
      stderr: (s) => errLines.push(s),
    });
    expect(code).toBe(1);
    expect(errLines.join('')).toContain('--host');
  });

  it('returns 1 when --nick is missing', async () => {
    const errLines: string[] = [];
    const code = await cmdAddAccount(['badacc'], ['--host', 'irc.example.com'], {
      stderr: (s) => errLines.push(s),
    });
    expect(code).toBe(1);
    expect(errLines.join('')).toContain('--nick');
  });

  it('returns 1 when account name is missing', async () => {
    const errLines: string[] = [];
    const code = await cmdAddAccount([], [], { stderr: (s) => errLines.push(s) });
    expect(code).toBe(1);
    expect(errLines.join('')).toContain('missing');
  });

  it('handles --no-tls flag', async () => {
    const code = await cmdAddAccount(
      ['mynet'],
      ['--host', 'irc.example.com', '--nick', 'testbot', '--no-tls'],
      {},
    );
    expect(code).toBe(0);
    const acc = getAccount('mynet');
    expect(acc.tls).toBe(false);
  });
});

describe('list', () => {
  it('prints each account after add-account', async () => {
    await cmdAddAccount(['libera'], ['--host', 'irc.libera.chat', '--nick', 'botty'], {});

    const outLines: string[] = [];
    const code = cmdList({ stdout: (s) => outLines.push(s) });
    expect(code).toBe(0);
    const out = outLines.join('');
    expect(out).toContain('libera');
    expect(out).toContain('irc.libera.chat');
    expect(out).toContain('botty');
    // Should not contain secrets
    expect(out).not.toContain('secret');
  });

  it('prints a message when no accounts configured', () => {
    const outLines: string[] = [];
    const code = cmdList({ stdout: (s) => outLines.push(s) });
    expect(code).toBe(0);
    expect(outLines.join('')).toContain('No accounts');
  });

  it('run(["list"]) works end-to-end', async () => {
    await cmdAddAccount(['mynet'], ['--host', 'irc.example.com', '--nick', 'bot'], {});

    const cap = captureStdout();
    const code = await run(['list']);
    cap.restore();

    expect(code).toBe(0);
    expect(cap.get()).toContain('mynet');
  });
});

describe('remove', () => {
  it('removes account and secret', async () => {
    await cmdAddAccount(
      ['libera'],
      ['--host', 'irc.libera.chat', '--nick', 'botty', '--sasl', 'PLAIN', '--password-stdin'],
      { passwordReader: async () => 'secret123' },
    );

    expect(listAccounts().some((a) => a.name === 'libera')).toBe(true);
    expect(getSecret('libera')).toBe('secret123');

    const outLines: string[] = [];
    const code = cmdRemove('libera', { stdout: (s) => outLines.push(s) });
    expect(code).toBe(0);
    expect(outLines.join('')).toContain('removed');

    expect(listAccounts().some((a) => a.name === 'libera')).toBe(false);
    expect(getSecret('libera')).toBeNull();
  });

  it('returns 1 when account not found', () => {
    const errLines: string[] = [];
    const code = cmdRemove('nope', { stderr: (s) => errLines.push(s) });
    expect(code).toBe(1);
    expect(errLines.join('')).toContain('not found');
  });

  it('run(["remove","nope"]) returns 1', async () => {
    const code = await run(['remove', 'nope']);
    expect(code).toBe(1);
  });
});

describe('unknown command', () => {
  it('returns 1 for bogus command', async () => {
    const code = await run(['bogus']);
    expect(code).toBe(1);
  });

  it('returns 1 for another unknown command', async () => {
    const code = await run(['xyz123']);
    expect(code).toBe(1);
  });
});

describe('serve with --http flag', () => {
  it('returns 1 and prints error message', async () => {
    const errChunks: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errChunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    const code = await run(['serve', '--http']);
    expect(code).toBe(1);
    expect(errChunks.join('')).toContain('HTTP transport not implemented');
  });
});

describe('full add/list/remove flow via run()', () => {
  it('round-trip: add → list shows it → remove → list gone', async () => {
    // Add account directly (avoids stdin blocking in run() with --password-stdin)
    const addCode = await cmdAddAccount(
      ['libera'],
      [
        '--host',
        'irc.libera.chat',
        '--nick',
        'botty',
        '--sasl',
        'PLAIN',
        '--account',
        'botty',
        '--password-stdin',
      ],
      { passwordReader: async () => 'secret123' },
    );
    expect(addCode).toBe(0);

    const listCap = captureStdout();
    const listCode = await run(['list']);
    listCap.restore();
    expect(listCode).toBe(0);
    expect(listCap.get()).toContain('libera');

    const removeCap = captureStdout();
    const removeCode = await run(['remove', 'libera']);
    removeCap.restore();
    expect(removeCode).toBe(0);

    const list2Cap = captureStdout();
    const list2Code = await run(['list']);
    list2Cap.restore();
    expect(list2Code).toBe(0);
    expect(list2Cap.get()).toContain('No accounts');
  });
});
