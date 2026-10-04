import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16X25 } from '../src/gt06/crc.js';
import { fromHex } from '../src/gt06/frame.js';

test('CRC-16/X-25 check value', () => {
  assert.equal(crc16X25(Buffer.from('123456789')), 0x906e);
});

test('matches the official GT06 login example (78 78 0D 01 ... 8C DD 0D 0A)', () => {
  const frame = fromHex('78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A');
  // CRC covers length byte .. serial number (index 2 .. 2+1+len-2)
  assert.equal(crc16X25(frame, 2, 2 + 1 + frame[2] - 2), 0x8cdd);
});

test('matches the official GT06 login ACK example (78 78 05 01 00 01 D9 DC 0D 0A)', () => {
  const frame = fromHex('78 78 05 01 00 01 D9 DC 0D 0A');
  assert.equal(crc16X25(frame, 2, 2 + 1 + frame[2] - 2), 0xd9dc);
});

test('empty input gives 0x0000 after final XOR (init FFFF ^ FFFF)', () => {
  assert.equal(crc16X25(Buffer.alloc(0)), 0x0000);
});
