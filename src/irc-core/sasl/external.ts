export function externalResponse(authzid = ''): string {
  return Buffer.from(authzid, 'utf8').toString('base64');
}
