import { describe, it, expect } from 'vitest';
import {
  formatSelector,
  buildChathistory,
  buildTargets,
  clampLimit,
} from '../src/irc-core/chathistory';

describe('formatSelector', () => {
  it('formats star selector', () => {
    expect(formatSelector({ type: 'star' })).toBe('*');
  });

  it('formats msgid selector', () => {
    expect(formatSelector({ type: 'msgid', value: 'abc123' })).toBe('msgid=abc123');
  });

  it('formats timestamp selector', () => {
    expect(formatSelector({ type: 'timestamp', value: '2023-01-01T00:00:00.000Z' })).toBe(
      'timestamp=2023-01-01T00:00:00.000Z',
    );
  });
});

describe('buildChathistory', () => {
  it('builds LATEST command with star selector', () => {
    const result = buildChathistory('latest', '#chan', { selector: { type: 'star' }, limit: 50 });
    expect(result).toBe('CHATHISTORY LATEST #chan * 50');
  });

  it('builds LATEST command with msgid selector', () => {
    const result = buildChathistory('latest', '#chan', {
      selector: { type: 'msgid', value: 'abc' },
      limit: 100,
    });
    expect(result).toBe('CHATHISTORY LATEST #chan msgid=abc 100');
  });

  it('builds BEFORE command', () => {
    const result = buildChathistory('before', '#chan', {
      selector: { type: 'msgid', value: 'xyz' },
      limit: 20,
    });
    expect(result).toBe('CHATHISTORY BEFORE #chan msgid=xyz 20');
  });

  it('builds AFTER command', () => {
    const result = buildChathistory('after', 'nick', {
      selector: { type: 'timestamp', value: '2023-05-01T12:00:00.000Z' },
      limit: 30,
    });
    expect(result).toBe('CHATHISTORY AFTER nick timestamp=2023-05-01T12:00:00.000Z 30');
  });

  it('builds AROUND command', () => {
    const result = buildChathistory('around', '#general', {
      selector: { type: 'msgid', value: 'ref-001' },
      limit: 10,
    });
    expect(result).toBe('CHATHISTORY AROUND #general msgid=ref-001 10');
  });

  it('builds BETWEEN command', () => {
    const result = buildChathistory('between', '#chan', {
      selector1: { type: 'msgid', value: 'start-id' },
      selector2: { type: 'msgid', value: 'end-id' },
      limit: 15,
    });
    expect(result).toBe('CHATHISTORY BETWEEN #chan msgid=start-id msgid=end-id 15');
  });

  it('builds BETWEEN with timestamps', () => {
    const result = buildChathistory('between', '#chan', {
      selector1: { type: 'timestamp', value: '2023-01-01T00:00:00.000Z' },
      selector2: { type: 'timestamp', value: '2023-01-02T00:00:00.000Z' },
      limit: 100,
    });
    expect(result).toBe(
      'CHATHISTORY BETWEEN #chan timestamp=2023-01-01T00:00:00.000Z timestamp=2023-01-02T00:00:00.000Z 100',
    );
  });
});

describe('buildTargets', () => {
  it('builds CHATHISTORY TARGETS command', () => {
    const result = buildTargets('2023-01-01T00:00:00.000Z', '2023-12-31T23:59:59.000Z', 50);
    expect(result).toBe(
      'CHATHISTORY TARGETS timestamp=2023-01-01T00:00:00.000Z timestamp=2023-12-31T23:59:59.000Z 50',
    );
  });
});

describe('clampLimit', () => {
  it('returns limit unchanged when chathistory is undefined', () => {
    expect(clampLimit(5000, { chathistory: undefined })).toBe(5000);
  });

  it('returns limit unchanged when chathistory is 0 (unlimited)', () => {
    expect(clampLimit(5000, { chathistory: 0 })).toBe(5000);
  });

  it('clamps to chathistory max when limit exceeds it', () => {
    expect(clampLimit(5000, { chathistory: 1000 })).toBe(1000);
  });

  it('does not increase limit below the max', () => {
    expect(clampLimit(50, { chathistory: 1000 })).toBe(50);
  });

  it('clamps exactly to max when limit equals max', () => {
    expect(clampLimit(1000, { chathistory: 1000 })).toBe(1000);
  });

  it('returns limit unchanged when chathistory is negative (treat as unlimited)', () => {
    expect(clampLimit(5000, { chathistory: -1 })).toBe(5000);
  });
});
