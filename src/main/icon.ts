import { deflateSync } from "node:zlib";
import { nativeImage, type NativeImage } from "electron";

function createPng(width: number, height: number, paint: (x: number, y: number) => number, rgb = [0, 0, 0]): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const alpha = paint(x, y);
      const offset = row + 1 + x * 4;
      raw[offset] = rgb[0];
      raw[offset + 1] = rgb[1];
      raw[offset + 2] = rgb[2];
      raw[offset + 3] = alpha;
    }
  }

    const crc32 = (buffer: Buffer) => {
    let crc = ~0;
    for (let i = 0; i < buffer.length; i += 1) {
      crc ^= buffer[i];
      for (let j = 0; j < 8; j += 1) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (~crc) >>> 0;
  };

  const chunk = (type: string, data: Buffer) => {
    const typeBuffer = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const payload = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function disc(x: number, y: number, cx: number, cy: number, radius: number): number {
  const d = Math.hypot(x - cx, y - cy);
  if (d <= radius - 0.4) return 255;
  if (d >= radius + 0.4) return 0;
  return Math.round((1 - (d - (radius - 0.4)) / 0.8) * 255);
}

function capsule(x: number, y: number, x1: number, y1: number, x2: number, y2: number, radius: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (length * length)));
  return disc(x, y, x1 + dx * t, y1 + dy * t, radius);
}

export function createTrayIcon(): NativeImage {
  const size = 18;
  const light = process.platform !== "darwin";
  const png = createPng(
    size,
    size,
    (x, y) => {
      const pivot = disc(x, y, 8.5, 3.2, 1.6);
      const rod1 = capsule(x, y, 8.5, 3.2, 6.2, 9.4, 1.05);
      const bob1 = disc(x, y, 6.2, 9.4, 2.1);
      const rod2 = capsule(x, y, 6.2, 9.4, 11.2, 15.2, 1.05);
      const bob2 = disc(x, y, 11.2, 15.2, 2.3);
      return Math.max(pivot, rod1, bob1, rod2, bob2);
    },
    light ? [236, 241, 248] : [0, 0, 0],
  );

  const image = nativeImage.createFromBuffer(png, { scaleFactor: 1 });
  if (process.platform === "darwin") image.setTemplateImage(true);
  return image;
}
