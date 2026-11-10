import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from '../server/zip.js';

test('crc32 ตรงกับค่ามาตรฐาน', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('buildZip: โครงสร้างถูก (ลายเซ็น/จำนวนไฟล์/ตำแหน่ง central directory)', () => {
  const files = [
    { name: 'ext/a.txt', data: Buffer.from('hello') },
    { name: 'ext/ไทย.js', data: Buffer.from('x') },
  ];
  const zip = buildZip(files, new Date(2026, 10, 10, 12, 0, 0));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const end = zip.subarray(zip.length - 22);
  assert.equal(end.readUInt32LE(0), 0x06054b50);
  assert.equal(end.readUInt16LE(10), 2);
  const centralOffset = end.readUInt32LE(16);
  assert.equal(zip.readUInt32LE(centralOffset), 0x02014b50);
  // ข้อมูลไฟล์แรกอยู่ต่อจาก header 30 byte + ชื่อไฟล์
  const nameLen = zip.readUInt16LE(26);
  assert.equal(zip.subarray(30 + nameLen, 30 + nameLen + 5).toString(), 'hello');
});
