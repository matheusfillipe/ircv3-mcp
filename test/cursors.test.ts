import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { getCursor, setCursor } from '../src/state/cursors';

let tmpDir: string;
let origStateDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'ircv3-'));
  origStateDir = process.env.IRCV3_MCP_STATE_DIR;
  process.env.IRCV3_MCP_STATE_DIR = tmpDir;
});

afterEach(() => {
  if (origStateDir === undefined) {
    delete process.env.IRCV3_MCP_STATE_DIR;
  } else {
    process.env.IRCV3_MCP_STATE_DIR = origStateDir;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getCursor / setCursor', () => {
  it('returns undefined for a missing account/target', () => {
    expect(getCursor('myacc', '#channel')).toBeUndefined();
  });

  it('round-trips msgid and time', () => {
    setCursor('acc1', '#chan', { msgid: 'abc123', time: '2024-01-01T00:00:00Z' });
    const c = getCursor('acc1', '#chan');
    expect(c?.msgid).toBe('abc123');
    expect(c?.time).toBe('2024-01-01T00:00:00Z');
  });

  it('merges partial updates', () => {
    setCursor('acc1', '#chan', { msgid: 'old', time: '2024-01-01T00:00:00Z' });
    setCursor('acc1', '#chan', { msgid: 'new' });
    const c = getCursor('acc1', '#chan');
    expect(c?.msgid).toBe('new');
    expect(c?.time).toBe('2024-01-01T00:00:00Z');
  });

  it('isolates different targets within the same account', () => {
    setCursor('acc1', '#chan1', { msgid: 'a' });
    setCursor('acc1', '#chan2', { msgid: 'b' });
    expect(getCursor('acc1', '#chan1')?.msgid).toBe('a');
    expect(getCursor('acc1', '#chan2')?.msgid).toBe('b');
  });

  it('isolates different accounts with the same target', () => {
    setCursor('acc1', '#chan', { msgid: 'x' });
    setCursor('acc2', '#chan', { msgid: 'y' });
    expect(getCursor('acc1', '#chan')?.msgid).toBe('x');
    expect(getCursor('acc2', '#chan')?.msgid).toBe('y');
  });

  it('persists cursors across calls (file-backed)', () => {
    setCursor('acc1', 'nick', { time: '2024-06-01T12:00:00Z' });
    // A fresh read from disk should return the same value
    const c = getCursor('acc1', 'nick');
    expect(c?.time).toBe('2024-06-01T12:00:00Z');
  });
});
