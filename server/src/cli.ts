#!/usr/bin/env node
// Entry point of the TypeScript port. It only reports its version for now; the
// server, CLI and MCP surfaces move here PR by PR (docs/port/plan.md).
import { readFileSync } from 'node:fs';

function packageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = typeof manifest === 'object' && manifest !== null ? (manifest as { version?: unknown }).version : undefined;
  if (typeof version !== 'string') throw new Error('package.json has no version');
  return version;
}

const usage = 'usage: reader-ts --version\n';
const [command, ...rest] = process.argv.slice(2);
if ((command === '--version' || command === '-V') && rest.length === 0) {
  process.stdout.write(`reader-ts ${packageVersion()}\n`);
} else if ((command === '--help' || command === '-h') && rest.length === 0) {
  process.stdout.write(usage);
} else {
  process.stderr.write(usage);
  process.exitCode = 2;
}
