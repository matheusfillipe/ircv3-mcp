import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { setSecret, getSecret, deleteSecret } from '../src/secrets/index';
import { redact, Redactor } from '../src/secrets/redactor';
import { keyFile } from '../src/config/paths';

let tmpDir: string;
let origConfigDir: string | undefined;
let origBackend: string | undefined;
let origSecretKey: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-'));
  origConfigDir = process.env.IRCV3_MCP_CONFIG_DIR;
  origBackend = process.env.IRCV3_MCP_SECRET_BACKEND;
  origSecretKey = process.env.IRCV3_MCP_SECRET_KEY;
  process.env.IRCV3_MCP_CONFIG_DIR = tmpDir;
  process.env.IRCV3_MCP_SECRET_BACKEND = 'file';
});

afterEach(() => {
  if (origConfigDir === undefined) {
    delete process.env.IRCV3_MCP_CONFIG_DIR;
  } else {
    process.env.IRCV3_MCP_CONFIG_DIR = origConfigDir;
  }
  if (origBackend === undefined) {
    delete process.env.IRCV3_MCP_SECRET_BACKEND;
  } else {
    process.env.IRCV3_MCP_SECRET_BACKEND = origBackend;
  }
  if (origSecretKey === undefined) {
    delete process.env.IRCV3_MCP_SECRET_KEY;
  } else {
    process.env.IRCV3_MCP_SECRET_KEY = origSecretKey;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('file backend with env key', () => {
  const fixedKey = randomBytes(32).toString('hex');

  beforeEach(() => {
    process.env.IRCV3_MCP_SECRET_KEY = fixedKey;
  });

  it('setSecret / getSecret round-trips a password', () => {
    setSecret('myaccount', 'h3llo!');
    expect(getSecret('myaccount')).toBe('h3llo!');
  });

  it('getSecret returns null for unknown account', () => {
    expect(getSecret('nobody')).toBeNull();
  });

  it('deleteSecret removes the entry and returns true', () => {
    setSecret('myaccount', 's3cr3t');
    expect(deleteSecret('myaccount')).toBe(true);
    expect(getSecret('myaccount')).toBeNull();
  });

  it('deleteSecret returns false for missing account', () => {
    expect(deleteSecret('ghost')).toBe(false);
  });

  it('multiple accounts are isolated', () => {
    setSecret('alice', 'passA');
    setSecret('bob', 'passB');
    expect(getSecret('alice')).toBe('passA');
    expect(getSecret('bob')).toBe('passB');
  });
});

describe('file backend with generated key file', () => {
  beforeEach(() => {
    delete process.env.IRCV3_MCP_SECRET_KEY;
  });

  it('creates the key file with mode 0600 on first write', () => {
    setSecret('acc', 'pw');
    const kf = keyFile();
    const mode = statSync(kf).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('round-trips a secret using the generated key', () => {
    setSecret('acc', 'mypassword');
    expect(getSecret('acc')).toBe('mypassword');
  });
});

describe('redact function', () => {
  it('replaces a secret in text with ***', () => {
    expect(redact('hello hunter2 world', ['hunter2'])).toBe('hello *** world');
  });

  it('replaces multiple occurrences of the same secret', () => {
    expect(redact('x hunter2 y hunter2 z', ['hunter2'])).toBe('x *** y *** z');
  });

  it('replaces multiple different secrets', () => {
    const result = redact('user=alice pass=secret', ['alice', 'secret']);
    expect(result).toBe('user=*** pass=***');
  });

  it('ignores empty strings', () => {
    expect(redact('hello world', ['', 'world'])).toBe('hello ***');
  });

  it('returns text unchanged when secrets list is empty', () => {
    expect(redact('hello', [])).toBe('hello');
  });
});

describe('Redactor class', () => {
  it('accumulates secrets and masks all of them', () => {
    const r = new Redactor();
    r.add('alpha');
    r.add('beta');
    expect(r.redact('alpha and beta are secrets')).toBe('*** and *** are secrets');
  });

  it('ignores empty add calls', () => {
    const r = new Redactor();
    r.add('');
    expect(r.redact('hello')).toBe('hello');
  });
});
