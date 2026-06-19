import { describe, it, expect } from 'vitest';
import { NUMERICS, numericName } from '../src/irc-core/numerics';

describe('NUMERICS', () => {
  it('maps RPL_WELCOME to 001', () => {
    expect(NUMERICS.RPL_WELCOME).toBe('001');
  });

  it('maps RPL_ISUPPORT to 005', () => {
    expect(NUMERICS.RPL_ISUPPORT).toBe('005');
  });

  it('maps RPL_NAMREPLY to 353', () => {
    expect(NUMERICS.RPL_NAMREPLY).toBe('353');
  });

  it('maps ERR_INPUTTOOLONG to 417', () => {
    expect(NUMERICS.ERR_INPUTTOOLONG).toBe('417');
  });

  it('maps RPL_LOGGEDIN to 900', () => {
    expect(NUMERICS.RPL_LOGGEDIN).toBe('900');
  });

  it('maps RPL_SASLSUCCESS to 903', () => {
    expect(NUMERICS.RPL_SASLSUCCESS).toBe('903');
  });

  it('maps RPL_MONONLINE to 730', () => {
    expect(NUMERICS.RPL_MONONLINE).toBe('730');
  });

  it('maps RPL_MONOFFLINE to 731', () => {
    expect(NUMERICS.RPL_MONOFFLINE).toBe('731');
  });

  it('maps RPL_SASLMECHS to 908', () => {
    expect(NUMERICS.RPL_SASLMECHS).toBe('908');
  });
});

describe('numericName', () => {
  it('reverse-looks up 001 to RPL_WELCOME', () => {
    expect(numericName('001')).toBe('RPL_WELCOME');
  });

  it('reverse-looks up 005 to RPL_ISUPPORT', () => {
    expect(numericName('005')).toBe('RPL_ISUPPORT');
  });

  it('reverse-looks up 903 to RPL_SASLSUCCESS', () => {
    expect(numericName('903')).toBe('RPL_SASLSUCCESS');
  });

  it('returns undefined for unknown code', () => {
    expect(numericName('999')).toBeUndefined();
  });
});
