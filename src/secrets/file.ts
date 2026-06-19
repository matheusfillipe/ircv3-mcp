import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { keyFile, secretsFile, ensureDir, configDir } from '../config/paths';

type EncryptedEntry = { iv: string; tag: string; data: string };
type SecretsStore = Record<string, EncryptedEntry>;

function resolveKey(): Buffer {
  const envKey = process.env.IRCV3_MCP_SECRET_KEY;
  if (envKey) {
    if (envKey.length !== 64) throw new Error('IRCV3_MCP_SECRET_KEY must be 64 hex chars');
    return Buffer.from(envKey, 'hex');
  }
  const kf = keyFile();
  if (existsSync(kf)) {
    return Buffer.from(readFileSync(kf, 'utf8').trim(), 'hex');
  }
  // Generate and persist a new key
  const key = randomBytes(32);
  ensureDir(configDir());
  writeFileSync(kf, key.toString('hex'), { mode: 0o600 });
  return key;
}

function loadStore(): SecretsStore {
  const sf = secretsFile();
  if (!existsSync(sf)) return {};
  return JSON.parse(readFileSync(sf, 'utf8')) as SecretsStore;
}

function saveStore(store: SecretsStore): void {
  ensureDir(configDir());
  writeFileSync(secretsFile(), JSON.stringify(store));
}

function encrypt(key: Buffer, plaintext: string): EncryptedEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(key: Buffer, entry: EncryptedEntry): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(entry.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function fileSet(account: string, password: string): void {
  const key = resolveKey();
  const store = loadStore();
  store[account] = encrypt(key, password);
  saveStore(store);
}

export function fileGet(account: string): string | null {
  const store = loadStore();
  const entry = store[account];
  if (!entry) return null;
  try {
    return decrypt(resolveKey(), entry);
  } catch {
    return null;
  }
}

export function fileDelete(account: string): boolean {
  const store = loadStore();
  if (!(account in store)) return false;
  delete store[account];
  saveStore(store);
  return true;
}

// Exported for testing key-file creation side-effect
export { statSync as _statSync };
