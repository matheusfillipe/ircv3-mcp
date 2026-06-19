const CHUNK = 400;

export function chunkAuthenticate(b64: string): string[] {
  if (b64.length === 0) return ['+'];

  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK) {
    chunks.push(b64.slice(i, i + CHUNK));
  }

  // When total length is an exact multiple of CHUNK, a trailing '+' signals end-of-data
  if (b64.length % CHUNK === 0) chunks.push('+');

  return chunks;
}
