import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { parse, stringify } from 'smol-toml';
import { AccountConfigSchema, ConfigSchema } from './schema';
import type { AccountConfig, Config } from './schema';
import { configFile, configDir, ensureDir } from './paths';

export function loadConfig(): Config {
  const file = configFile();
  if (!existsSync(file)) return { accounts: [] };
  const raw = readFileSync(file, 'utf8');
  const parsed = parse(raw);
  return ConfigSchema.parse(parsed);
}

export function saveConfig(cfg: Config): void {
  ensureDir(configDir());
  // smol-toml stringify expects plain objects; zod output is plain
  writeFileSync(configFile(), stringify(cfg as unknown as Record<string, unknown>));
}

export function saveAccount(acc: AccountConfig): void {
  const validated = AccountConfigSchema.parse(acc);
  const cfg = loadConfig();
  const idx = cfg.accounts.findIndex((a) => a.name === validated.name);
  if (idx >= 0) {
    cfg.accounts[idx] = validated;
  } else {
    cfg.accounts.push(validated);
  }
  saveConfig(cfg);
}

export function removeAccount(name: string): boolean {
  const cfg = loadConfig();
  const idx = cfg.accounts.findIndex((a) => a.name === name);
  if (idx < 0) return false;
  cfg.accounts.splice(idx, 1);
  saveConfig(cfg);
  return true;
}

export function listAccounts(): AccountConfig[] {
  return loadConfig().accounts;
}

export function getAccount(name?: string): AccountConfig {
  const accounts = listAccounts();
  if (name !== undefined) {
    const found = accounts.find((a) => a.name === name);
    if (!found) throw new Error(`Account '${name}' not found`);
    return found;
  }
  const defaultAcc = accounts.find((a) => a.default === true);
  if (defaultAcc) return defaultAcc;
  if (accounts.length === 1) return accounts[0];
  if (accounts.length === 0) throw new Error('No accounts configured');
  throw new Error('Multiple accounts configured; specify a name');
}
