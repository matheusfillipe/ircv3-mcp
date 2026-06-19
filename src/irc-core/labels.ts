import type { IrcMessage } from './types';

interface Pending {
  resolve: (msgs: IrcMessage[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class LabelMap {
  private counter = 0;
  private pending: Map<string, Pending> = new Map();

  next(): string {
    this.counter += 1;
    return String(this.counter);
  }

  track(label: string, timeoutMs: number): Promise<IrcMessage[]> {
    return new Promise<IrcMessage[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(label);
        reject(new Error(`label ${label} timed out`));
      }, timeoutMs);

      this.pending.set(label, { resolve, reject, timer });
    });
  }

  resolve(label: string, msgs: IrcMessage[]): void {
    const entry = this.pending.get(label);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(label);
    entry.resolve(msgs);
  }

  reject(label: string, err: Error): void {
    const entry = this.pending.get(label);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(label);
    entry.reject(err);
  }

  has(label: string): boolean {
    return this.pending.has(label);
  }
}
