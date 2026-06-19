import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { VERSION } from './version';
import { runStdio } from './mcp/server';
import { saveAccount, listAccounts, removeAccount, getAccount } from './config/store';
import { setSecret, getSecret, deleteSecret } from './secrets/index';
import { IrcClient } from './irc-core/client';
import type { AccountConfig } from './config/schema';

const HELP = `\
ircv3-mcp — IRCv3 MCP server / account manager

Usage:
  ircv3-mcp [serve] [--http]     Run MCP server over stdio (default)
  ircv3-mcp add-account <name>   Add/update an IRC account
  ircv3-mcp list                 List configured accounts
  ircv3-mcp remove <name>        Remove an account and its secret
  ircv3-mcp configure            Interactive account setup
  ircv3-mcp test <name>          Test connectivity for an account
  ircv3-mcp --version, -v        Print version
  ircv3-mcp --help, -h           Print this help

add-account flags:
  --host <h>         IRC server host (required)
  --port <n>         Port (default 6697)
  --tls / --no-tls   TLS (default on)
  --nick <n>         Nickname (required)
  --username <u>     Username (ident)
  --realname <r>     Real name
  --sasl <mech>      SASL mechanism: PLAIN | EXTERNAL | SCRAM-SHA-256
  --account <a>      SASL account name (defaults to nick)
  --channels <csv>   Comma-separated channels to auto-join
  --default          Mark as default account
  --password-stdin   Read password from stdin
`;

// Injectable password reader — default reads from real stdin.
export type PasswordReader = () => Promise<string>;

async function readPasswordFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      resolve(data.trim());
    });
    // If stdin is already closed / not a pipe, resume to get the end event.
    process.stdin.resume();
  });
}

export interface CmdDeps {
  passwordReader?: PasswordReader;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

function makeIo(deps: CmdDeps) {
  return {
    out: deps.stdout ?? ((s: string) => process.stdout.write(s)),
    err: deps.stderr ?? ((s: string) => process.stderr.write(s)),
  };
}

export async function cmdAddAccount(
  posArgs: string[],
  rawArgs: string[],
  deps: CmdDeps = {},
): Promise<number> {
  const { out, err } = makeIo(deps);

  const name = posArgs[0];
  if (!name) {
    err('add-account: missing account name\n');
    return 1;
  }

  let parseResult: ReturnType<typeof parseArgs>;

  try {
    parseResult = parseArgs({
      args: rawArgs,
      options: {
        host: { type: 'string' },
        port: { type: 'string' },
        tls: { type: 'boolean', default: true },
        'no-tls': { type: 'boolean' },
        nick: { type: 'string' },
        username: { type: 'string' },
        realname: { type: 'string' },
        sasl: { type: 'string' },
        account: { type: 'string' },
        channels: { type: 'string' },
        default: { type: 'boolean' },
        'password-stdin': { type: 'boolean' },
      },
      strict: false,
    });
  } catch (e) {
    err(`add-account: ${String(e)}\n`);
    return 1;
  }

  const vals = parseResult.values;

  if (!vals.host) {
    err('add-account: --host is required\n');
    return 1;
  }
  if (!vals.nick) {
    err('add-account: --nick is required\n');
    return 1;
  }

  const tls = vals['no-tls'] ? false : ((vals.tls as boolean | undefined) ?? true);
  const port = vals.port ? parseInt(vals.port as string, 10) : 6697;
  if (isNaN(port)) {
    err('add-account: --port must be a number\n');
    return 1;
  }

  let saslConfig: AccountConfig['sasl'] = null;
  const saslMech = vals.sasl as string | undefined;
  if (saslMech) {
    const validMechs = ['PLAIN', 'EXTERNAL', 'SCRAM-SHA-256'] as const;
    const upper = saslMech.toUpperCase() as (typeof validMechs)[number];
    if (!validMechs.includes(upper)) {
      err(
        `add-account: invalid SASL mechanism '${saslMech}'; use PLAIN, EXTERNAL, or SCRAM-SHA-256\n`,
      );
      return 1;
    }
    saslConfig = {
      mech: upper,
      account: (vals.account as string | undefined) ?? (vals.nick as string),
    };
  }

  const channels = vals.channels
    ? (vals.channels as string)
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean)
    : [];

  const acc: AccountConfig = {
    name,
    host: vals.host as string,
    port,
    tls,
    nick: vals.nick as string,
    username: vals.username as string | undefined,
    realname: vals.realname as string | undefined,
    sasl: saslConfig,
    channels,
    default: vals.default as boolean | undefined,
    allowRaw: true,
  };

  let password: string | undefined;
  if (vals['password-stdin']) {
    const reader = deps.passwordReader ?? readPasswordFromStdin;
    password = await reader();
  }

  saveAccount(acc);

  if (password !== undefined && saslConfig) {
    setSecret(name, password);
  }

  out(`Account '${name}' saved (${acc.host}:${acc.port}, nick: ${acc.nick})\n`);
  return 0;
}

export function cmdList(deps: CmdDeps = {}): number {
  const { out } = makeIo(deps);
  const accounts = listAccounts();
  if (accounts.length === 0) {
    out('No accounts configured.\n');
    return 0;
  }
  for (const a of accounts) {
    const defTag = a.default ? '  [default]' : '';
    out(`${a.name}  ${a.host}:${a.port}  ${a.nick}${defTag}\n`);
  }
  return 0;
}

export function cmdRemove(name: string | undefined, deps: CmdDeps = {}): number {
  const { out, err } = makeIo(deps);
  if (!name) {
    err('remove: missing account name\n');
    return 1;
  }
  const removed = removeAccount(name);
  if (!removed) {
    err(`remove: account '${name}' not found\n`);
    return 1;
  }
  deleteSecret(name);
  out(`Account '${name}' removed.\n`);
  return 0;
}

async function cmdConfigure(deps: CmdDeps = {}): Promise<number> {
  const { err } = makeIo(deps);
  if (!process.stdin.isTTY) {
    err('configure: requires an interactive terminal (TTY)\n');
    return 1;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  const askMasked = (q: string): Promise<string> =>
    new Promise((res) => {
      // Suppress echoing by suppressing the output stream temporarily.
      const output = (rl as unknown as { output: NodeJS.WriteStream }).output;
      process.stdout.write(q);
      output.write = () => true;
      rl.once('line', (ans: string) => {
        output.write = process.stdout.write.bind(process.stdout);
        process.stdout.write('\n');
        res(ans);
      });
    });

  try {
    const name = await ask('Account name: ');
    const host = await ask('Host: ');
    const portStr = await ask('Port [6697]: ');
    const port = portStr ? parseInt(portStr, 10) : 6697;
    const tlsStr = await ask('TLS? [Y/n]: ');
    const tls = tlsStr.toLowerCase() !== 'n';
    const nick = await ask('Nick: ');
    const username = await ask('Username (ident) []: ');
    const realname = await ask('Realname []: ');
    const saslStr = await ask('SASL mech (PLAIN/EXTERNAL/SCRAM-SHA-256, or none) [none]: ');
    let saslConfig: AccountConfig['sasl'] = null;
    let password: string | undefined;
    if (saslStr && saslStr.toLowerCase() !== 'none') {
      const mechUpper = saslStr.toUpperCase() as AccountConfig['sasl'] extends null
        ? never
        : NonNullable<AccountConfig['sasl']>['mech'];
      const saslAccount = await ask(`SASL account [${nick}]: `);
      saslConfig = {
        mech: mechUpper as 'PLAIN' | 'EXTERNAL' | 'SCRAM-SHA-256',
        account: saslAccount || nick,
      };
      password = await askMasked('Password (hidden): ');
    }
    const channelsStr = await ask('Channels (comma-separated, or blank) []: ');
    const channels = channelsStr
      ? channelsStr
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    const defaultStr = await ask('Set as default? [y/N]: ');
    const isDefault = defaultStr.toLowerCase() === 'y';

    const acc: AccountConfig = {
      name,
      host,
      port,
      tls,
      nick,
      username: username || undefined,
      realname: realname || undefined,
      sasl: saslConfig,
      channels,
      default: isDefault || undefined,
      allowRaw: true,
    };

    saveAccount(acc);
    if (password && saslConfig) {
      setSecret(name, password);
    }
    process.stdout.write(`Account '${name}' configured.\n`);
    return 0;
  } finally {
    rl.close();
  }
}

async function cmdTest(name: string | undefined, deps: CmdDeps = {}): Promise<number> {
  const { out, err } = makeIo(deps);
  if (!name) {
    err('test: missing account name\n');
    return 1;
  }

  let acc: AccountConfig;
  try {
    acc = getAccount(name);
  } catch (e) {
    err(`test: ${String(e)}\n`);
    return 1;
  }

  const password = getSecret(name);

  const client = new IrcClient({
    host: acc.host,
    port: acc.port,
    tls: acc.tls,
    nick: acc.nick,
    username: acc.username,
    realname: acc.realname,
    sasl:
      acc.sasl && password ? { mech: acc.sasl.mech, account: acc.sasl.account, password } : null,
    channels: acc.channels,
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Connection timed out after 20s')), 20_000),
  );

  try {
    await Promise.race([client.connect(), timeout]);
    out(`Connected as ${client.nick}\n`);
    out(`Enabled caps: ${Array.from(client.enabledCaps).join(', ')}\n`);
    client.quit();
    return 0;
  } catch (e) {
    err(`test: ${String(e)}\n`);
    return 1;
  }
}

export async function run(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === '--version' || first === '-v') {
    process.stdout.write(`ircv3-mcp ${VERSION}\n`);
    return 0;
  }

  if (first === '--help' || first === '-h' || first === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  if (first === 'add-account') {
    const name = argv[1];
    return cmdAddAccount(name ? [name] : [], argv.slice(2), {});
  }

  if (first === 'list') {
    return cmdList({});
  }

  if (first === 'remove') {
    return cmdRemove(argv[1], {});
  }

  if (first === 'configure') {
    return cmdConfigure({});
  }

  if (first === 'test') {
    return cmdTest(argv[1], {});
  }

  // Default: serve (or explicit 'serve' command)
  if (first === undefined || first === 'serve') {
    if (argv.includes('--http')) {
      process.stderr.write('HTTP transport not implemented yet\n');
      return 1;
    }
    await runStdio();
    return 0;
  }

  process.stderr.write(`ircv3-mcp: unknown command '${first}'. Try --help.\n`);
  return 1;
}

run(process.argv.slice(2)).then((code) => {
  if (code) process.exitCode = code;
});
