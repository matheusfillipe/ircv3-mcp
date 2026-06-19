import type { Isupport } from './types';

export type HistoryMode = 'latest' | 'before' | 'after' | 'around' | 'between';

export type Selector =
  | { type: 'msgid'; value: string }
  | { type: 'timestamp'; value: string }
  | { type: 'star' };

export function formatSelector(s: Selector): string {
  if (s.type === 'star') return '*';
  return `${s.type}=${s.value}`;
}

/**
 * Clamp `limit` to the server-advertised CHATHISTORY maximum.
 * 0 or undefined means unlimited — no clamping applied.
 */
export function clampLimit(limit: number, isupport: Pick<Isupport, 'chathistory'>): number {
  const max = isupport.chathistory;
  if (max === undefined || max <= 0) return limit;
  return Math.min(limit, max);
}

export interface ChathistoryArgs {
  selector: Selector;
  limit: number;
}

export interface BetweenArgs {
  selector1: Selector;
  selector2: Selector;
  limit: number;
}

export function buildChathistory(mode: 'latest', target: string, args: ChathistoryArgs): string;
export function buildChathistory(mode: 'before', target: string, args: ChathistoryArgs): string;
export function buildChathistory(mode: 'after', target: string, args: ChathistoryArgs): string;
export function buildChathistory(mode: 'around', target: string, args: ChathistoryArgs): string;
export function buildChathistory(mode: 'between', target: string, args: BetweenArgs): string;
export function buildChathistory(
  mode: HistoryMode,
  target: string,
  args: ChathistoryArgs | BetweenArgs,
): string;
export function buildChathistory(
  mode: HistoryMode,
  target: string,
  args: ChathistoryArgs | BetweenArgs,
): string {
  const m = mode.toUpperCase();
  if (mode === 'between') {
    const { selector1, selector2, limit } = args as BetweenArgs;
    return `CHATHISTORY BETWEEN ${target} ${formatSelector(selector1)} ${formatSelector(selector2)} ${limit}`;
  }
  const { selector, limit } = args as ChathistoryArgs;
  return `CHATHISTORY ${m} ${target} ${formatSelector(selector)} ${limit}`;
}

export function buildTargets(start: string, end: string, limit: number): string {
  return `CHATHISTORY TARGETS timestamp=${start} timestamp=${end} ${limit}`;
}
