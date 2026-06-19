import { IrcClient } from '../irc-core/client';
import type { IrcClientOptions } from '../irc-core/client';
import { getAccount, listAccounts } from '../config/store';
import { getSecret } from '../secrets/index';
import { addSecret } from '../log';
import type { AccountConfig } from '../config/schema';

export type ConnectFn = (acc: AccountConfig, password: string | null) => Promise<IrcClient>;

const defaultConnect: ConnectFn = async (acc, password) => {
  if (password) addSecret(password);
  const opts: IrcClientOptions = {
    host: acc.host,
    port: acc.port,
    tls: acc.tls,
    nick: acc.nick,
    username: acc.username,
    realname: acc.realname,
    channels: acc.channels,
    sasl: acc.sasl
      ? { mech: acc.sasl.mech, account: acc.sasl.account, password: password ?? '' }
      : null,
  };
  const c = new IrcClient(opts);
  await c.connect();
  return c;
};

export class SessionPool {
  private cache = new Map<string, IrcClient>();
  private pending = new Map<string, Promise<IrcClient>>();
  private connectFn: ConnectFn;

  constructor(opts?: { connect?: ConnectFn }) {
    this.connectFn = opts?.connect ?? defaultConnect;
  }

  get(name?: string): Promise<IrcClient> {
    const acc = getAccount(name);
    const cached = this.cache.get(acc.name);
    if (cached && cached.connected) return Promise.resolve(cached);

    const inflight = this.pending.get(acc.name);
    if (inflight) return inflight;

    const password = acc.sasl ? getSecret(acc.name) : null;
    const promise = this.connectFn(acc, password).then(
      (client) => {
        this.cache.set(acc.name, client);
        this.pending.delete(acc.name);
        return client;
      },
      (err: unknown) => {
        this.pending.delete(acc.name);
        throw err;
      },
    );
    this.pending.set(acc.name, promise);
    return promise;
  }

  status(): Array<{
    name: string;
    host: string;
    default: boolean;
    connected: boolean;
    state: 'connected' | 'idle';
    nick?: string;
  }> {
    return listAccounts().map((acc) => {
      const client = this.cache.get(acc.name);
      const connected = client?.connected ?? false;
      return {
        name: acc.name,
        host: acc.host,
        default: acc.default === true,
        connected,
        state: connected ? 'connected' : 'idle',
        nick: client?.nick,
      };
    });
  }

  async closeAll(): Promise<void> {
    const clients = [...this.cache.values()];
    this.cache.clear();
    await Promise.all(clients.map((c) => c.quit()));
  }
}
