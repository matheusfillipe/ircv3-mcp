export function redact(text: string, secrets: string[]): string {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    // Replace all occurrences (non-regex to avoid special-char issues)
    result = result.split(secret).join('***');
  }
  return result;
}

export class Redactor {
  private secrets: string[] = [];

  add(secret: string): void {
    if (secret) this.secrets.push(secret);
  }

  redact(text: string): string {
    return redact(text, this.secrets);
  }
}
