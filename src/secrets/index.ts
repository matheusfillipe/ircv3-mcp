import { keychainAvailable, keychainSet, keychainGet, keychainDelete } from './keychain';
import { fileSet, fileGet, fileDelete } from './file';

export type SecretBackend = 'keychain' | 'file';

export function chooseBackend(): SecretBackend {
  const env = process.env.IRCV3_MCP_SECRET_BACKEND;
  if (env === 'keychain' || env === 'file') return env;
  return keychainAvailable() ? 'keychain' : 'file';
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
