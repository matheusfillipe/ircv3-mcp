import { Entry } from '@napi-rs/keyring';

const SERVICE = 'ircv3-mcp';

export function keychainAvailable(): boolean {
  try {
    new Entry(SERVICE, '__probe__');
    return true;
  } catch {
    return false;
  }
}

export function keychainSet(account: string, password: string): void {
  const entry = new Entry(SERVICE, account);
  entry.setPassword(password);
}

export function keychainGet(account: string): string | null {
  try {
    const entry = new Entry(SERVICE, account);
    return entry.getPassword();
  } catch {
    return null;
  }
}

export function keychainDelete(account: string): boolean {
  try {
    const entry = new Entry(SERVICE, account);
    entry.deletePassword();
    return true;
  } catch {
    return false;
  }
}
