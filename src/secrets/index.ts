import { keychainAvailable, keychainSet, keychainGet, keychainDelete } from './keychain';
import { fileSet, fileGet, fileDelete } from './file';

export type SecretBackend = 'keychain' | 'file';

let cachedBackend: SecretBackend | undefined;

export function chooseBackend(): SecretBackend {
  if (cachedBackend !== undefined) return cachedBackend;
  const env = process.env.IRCV3_MCP_SECRET_BACKEND;
  if (env === 'keychain' || env === 'file') {
    cachedBackend = env;
  } else {
    cachedBackend = keychainAvailable() ? 'keychain' : 'file';
  }
  return cachedBackend;
}

/** Test hook: clears the cached backend so the next call re-reads the environment. */
export function resetBackendCache(): void {
  cachedBackend = undefined;
}

export function setSecret(account: string, password: string): void {
  if (chooseBackend() === 'keychain') {
    keychainSet(account, password);
  } else {
    fileSet(account, password);
  }
}

export function getSecret(account: string): string | null {
  return chooseBackend() === 'keychain' ? keychainGet(account) : fileGet(account);
}

export function deleteSecret(account: string): boolean {
  return chooseBackend() === 'keychain' ? keychainDelete(account) : fileDelete(account);
}

export { keychainAvailable };
export { redact, Redactor } from './redactor';
