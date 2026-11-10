// สร้างไฟล์ .zip แบบไม่บีบอัด (method 0 = store) — ใช้แจก extension ให้เพื่อนดาวน์โหลดจากเว็บ
// เขียนเองแทนการลง library เพราะต้องการแค่ "รวมไฟล์เล็กๆ ไม่กี่ไฟล์" ไฟล์รวมไม่ถึง 100KB ไม่ต้องบีบ
// รูปแบบ: [local header + ข้อมูล] ทีละไฟล์ → central directory → end record (spec: PKWARE APPNOTE 4.3)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// วันที่/เวลาแบบ MS-DOS ที่ zip ใช้ (ละเอียดแค่ 2 วินาที)
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const UTF8_FLAG = 0x0800; // ชื่อไฟล์เป็น UTF-8

/** files: [{ name, data: Buffer }] → Buffer ของไฟล์ zip */
export function buildZip(files, date = new Date()) {
  const { time, day } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // ต้องใช้ zip เวอร์ชัน 2.0
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// รวมทุกไฟล์ในโฟลเดอร์ (ไม่ลงโฟลเดอร์ย่อย — extension ไม่มี) ใส่ไว้ใต้โฟลเดอร์ชื่อ prefix ใน zip
export function zipFolder(dir, prefix) {
  const files = readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort()
    .map((name) => ({ name: `${prefix}/${name}`, data: readFileSync(join(dir, name)) }));
  return buildZip(files);
}
