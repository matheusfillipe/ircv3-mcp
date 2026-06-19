import { describe, it, expect } from 'vitest';
import { ScramSha256 } from '../src/irc-core/sasl/scram';

// RFC 7677 test vector
const USERNAME = 'user';
const PASSWORD = 'pencil';
const CLIENT_NONCE = 'rOprNGfwEbeRWgbNEkqO';
const SERVER_FIRST =
  'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096';
const EXPECTED_CLIENT_FINAL_START = 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
const EXPECTED_PROOF_SUFFIX = 'p=dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=';
const SERVER_FINAL = 'v=6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=';

describe('ScramSha256', () => {
  it('clientFirst() matches RFC 7677 vector', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD, CLIENT_NONCE);
    expect(scram.clientFirst()).toBe(`n,,n=${USERNAME},r=${CLIENT_NONCE}`);
  });

  it('clientFinal() starts with correct c= and r= prefix', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD, CLIENT_NONCE);
    scram.clientFirst();
    const final = scram.clientFinal(SERVER_FIRST);
    expect(final.startsWith(EXPECTED_CLIENT_FINAL_START)).toBe(true);
  });

  it('clientFinal() ends with correct proof', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD, CLIENT_NONCE);
    scram.clientFirst();
    const final = scram.clientFinal(SERVER_FIRST);
    expect(final.endsWith(EXPECTED_PROOF_SUFFIX)).toBe(true);
  });

  it('serverSignatureValid() returns true for correct server-final', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD, CLIENT_NONCE);
    scram.clientFirst();
    scram.clientFinal(SERVER_FIRST);
    expect(scram.serverSignatureValid(SERVER_FINAL)).toBe(true);
  });

  it('serverSignatureValid() returns false for wrong v=', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD, CLIENT_NONCE);
    scram.clientFirst();
    scram.clientFinal(SERVER_FIRST);
    expect(scram.serverSignatureValid('v=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')).toBe(
      false,
    );
  });

  it('escapes = in username to =3D', () => {
    const scram = new ScramSha256('user=name', PASSWORD, CLIENT_NONCE);
    expect(scram.clientFirst()).toContain('n=user=3Dname');
  });

  it('escapes , in username to =2C', () => {
    const scram = new ScramSha256('user,name', PASSWORD, CLIENT_NONCE);
    expect(scram.clientFirst()).toContain('n=user=2Cname');
  });

  it('generates random nonce when none provided', () => {
    const scram = new ScramSha256(USERNAME, PASSWORD);
    const cf = scram.clientFirst();
    expect(cf.startsWith('n,,n=user,r=')).toBe(true);
    const nonce = cf.split('r=')[1];
    expect(nonce.length).toBeGreaterThan(0);
  });
});
