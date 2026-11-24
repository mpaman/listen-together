import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeIndex, clampOffset, formatOffset, withOffset } from '../public/lyrics-core.js';

const lines = [{ t: 10 }, { t: 15 }, { t: 15 }, { t: 30 }];

test('activeIndex: ก่อนบรรทัดแรก = -1 · ตรงเวลาพอดีนับเป็นบรรทัดนั้น · เวลาซ้ำเอาตัวหลัง · เลยท้าย = บรรทัดสุดท้าย', () => {
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(activeIndex(lines, 10), 0);
  assert.equal(activeIndex(lines, 14.9), 0);
  assert.equal(activeIndex(lines, 15), 2);
  assert.equal(activeIndex(lines, 999), 3);
  assert.equal(activeIndex([], 5), -1);
});

test('clampOffset: ปัดทีละครึ่งวิ และไม่เกิน ±30', () => {
  assert.equal(clampOffset(1.26), 1.5);
  assert.equal(clampOffset(-0.2), 0);
  assert.equal(clampOffset(99), 30);
  assert.equal(clampOffset(-99), -30);
  assert.equal(clampOffset('abc'), 0);
});

test('withOffset: คืน object ใหม่ · 0 = ลบ · ตั้งซ้ำย้ายไปท้าย (ล่าสุด)', () => {
  const saved = { a: 1, b: 2 };
  const next = withOffset(saved, 'a', 3);
  assert.deepEqual(saved, { a: 1, b: 2 });
  assert.deepEqual(Object.keys(next), ['b', 'a']);
  assert.equal(next.a, 3);
  assert.deepEqual(withOffset(next, 'b', 0), { a: 3 });
});

test('withOffset: เก็บแค่ 200 เพลงล่าสุด', () => {
  let saved = {};
  for (let i = 0; i < 205; i += 1) saved = withOffset(saved, `v${i}`, 1);
  const keys = Object.keys(saved);
  assert.equal(keys.length, 200);
  assert.equal(keys[0], 'v5');
});

test('formatOffset: ข้อความบนปุ่มปรับเวลา', () => {
  assert.equal(formatOffset(0), 'ตรงเวลา');
  assert.equal(formatOffset(1.5), '+1.5 วิ');
  assert.equal(formatOffset(-2), '−2 วิ');
});
