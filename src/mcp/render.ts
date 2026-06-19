import type { HistoryMessage, ReactionIndex } from '../irc-core/types';

export interface RenderOptions {
  showMsgid?: boolean;
}

export function renderTranscript(
  messages: HistoryMessage[],
  reactions: ReactionIndex,
  opts?: RenderOptions,
): string {
  const showMsgid = opts?.showMsgid !== false;

  // Index for reply-snippet lookups
  const byMsgid = new Map<string, HistoryMessage>();
  for (const msg of messages) {
    if (msg.msgid) byMsgid.set(msg.msgid, msg);
  }

  const rendered: string[] = [];

  for (const msg of messages) {
    // tagmsg with no text is a carrier (reaction/typing) — skip as its own line
    if (msg.kind === 'tagmsg' && !msg.text) continue;

    const lines: string[] = [];

    // Build the time prefix
    const timePrefix = msg.time ? `\`${msg.time.slice(11, 19)}\` ` : '';

    // Build the nick segment
    const nickBold = msg.nick ? `**${msg.nick}**` : '';
    let nickSegment = nickBold;
    if (msg.account) nickSegment += ` (${msg.account})`;
    if (msg.kind === 'notice') nickSegment += ' (notice)';

    const header = `${timePrefix}${nickSegment}`;

    // Reply quote line, before the message
    if (msg.replyTo) {
      const parent = byMsgid.get(msg.replyTo);
      if (parent) {
        const parentNick = parent.nick ?? '<unknown>';
        const rawSnippet = (parent.text ?? '').replace(/\n/g, ' ');
        const snippet = rawSnippet.slice(0, 60);
        lines.push(`    ↳ replying to ${parentNick}: "${snippet}"`);
      } else {
        lines.push(`    ↳ replying to <unknown>`);
      }
    }

    // Message text
    const displayText = msg.redacted ? '~~[redacted]~~' : (msg.text ?? '');
    const msgidSuffix = showMsgid && msg.msgid ? ` · id:${msg.msgid}` : '';

    if (msg.lines && msg.lines.length > 1) {
      // Multiline: header line then each line indented
      lines.push(`${header}:`);
      for (const line of msg.lines) {
        lines.push(`    ${line}`);
      }
      // Append msgid suffix to the last content line
      if (msgidSuffix) {
        lines[lines.length - 1] += msgidSuffix;
      }
    } else {
      lines.push(`${header}: ${displayText}${msgidSuffix}`);
    }

    // Reactions
    if (msg.msgid) {
      const reacts = reactions.get(msg.msgid);
      if (reacts) {
        for (const r of reacts) {
          lines.push(`    ↳ ${r.emoji} ×${r.count} (${r.by.join(', ')})`);
        }
      }
    }

    rendered.push(lines.join('\n'));
  }

  return rendered.join('\n');
}
