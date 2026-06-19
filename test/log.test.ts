import { describe, it, expect, vi, afterEach } from 'vitest';

// Must be imported fresh per test if we're testing module-level state;
// use dynamic import with vi.resetModules() for clean redactor state.

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('log module', () => {
  it('redacts registered secrets in log output', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const { addSecret, log } = await import('../src/log');
    addSecret('hunter2');
    log('pass is hunter2');

    expect(spy).toHaveBeenCalled();
    expect(writes.join('')).toContain('pass is ***');
    expect(writes.join('')).not.toContain('hunter2');
  });

  it('redacts secrets in error output', async () => {
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const { addSecret, error } = await import('../src/log');
    addSecret('supersecret');
    error('bad thing with supersecret key');

    expect(spy).toHaveBeenCalled();
    expect(writes.join('')).toContain('bad thing with *** key');
    expect(writes.join('')).not.toContain('supersecret');
  });

  it('writes to stderr, not stdout', async () => {
    const stderrWrites: string[] = [];
    const stdoutWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const { log } = await import('../src/log');
    log('hello world');

    expect(stderrWrites.join('')).toContain('hello world');
    expect(stdoutWrites).toHaveLength(0);
  });

  it('handles non-string arguments by converting them', async () => {
    const writes: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });

    const { log } = await import('../src/log');
    log('count:', 42, true);

    expect(writes.join('')).toContain('count: 42 true');
  });
});
