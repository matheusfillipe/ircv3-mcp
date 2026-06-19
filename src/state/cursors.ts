import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { cursorsFile, stateDir, ensureDir } from '../config/paths';

type CursorValue = { msgid?: string; time?: string };
type CursorStore = Record<string, Record<string, CursorValue>>;

function loadStore(): CursorStore {
  const f = cursorsFile();
  if (!existsSync(f)) return {};
  return JSON.parse(readFileSync(f, 'utf8')) as CursorStore;
}

function saveStore(store: CursorStore): void {
  ensureDir(stateDir());
  writeFileSync(cursorsFile(), JSON.stringify(store));
}

export function getCursor(account: string, target: string): CursorValue | undefined {
  const store = loadStore();
  return store[account]?.[target];
}

export function setCursor(account: string, target: string, value: CursorValue): void {
  const store = loadStore();
  if (!store[account]) store[account] = {};
  store[account][target] = { ...store[account][target], ...value };
  saveStore(store);
}
