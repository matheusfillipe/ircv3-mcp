import type { IrcMessage, Tags } from './types';

interface BatchEntry {
  type: string;
  params: string[];
  tags: Tags;
  messages: IrcMessage[];
}

export class BatchTracker {
  private batches: Map<string, BatchEntry> = new Map();

  open(ref: string, type: string, params: string[], tags: Tags): void {
    this.batches.set(ref, { type, params, tags, messages: [] });
  }

  /**
   * Returns true if msg carries a `batch` tag matching an open batch and was appended.
   * Nested batches (BATCH START lines that themselves carry a `batch` tag) are both
   * recorded into their parent batch AND opened in this tracker.
   */
  add(msg: IrcMessage): boolean {
    const ref = msg.tags['batch'];
    if (ref === undefined) return false;
    const entry = this.batches.get(ref);
    if (!entry) return false;
    entry.messages.push(msg);
    return true;
  }

  isOpen(ref: string): boolean {
    return this.batches.has(ref);
  }

  close(
    ref: string,
  ): { type: string; params: string[]; tags: Tags; messages: IrcMessage[] } | undefined {
    const entry = this.batches.get(ref);
    if (!entry) return undefined;
    this.batches.delete(ref);
    return entry;
  }
}

export interface MultilineResult {
  target: string;
  text: string;
  lines: string[];
}

/**
 * Assembles a draft/multiline batch into joined text.
 * Lines whose message carries the valueless tag `draft/multiline-concat` are
 * joined to the previous line with no separator instead of a newline.
 */
export function assembleMultiline(batch: {
  params: string[];
  messages: IrcMessage[];
}): MultilineResult {
  const target = batch.params[0] ?? '';
  const lines: string[] = [];

  for (const m of batch.messages) {
    if (m.command !== 'PRIVMSG' && m.command !== 'NOTICE') continue;
    const text = m.params[m.params.length - 1] ?? '';
    const isConcat = 'draft/multiline-concat' in m.tags;
    if (isConcat && lines.length > 0) {
      lines[lines.length - 1] += text;
    } else {
      lines.push(text);
    }
  }

  return { target, text: lines.join('\n'), lines };
}
