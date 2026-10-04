import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameParser, fromHex, hex, parseFrame, splitFrames } from '../src/gt06/frame.js';
import { buildFrame } from '../src/gt06/encode.js';

const LOGIN = '78 78 0D 01 01 23 45 67 89 01 23 45 00 01 8C DD 0D 0A';

test('parseFrame extracts fields of a basic frame', () => {
  const f = parseFrame(fromHex(LOGIN));
  assert.equal(f.ext, false);
  assert.equal(f.length, 0x0d);
  assert.equal(f.type, 0x01);
  assert.equal(hex(f.content), '01 23 45 67 89 01 23 45');
  assert.equal(f.serial, 1);
  assert.equal(f.crc, 0x8cdd);
  assert.equal(f.crcOk, true);
});

test('bad CRC is flagged, not thrown', () => {
  const f = parseFrame(fromHex(LOGIN.replace('8C DD', '8C DE')));
  assert.equal(f.crcOk, false);
});

test('stream split across arbitrary chunk boundaries', () => {
  const a = buildFrame(0x13, Buffer.from([0x40, 0x06, 0x04, 0x00, 0x02]), 7);
  const b = buildFrame(0x94, Buffer.from([0x00, 0x04, 0xd2]), 8, { ext: true });
  const stream = Buffer.concat([a, b, a]);
  const parser = new FrameParser();
  const got = [];
  for (let i = 0; i < stream.length; i += 3) got.push(...parser.feed(stream.subarray(i, Math.min(i + 3, stream.length))));
  assert.equal(got.length, 3);
  assert.deepEqual(got.map((f) => f.type), [0x13, 0x94, 0x13]);
  assert.equal(got[1].ext, true);
  assert.equal(parser.garbage, 0);
  assert.equal(parser.buf.length, 0);
});

test('garbage between frames is skipped and counted', () => {
  const a = buildFrame(0x13, Buffer.from([0x40, 0x06, 0x04, 0x00, 0x02]), 7);
  const stream = Buffer.concat([Buffer.from('hello'), a, Buffer.from([0x00, 0x78]), a]);
  const { frames, garbage, leftover } = splitFrames(stream);
  assert.equal(frames.length, 2);
  assert.equal(garbage, 7); // "hello" (5) + 0x00 + the stray 0x78 in front of the second frame
  assert.equal(leftover, 0);
});

test('a false start marker inside a payload does not break resync', () => {
  // content contains 78 78 which must not be mistaken for a frame start
  const a = buildFrame(0x15, Buffer.from([0x05, 0, 0, 0, 0, 0x78, 0x78, 0x41, 0x00, 0x02]), 3);
  const { frames, garbage } = splitFrames(Buffer.concat([a, a]));
  assert.equal(frames.length, 2);
  assert.equal(garbage, 0);
});

test('truncated frame waits for more data', () => {
  const a = buildFrame(0x22, Buffer.alloc(30, 0x11), 9);
  const parser = new FrameParser();
  assert.equal(parser.feed(a.subarray(0, 10)).length, 0);
  assert.equal(parser.feed(a.subarray(10)).length, 1);
});

test('fromHex tolerates spacing, 0x prefixes and punctuation', () => {
  assert.equal(hex(fromHex('0x78,0x78 0d:01')), '78 78 0D 01');
});

test('extended frames (0x7979) carry a 2-byte length', () => {
  const big = buildFrame(0x21, Buffer.alloc(300, 0x41), 5);
  assert.equal(big[0], 0x79);
  assert.equal(big.readUInt16BE(2), 1 + 300 + 2 + 2);
  const f = parseFrame(big);
  assert.equal(f.ext, true);
  assert.equal(f.content.length, 300);
  assert.equal(f.crcOk, true);
});
