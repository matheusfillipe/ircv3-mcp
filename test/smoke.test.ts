import { describe, expect, it } from 'vitest';
import type { IrcMessage } from '../src/irc-core/types';

describe('scaffold smoke', () => {
  it('type contract is importable and shaped', () => {
    const msg: IrcMessage = { tags: {}, command: 'PING', params: ['token'] };
    expect(msg.command).toBe('PING');
    expect(msg.params).toEqual(['token']);
  });
});
