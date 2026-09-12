// Loads social-agent/.env (if present) into process.env without overriding
// variables that are already set. No dependencies.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  const file = join(AGENT_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Copy social-agent/.env.example to social-agent/.env and fill it in, or export it in your shell.`
    );
  }
  return v;
}
