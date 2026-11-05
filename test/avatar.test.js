import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanGesture,
  cleanLook,
  cleanPose,
  createPerSecondLimiter,
  LOOK_PARTS,
  randomLook,
  ROOM_HALF_X,
  SEAT_COUNT,
  spawnPose,
} from '../server/avatar.js';

const inRange = (look) => Object.entries(LOOK_PARTS).every(([k, n]) => Number.isInteger(look[k]) && look[k] >= 0 && look[k] < n);

test('randomLook: ทุกส่วนอยู่ในช่วงตัวเลือก', () => {
  for (let i = 0; i < 50; i += 1) assert.ok(inRange(randomLook()));
  assert.deepEqual(randomLook(() => 0), { body: 0, skin: 0, hat: 0, face: 0 });
});

test('cleanLook: เก็บค่าที่ถูก แทนค่าที่ผิดด้วยค่าสุ่ม ตัด key แปลกทิ้ง', () => {
  const look = cleanLook({ body: 3, skin: 99, hat: -1, face: 1.5, evil: 'x' }, () => 0);
  assert.deepEqual(look, { body: 3, skin: 0, hat: 0, face: 0 });
  assert.ok(inRange(cleanLook('nope')));
  assert.ok(inRange(cleanLook(null)));
});

test('cleanPose: บีบให้อยู่ในห้อง ปัดทศนิยม หมุนมุมให้อยู่ 0..2π', () => {
  const pose = cleanPose({ x: 999, z: -1.23456, ry: -Math.PI / 2, sit: 2 });
  assert.equal(pose.x, ROOM_HALF_X);
  assert.equal(pose.z, -1.23);
  assert.ok(Math.abs(pose.ry - (3 * Math.PI) / 2) < 0.01);
  assert.equal(pose.sit, 2);
});

test('cleanPose: ค่าไม่ใช่ตัวเลข → null · ที่นั่งเกินช่วง → ไม่นั่ง', () => {
  assert.equal(cleanPose({ x: Number.NaN, z: 0, ry: 0 }), null);
  assert.equal(cleanPose({ x: '1', z: 0, ry: 0 }), null);
  assert.equal(cleanPose(undefined), null);
  assert.equal(cleanPose({ x: 0, z: 0, ry: 0, sit: SEAT_COUNT }).sit, null);
  assert.equal(cleanPose({ x: 0, z: 0, ry: 0, sit: '1' }).sit, null);
});

test('cleanGesture: รับเฉพาะท่าในรายการ', () => {
  assert.equal(cleanGesture('jump'), 'jump');
  assert.equal(cleanGesture('fly'), null);
  assert.equal(cleanGesture({ type: 'jump' }), null);
});

test('spawnPose: เกิดในห้องและไม่นั่ง', () => {
  const pose = spawnPose(() => 0.5);
  assert.ok(Math.abs(pose.x) <= ROOM_HALF_X);
  assert.equal(pose.sit, null);
});

test('createPerSecondLimiter: เกินโควต้าในวินาทีเดียวกันโดนปัด แล้วรีเซ็ตเมื่อขึ้นวินาทีใหม่', () => {
  const allow = createPerSecondLimiter(2);
  assert.equal(allow(0), true);
  assert.equal(allow(10), true);
  assert.equal(allow(20), false);
  assert.equal(allow(1000), true);
});
