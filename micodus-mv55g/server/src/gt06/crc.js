/**
 * CRC-16/X-25 — the "CRC-ITU" used by the GT06 / Concox protocol family.
 *
 *   polynomial 0x1021 (reflected 0x8408), init 0xFFFF, reflect in/out, final XOR 0xFFFF.
 *   Check value: crc16X25("123456789") === 0x906E.
 *
 * In a GT06 frame the CRC covers everything from the "packet length" field
 * through the "information serial number" field (start bytes excluded).
 */
export function crc16X25(buf, start = 0, end = buf.length) {
  let crc = 0xffff;
  for (let i = start; i < end; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0x8408 : crc >>> 1;
    }
  }
  return ~crc & 0xffff;
}
