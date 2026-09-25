import { writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const size = 128;
const pixels = Buffer.alloc(size * (1 + size * 4));
for (let row = 0; row < size; row += 1) {
  for (let column = 0; column < size; column += 1) {
    const offset = row * (1 + size * 4) + 1 + column * 4;
    const paper = column >= 26 && column < 102 && row >= 30 && row < 104;
    const line = paper && row >= 47 && row <= 54;
    const check = (column >= 41 && column <= 59 && Math.abs(row - (column + 27)) < 5)
      || (column >= 57 && column <= 89 && Math.abs(row - (143 - column)) < 5);
    const color = paper && !line && !check ? [255, 255, 255, 255] : [163, 46, 62, 255];
    for (let channel = 0; channel < 4; channel += 1) pixels[offset + channel] = color[channel];
  }
}
function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const label = Buffer.from(name);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(checksum(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, crc]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
await writeFile(new URL('../extension/icon.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))
]));
