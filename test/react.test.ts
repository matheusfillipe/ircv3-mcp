import { describe, it, expect } from 'vitest';
import { makeConnectedClient, delay } from './helpers/fakeServer';

describe('react outgoing TAGMSG', () => {
  it('sends react TAGMSG with correct tags', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    await client.react({ target: '#chan', msgid: 'msg-001', emoji: '👍' });
    await delay(5);

    const line = clientWrites().find((l) => l.includes('TAGMSG'));
    expect(line).toBeDefined();
    expect(line).toContain('TAGMSG #chan');
    expect(line).toContain('+reply=msg-001');
    expect(line).toContain('+draft/react=👍');
    expect(line).not.toContain('+draft/unreact');
  });

  it('sends unreact TAGMSG with correct tags', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    await client.react({ target: '#chan', msgid: 'msg-001', emoji: '👍', remove: true });
    await delay(5);

    const line = clientWrites().find((l) => l.includes('TAGMSG'));
    expect(line).toBeDefined();
    expect(line).toContain('+draft/unreact=👍');
    expect(line).not.toContain('+draft/react=');
  });
});

describe('reactions index (incoming)', () => {
  it('adds a reaction when a TAGMSG with +draft/react is received', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-001;+draft/react=❤️ :alice!a@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-001');
    expect(reactions).toBeDefined();
    expect(reactions).toHaveLength(1);
    expect(reactions![0].emoji).toBe('❤️');
    expect(reactions![0].by).toContain('alice');
    expect(reactions![0].count).toBe(1);
  });

  it('aggregates multiple reactors on the same emoji', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-002;+draft/react=🔥 :alice!a@h TAGMSG #chan');
    push('@+reply=msg-002;+draft/react=🔥 :bob!b@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-002');
    expect(reactions).toBeDefined();
    const fire = reactions!.find((r) => r.emoji === '🔥');
    expect(fire).toBeDefined();
    expect(fire!.count).toBe(2);
    expect(fire!.by).toContain('alice');
    expect(fire!.by).toContain('bob');
  });

  it('does not duplicate the same reactor', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-003;+draft/react=👀 :alice!a@h TAGMSG #chan');
    push('@+reply=msg-003;+draft/react=👀 :alice!a@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-003');
    const eyes = reactions?.find((r) => r.emoji === '👀');
    expect(eyes?.count).toBe(1);
    expect(eyes?.by).toHaveLength(1);
  });

  it('removes a reaction on +draft/unreact', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-004;+draft/react=😂 :alice!a@h TAGMSG #chan');
    push('@+reply=msg-004;+draft/react=😂 :bob!b@h TAGMSG #chan');
    await delay(10);

    push('@+reply=msg-004;+draft/unreact=😂 :alice!a@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-004');
    const lol = reactions?.find((r) => r.emoji === '😂');
    expect(lol).toBeDefined();
    expect(lol!.count).toBe(1);
    expect(lol!.by).not.toContain('alice');
    expect(lol!.by).toContain('bob');
  });

  it('removes the emoji entry entirely when all reactors unreact', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-005;+draft/react=✨ :alice!a@h TAGMSG #chan');
    await delay(10);
    push('@+reply=msg-005;+draft/unreact=✨ :alice!a@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-005');
    expect(reactions).toBeDefined();
    expect(reactions!.find((r) => r.emoji === '✨')).toBeUndefined();
  });

  it('keeps different emojis separate', async () => {
    const { client, push } = await makeConnectedClient({ caps: ['message-tags'] });

    push('@+reply=msg-006;+draft/react=👍 :alice!a@h TAGMSG #chan');
    push('@+reply=msg-006;+draft/react=👎 :bob!b@h TAGMSG #chan');
    await delay(10);

    const reactions = client.reactions.get('msg-006');
    expect(reactions).toHaveLength(2);
    expect(reactions!.find((r) => r.emoji === '👍')?.by).toEqual(['alice']);
    expect(reactions!.find((r) => r.emoji === '👎')?.by).toEqual(['bob']);
  });
});
