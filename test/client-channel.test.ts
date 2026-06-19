import { describe, it, expect } from 'vitest';
import { makeConnectedClient, delay } from './helpers/fakeServer';

describe('IrcClient channel/user methods', () => {
  describe('join', () => {
    it('sends JOIN <channel> without a key', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.join('#x');
      expect(clientWrites()).toContain('JOIN #x');
    });

    it('sends JOIN <channel> <key> when key is given', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.join('#x', 'key');
      expect(clientWrites()).toContain('JOIN #x key');
    });
  });

  describe('part', () => {
    it('sends PART <channel> without a reason', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.part('#x');
      expect(clientWrites()).toContain('PART #x');
    });

    it('sends PART <channel> :<reason> when reason is given', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.part('#x', 'bye');
      expect(clientWrites()).toContain('PART #x :bye');
    });
  });

  describe('redact', () => {
    it('sends REDACT <target> <msgid> :<reason> when reason is given', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.redact('#x', 'm1', 'spam');
      expect(clientWrites()).toContain('REDACT #x m1 :spam');
    });

    it('sends REDACT <target> <msgid> without reason when omitted', async () => {
      const { client, clientWrites } = await makeConnectedClient();
      client.redact('#x', 'm1');
      expect(clientWrites()).toContain('REDACT #x m1');
    });
  });

  describe('listMembers', () => {
    it('sends NAMES and resolves with parsed members', async () => {
      const { client, clientWrites, push } = await makeConnectedClient();

      const promise = client.listMembers('#x');
      await delay(5);

      expect(clientWrites()).toContain('NAMES #x');

      push(':srv 353 me = #x :@alice +bob carol');
      await delay(5);
      push(':srv 366 me #x :End of /NAMES list');
      await delay(5);

      const members = await promise;
      expect(members).toEqual([
        { nick: 'alice', prefixes: '@' },
        { nick: 'bob', prefixes: '+' },
        { nick: 'carol', prefixes: '' },
      ]);
    });

    it('handles userhost-in-names (nick!user@host) stripping', async () => {
      const { client, push } = await makeConnectedClient();

      const promise = client.listMembers('#x');
      await delay(5);

      push(':srv 353 me = #x :@alice!~alice@host.example +bob!bob@other.net');
      await delay(5);
      push(':srv 366 me #x :End');
      await delay(5);

      const members = await promise;
      expect(members).toEqual([
        { nick: 'alice', prefixes: '@' },
        { nick: 'bob', prefixes: '+' },
      ]);
    });

    it('ignores 353/366 for other channels', async () => {
      const { client, push } = await makeConnectedClient();

      const promise = client.listMembers('#x');
      await delay(5);

      // Interleaved response for a different channel — should be ignored
      push(':srv 353 me = #other :dave');
      await delay(5);
      push(':srv 366 me #other :End');
      await delay(5);

      // Now the correct channel
      push(':srv 353 me = #x :@alice');
      await delay(5);
      push(':srv 366 me #x :End');
      await delay(5);

      const members = await promise;
      expect(members).toEqual([{ nick: 'alice', prefixes: '@' }]);
    });

    it('rejects on timeout', async () => {
      const { client } = await makeConnectedClient();
      await expect(client.listMembers('#x', 50)).rejects.toThrow('NAMES timed out');
    });
  });

  describe('whois', () => {
    it('sends WHOIS and resolves with parsed result', async () => {
      const { client, clientWrites, push } = await makeConnectedClient();

      const promise = client.whois('alice');
      await delay(5);

      expect(clientWrites()).toContain('WHOIS alice');

      push(':srv 311 me alice u h * :Alice Real');
      await delay(5);
      push(':srv 330 me alice aliceacct :is logged in as');
      await delay(5);
      push(':srv 319 me alice :#x #y');
      await delay(5);
      push(':srv 318 me alice :End of /WHOIS list');
      await delay(5);

      const result = await promise;
      expect(result.nick).toBe('alice');
      expect(result.account).toBe('aliceacct');
      expect(result.realname).toBe('Alice Real');
      expect(result.channels).toBe('#x #y');
      expect(result.lines).toContain('Alice Real');
      expect(result.lines).toContain('is logged in as');
      expect(result.lines).toContain('#x #y');
    });

    it('resolves with only nick and lines when optional fields are absent', async () => {
      const { client, push } = await makeConnectedClient();

      const promise = client.whois('ghost');
      await delay(5);

      push(':srv 311 me ghost u h * :Ghost User');
      await delay(5);
      push(':srv 318 me ghost :End of /WHOIS list');
      await delay(5);

      const result = await promise;
      expect(result.nick).toBe('ghost');
      expect(result.account).toBeUndefined();
      expect(result.channels).toBeUndefined();
      expect(result.realname).toBe('Ghost User');
    });

    it('rejects on timeout', async () => {
      const { client } = await makeConnectedClient();
      await expect(client.whois('alice', 50)).rejects.toThrow('WHOIS timed out');
    });
  });

  describe('quit', () => {
    it('quit() sends QUIT line and resolves', async () => {
      const { client, clientWrites, socket } = await makeConnectedClient({ caps: [] });

      // Emit close from the socket so quit() resolves quickly (not after the 1000ms fallback)
      const quitPromise = client.quit('bye');
      expect(clientWrites().some((l) => l === 'QUIT :bye')).toBe(true);
      socket.emit('close');

      // Should resolve after close event is emitted
      await expect(quitPromise).resolves.toBeUndefined();
    });
  });
});
