#!/usr/bin/env node
/**
 * Decode GT06-family hex from the command line.
 *
 *   node src/cli-decode.js "78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A"
 *   cat capture.hex | node src/cli-decode.js          (one or more frames per line)
 */
import { decodeHex } from './http-api.js';

function print(text) {
  const out = decodeHex(text);
  if (!out.frames.length) {
    console.log(JSON.stringify({ error: 'no complete frame found', bytes: out.bytes, garbage: out.garbage, leftover: out.leftover }));
    return;
  }
  for (const f of out.frames) console.log(JSON.stringify(f, null, 2));
  if (out.garbage || out.leftover) console.log(JSON.stringify({ note: 'bytes outside frames', garbage: out.garbage, leftover: out.leftover }));
}

const arg = process.argv.slice(2).join(' ').trim();
if (arg) {
  print(arg);
} else if (!process.stdin.isTTY) {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (data += c));
  process.stdin.on('end', () => {
    for (const line of data.split(/\r?\n/)) if (line.trim()) print(line);
  });
} else {
  console.error('usage: node src/cli-decode.js "<hex bytes>"   or   cat frames.hex | node src/cli-decode.js');
  process.exit(1);
}
