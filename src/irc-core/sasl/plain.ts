export function buildPlain(authcid: string, passwd: string, authzid = ''): Buffer {
  return Buffer.from(`${authzid}\0${authcid}\0${passwd}`, 'utf8');
}

export function plainResponse(authcid: string, passwd: string, authzid = ''): string {
  return buildPlain(authcid, passwd, authzid).toString('base64');
}
