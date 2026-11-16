// Minimal but structurally valid images for upload tests, each carrying metadata that must be
// removed: EXIF with a GPS block, XMP, comments and text chunks.
import { crc32 } from 'node:zlib';

const u16 = (n) => Buffer.from([n >> 8, n & 255]);
const seg = (marker, body) =>
  Buffer.concat([Buffer.from([0xff, marker]), u16(body.length + 2), body]);
export const SECRET = 'GPSLatitude 41.1575 N secret-location';

export function jpeg(width = 640, height = 480, { exif = true } = {}) {
  const parts = [Buffer.from([0xff, 0xd8])];
  parts.push(seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')));
  if (exif) {
    parts.push(seg(0xe1, Buffer.from(`Exif\0\0MM\0*${SECRET}`, 'latin1')));
    parts.push(
      seg(
        0xe1,
        Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRET}</x:xmpmeta>`, 'latin1'),
      ),
    );
    parts.push(seg(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`, 'latin1')));
    parts.push(seg(0xfe, Buffer.from(`comment ${SECRET}`, 'latin1')));
  }
  parts.push(seg(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01colour', 'latin1')));
  parts.push(seg(0xdb, Buffer.alloc(65, 1)));
  parts.push(
    seg(
      0xc0,
      Buffer.concat([Buffer.from([8]), u16(height), u16(width), Buffer.from([1, 1, 0x11, 0])]),
    ),
  );
  parts.push(seg(0xc4, Buffer.alloc(20, 2)));
  parts.push(seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])));
  parts.push(Buffer.alloc(200, 0x55), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
export function png(width = 640, height = 480) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('eXIf', Buffer.from(`MM\0*${SECRET}`, 'latin1')),
    chunk('tEXt', Buffer.from(`Comment\0${SECRET}`, 'latin1')),
    chunk('sRGB', Buffer.from([0])),
    chunk('IDAT', Buffer.alloc(100, 7)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const riff = (type, data) => {
  const head = Buffer.alloc(8);
  head.write(type, 0, 'latin1');
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};
export function webp(width = 640, height = 480) {
  const x = Buffer.alloc(10);
  x[0] = 0x08 | 0x04;
  x.writeUIntLE(width - 1, 4, 3);
  x.writeUIntLE(height - 1, 7, 3);
  const body = Buffer.concat([
    riff('VP8X', x),
    riff('VP8 ', Buffer.alloc(120, 9)),
    riff('EXIF', Buffer.from(`MM\0*${SECRET}`, 'latin1')),
    riff('XMP ', Buffer.from(`<x:xmpmeta>${SECRET}</x:xmpmeta>`, 'latin1')),
  ]);
  const head = Buffer.from('RIFF\0\0\0\0WEBP', 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  return Buffer.concat([head, body]);
}
