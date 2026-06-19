import { createHmac, createHash, pbkdf2Sync, randomBytes } from 'crypto';

function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

function escapeUsername(u: string): string {
  return u.replace(/=/g, '=3D').replace(/,/g, '=2C');
}

function randomNonce(): string {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = randomBytes(18);
  return Array.from(buf)
    .map((b) => alpha[b % alpha.length])
    .join('');
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

export class ScramSha256 {
  private username: string;
  private password: string;
  private clientNonce: string;
  private clientFirstBare = '';
  private serverSignature: Buffer | null = null;

  constructor(username: string, password: string, clientNonce?: string) {
    this.username = username;
    this.password = password;
    this.clientNonce = clientNonce ?? randomNonce();
  }

  clientFirst(): string {
    this.clientFirstBare = `n=${escapeUsername(this.username)},r=${this.clientNonce}`;
    return `n,,${this.clientFirstBare}`;
  }

  clientFinal(serverFirst: string): string {
    const attrs = parseAttrs(serverFirst);
    const r = attrs['r'];
    const s = attrs['s'];
    const i = attrs['i'];
    if (!r || !s || !i) throw new Error('SCRAM: malformed server-first');
    if (!r.startsWith(this.clientNonce))
      throw new Error('SCRAM: server nonce does not extend client nonce');

    const salt = Buffer.from(s, 'base64');
    const iterations = parseInt(i, 10);

    const clientFinalNoProof = `c=biws,r=${r}`;
    const authMessage = `${this.clientFirstBare},${serverFirst},${clientFinalNoProof}`;

    const saltedPassword = pbkdf2Sync(this.password, salt, iterations, 32, 'sha256');
    const clientKey = hmacSha256(saltedPassword, 'Client Key');
    const storedKey = sha256(clientKey);
    const clientSignature = hmacSha256(storedKey, authMessage);
    const clientProof = xorBuffers(clientKey, clientSignature);

    const serverKey = hmacSha256(saltedPassword, 'Server Key');
    this.serverSignature = hmacSha256(serverKey, authMessage);

    return `${clientFinalNoProof},p=${clientProof.toString('base64')}`;
  }

  serverSignatureValid(serverFinal: string): boolean {
    if (!this.serverSignature) return false;
    const attrs = parseAttrs(serverFinal);
    const v = attrs['v'];
    if (!v) return false;
    const got = Buffer.from(v, 'base64');
    if (got.length !== this.serverSignature.length) return false;
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got[i] ^ this.serverSignature[i];
    return diff === 0;
  }
}
