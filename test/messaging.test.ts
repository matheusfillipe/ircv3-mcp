import { describe, it, expect } from 'vitest';
import { makeConnectedClient, delay } from './helpers/fakeServer';

describe('sendMessage', () => {
  it('sends single PRIVMSG', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    await client.sendMessage({ target: '#chan', lines: ['hello world'] });
    await delay(5);
    expect(clientWrites().some((l) => l === 'PRIVMSG #chan :hello world')).toBe(true);
  });

  it('sends single PRIVMSG with +reply tag', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    await client.sendMessage({ target: '#chan', lines: ['reply text'], inReplyTo: 'abc123' });
    await delay(5);
    const line = clientWrites().find((l) => l.includes('PRIVMSG'));
    expect(line).toBeDefined();
    expect(line).toContain('+reply=abc123');
    expect(line).toContain('PRIVMSG #chan');
    expect(line).toContain('reply text');
  });

  it('sends NOTICE when notice:true', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    await client.sendMessage({ target: '#chan', lines: ['hi'], notice: true });
    await delay(5);
    expect(clientWrites().some((l) => l.includes('NOTICE #chan'))).toBe(true);
  });

  it('sends multiline batch when draft/multiline enabled', async () => {
    const { client, clientWrites } = await makeConnectedClient({
      caps: ['draft/multiline'],
    });

    await client.sendMessage({ target: '#chan', lines: ['line 1', 'line 2', 'line 3'] });
    await delay(5);

    const writes = clientWrites();
    const batchOpen = writes.find((l) => l.includes('BATCH +') && l.includes('draft/multiline'));
    expect(batchOpen).toBeDefined();
    expect(batchOpen).toContain('#chan');

    // Extract batch ref from the BATCH open line
    const refMatch = batchOpen!.match(/BATCH \+([A-Za-z0-9]+)/);
    expect(refMatch).toBeDefined();
    const ref = refMatch![1];

    // Each line should be tagged with the batch ref
    const line1 = writes.find((l) => l.includes('PRIVMSG #chan') && l.includes('line 1'));
    expect(line1).toBeDefined();
    expect(line1).toContain(`batch=${ref}`);

    const line2 = writes.find((l) => l.includes('PRIVMSG #chan') && l.includes('line 2'));
    expect(line2).toBeDefined();

    const line3 = writes.find((l) => l.includes('PRIVMSG #chan') && l.includes('line 3'));
    expect(line3).toBeDefined();

    // BATCH close
    const batchClose = writes.find((l) => l === `BATCH -${ref}`);
    expect(batchClose).toBeDefined();
  });

  it('attaches +reply to BATCH open line for multiline', async () => {
    const { client, clientWrites } = await makeConnectedClient({
      caps: ['draft/multiline'],
    });

    await client.sendMessage({
      target: '#chan',
      lines: ['line 1', 'line 2'],
      inReplyTo: 'parent-id',
    });
    await delay(5);

    const batchOpen = clientWrites().find((l) => l.includes('BATCH +'));
    expect(batchOpen).toBeDefined();
    expect(batchOpen).toContain('+reply=parent-id');
  });

  it('falls back to separate PRIVMSGs when draft/multiline not enabled', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });

    await client.sendMessage({ target: '#chan', lines: ['line 1', 'line 2'] });
    await delay(5);

    const writes = clientWrites();
    expect(writes.some((l) => l.includes('BATCH'))).toBe(false);
    const privmsgs = writes.filter((l) => l.includes('PRIVMSG #chan'));
    expect(privmsgs).toHaveLength(2);
  });

  it('attaches +reply to first line only in fallback mode', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });

    await client.sendMessage({
      target: '#chan',
      lines: ['line 1', 'line 2'],
      inReplyTo: 'parent-id',
    });
    await delay(5);

    const writes = clientWrites();
    const privmsgs = writes.filter((l) => l.includes('PRIVMSG #chan'));
    expect(privmsgs[0]).toContain('+reply=parent-id');
    expect(privmsgs[1]).not.toContain('+reply');
  });

  it('captures msgid from echoed PRIVMSG via labeled-response+echo-message', async () => {
    const { client, clientWrites, push } = await makeConnectedClient({
      caps: ['labeled-response', 'echo-message'],
    });

    const sendPromise = client.sendMessage({ target: '#chan', lines: ['hello'] });
    await delay(5);

    // Find the label in the outgoing PRIVMSG
    const privmsgLine = clientWrites().find((l) => l.includes('PRIVMSG'));
    expect(privmsgLine).toBeDefined();
    const labelMatch = privmsgLine!.match(/label=([^;\s]+)/);
    expect(labelMatch).toBeDefined();
    const label = labelMatch![1];

    // Server echoes back with msgid
    push(
      `@label=${label};msgid=abc;time=2023-01-01T00:00:00.000Z :testbot!u@h PRIVMSG #chan :hello`,
    );
    await delay(5);

    const result = await sendPromise;
    expect(result.msgid).toBe('abc');
  });
});

describe('markRead', () => {
  it('sends MARKREAD with timestamp', async () => {
    const { client, clientWrites } = await makeConnectedClient({ caps: [] });
    client.markRead('#chan', '2023-01-01T00:00:00.000Z');
    await delay(5);
    expect(
      clientWrites().some((l) => l === 'MARKREAD #chan timestamp=2023-01-01T00:00:00.000Z'),
    ).toBe(true);
  });
});
