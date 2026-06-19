import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export function configDir(): string {
  if (process.env.IRCV3_MCP_CONFIG_DIR) return process.env.IRCV3_MCP_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'ircv3-mcp') : join(os.homedir(), '.config', 'ircv3-mcp');
}

export function stateDir(): string {
  if (process.env.IRCV3_MCP_STATE_DIR) return process.env.IRCV3_MCP_STATE_DIR;
  const xdg = process.env.XDG_STATE_HOME;
  return xdg ? join(xdg, 'ircv3-mcp') : join(os.homedir(), '.local', 'state', 'ircv3-mcp');
}

export function configFile(): string {
  return join(configDir(), 'config.toml');
}

export function secretsFile(): string {
  return join(configDir(), 'secrets.enc');
}

export function keyFile(): string {
  return join(configDir(), 'secrets.key');
}

export function cursorsFile(): string {
  return join(stateDir(), 'cursors.json');
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
