import { Redactor } from './secrets/redactor';

const redactor = new Redactor();

export function addSecret(s: string): void {
  redactor.add(s);
}

function format(args: unknown[]): string {
  return args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
}

export function log(...args: unknown[]): void {
  process.stderr.write(redactor.redact(format(args)) + '\n');
}

export function error(...args: unknown[]): void {
  process.stderr.write(redactor.redact(format(args)) + '\n');
}
