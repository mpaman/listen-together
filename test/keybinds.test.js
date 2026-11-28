import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionOf, canBind, keyLabel, keyOf, mouseSwapped, resetKeys, setKey, setMouseSwap } from '../public/keybinds.js';

// ใน node ไม่มี localStorage → โมดูลต้องใช้ค่าเริ่มต้นได้โดยไม่พัง (เหมือนเบราว์เซอร์ที่ปิด storage)
test('ปุ่มเริ่มต้น: WASD เดิน · ลูกศรเดินได้เสมอ · ปุ่มที่ไม่ได้ผูก = null', () => {
  resetKeys();
  assert.equal(actionOf('KeyW'), 'up');
  assert.equal(actionOf('ArrowLeft'), 'left');
  assert.equal(actionOf('KeyF'), 'attack');
  assert.equal(actionOf('KeyZ'), null);
});

test('ตั้งปุ่มที่มีท่าอื่นใช้อยู่ = สลับกัน ไม่มีท่าไหนหลุดไม่มีปุ่ม', () => {
  resetKeys();
  assert.equal(setKey('attack', 'KeyJ'), true);
  assert.equal(actionOf('KeyJ'), 'attack');
  assert.equal(actionOf('KeyF'), null);
  assert.equal(setKey('roll', 'KeyJ'), 'attack'); // J เป็นของโจมตีอยู่ → โจมตีได้ Shift ของกลิ้งไปแทน
  assert.equal(keyOf('roll'), 'KeyJ');
  assert.equal(keyOf('attack'), 'ShiftLeft');
});

test('ห้ามผูก Esc/ลูกศร/ปุ่ม Windows · สลับเมาส์ · รีเซ็ตกลับค่าเดิม', () => {
  resetKeys();
  assert.equal(canBind('Escape'), false);
  assert.equal(canBind('ArrowUp'), false);
  assert.equal(setKey('jump', 'MetaLeft'), false);
  assert.equal(keyOf('jump'), 'Space');
  setMouseSwap(true);
  assert.equal(mouseSwapped(), true);
  resetKeys();
  assert.equal(mouseSwapped(), false);
});

test('ชื่อปุ่มที่โชว์', () => {
  assert.equal(keyLabel('KeyQ'), 'Q');
  assert.equal(keyLabel('Digit2'), '2');
  assert.equal(keyLabel('ShiftLeft'), 'Shift ซ้าย');
  assert.equal(keyLabel('Numpad5'), 'Num 5');
});

test('ค่าเริ่มต้นรอบ 7: Shift = กลิ้ง (ซ้าย/ขวาก็ได้) · Tab = ล็อกเป้า', () => {
  resetKeys();
  assert.equal(actionOf('ShiftLeft'), 'roll');
  assert.equal(actionOf('ShiftRight'), 'roll');
  assert.equal(actionOf('Tab'), 'lockon');
  assert.equal(actionOf('KeyC'), null);
  assert.equal(keyLabel('Tab'), 'Tab');
});
