import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOM_HALF_X, ROOM_HALF_Z } from '../server/avatar.js';
import {
  createItemState,
  drop,
  groundList,
  isItemKind,
  ITEM_KINDS,
  MAX_GROUND_ITEMS,
  pickUp,
  PICK_RANGE,
  spawnTick,
  SPAWN_EVERY_MS,
} from '../server/items.js';

// rand ที่คืนค่าตามลำดับ (วนซ้ำ) ให้ผลลัพธ์แน่นอน
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};
const user = (x, z, held = null) => ({ pose: { x, z, ry: 0, sit: null }, held });

test('spawnTick: ยังไม่ครบเวลา → ไม่วาง · ครบแล้ว → วาง 1 ชิ้นในลาน นอกเวที', () => {
  const state = createItemState();
  const first = spawnTick(state, SPAWN_EVERY_MS, seq(0.95, 0.95, 0));
  assert.ok(first);
  assert.ok(isItemKind(first.kind));
  assert.ok(Math.abs(first.x) <= ROOM_HALF_X && Math.abs(first.z) <= ROOM_HALF_Z);
  assert.equal(spawnTick(state, SPAWN_EVERY_MS + 10, seq(0.9)), null, 'ยังไม่ครบรอบถัดไป');
  assert.equal(groundList(state).length, 1);
});

test('spawnTick: จุดสุ่มตกบนเวทีกลาง → สุ่มใหม่ ไม่วางบนเวที', () => {
  const state = createItemState();
  // 0.5,0.5 = กลางลาน (บนเวที) → ถัดไป 0.95,0.95 = มุมลาน
  const item = spawnTick(state, SPAWN_EVERY_MS, seq(0.5, 0.5, 0.95, 0.95, 0));
  assert.ok(item);
  assert.ok(item.x > 8 || item.z > 5, `ไม่ควรอยู่บนเวที: ${item.x},${item.z}`);
});

test('spawnTick: ของบนพื้นเต็มแล้ว → หยุดวาง', () => {
  const state = createItemState();
  let now = 0;
  for (let i = 0; i < MAX_GROUND_ITEMS + 3; i += 1) {
    now += SPAWN_EVERY_MS;
    spawnTick(state, now, seq(0.95, 0.95, 0.3));
  }
  assert.equal(state.ground.length, MAX_GROUND_ITEMS);
});

test('pickUp: ยืนใกล้ → ได้ของ ของหายจากพื้น', () => {
  const state = createItemState();
  const item = spawnTick(state, SPAWN_EVERY_MS, seq(0.95, 0.95, 0));
  const u = user(item.x + 0.5, item.z);
  const res = pickUp(state, u, item.id);
  assert.deepEqual(res, { held: ITEM_KINDS[0], dropped: null });
  assert.equal(u.held, ITEM_KINDS[0]);
  assert.equal(state.ground.length, 0);
});

test('pickUp: อยู่ไกลเกินระยะ / ไม่มีของชิ้นนั้น / ยังไม่มีตำแหน่ง → เก็บไม่ได้', () => {
  const state = createItemState();
  const item = spawnTick(state, SPAWN_EVERY_MS, seq(0.95, 0.95, 0));
  assert.equal(pickUp(state, user(item.x + PICK_RANGE + 0.1, item.z), item.id), null);
  assert.equal(pickUp(state, user(item.x, item.z), 999), null);
  assert.equal(pickUp(state, user(item.x, item.z), String(item.id)), null);
  assert.equal(pickUp(state, { held: null }, item.id), null);
  assert.equal(state.ground.length, 1, 'ของยังอยู่');
});

test('pickUp: คนแรกได้ คนที่สองที่เก็บชิ้นเดียวกันได้ null', () => {
  const state = createItemState();
  const item = spawnTick(state, SPAWN_EVERY_MS, seq(0.95, 0.95, 0));
  assert.ok(pickUp(state, user(item.x, item.z), item.id));
  assert.equal(pickUp(state, user(item.x, item.z), item.id), null);
});

test('pickUp: ถือของอยู่แล้ว → สลับ ของเก่าหล่นที่เท้า', () => {
  const state = createItemState();
  const item = spawnTick(state, SPAWN_EVERY_MS, seq(0.95, 0.95, 0));
  const u = user(item.x, item.z, 'guitar');
  const res = pickUp(state, u, item.id);
  assert.equal(res.held, 'sword');
  assert.equal(res.dropped.kind, 'guitar');
  assert.deepEqual([res.dropped.x, res.dropped.z], [u.pose.x, u.pose.z]);
  assert.notEqual(res.dropped.id, item.id, 'ของที่หล่นได้ id ใหม่');
  assert.deepEqual(groundList(state).map((g) => g.kind), ['guitar']);
});

test('drop: วางของที่ถือ · มือเปล่า → null', () => {
  const state = createItemState();
  const u = user(3, 4, 'mic');
  const item = drop(state, u);
  assert.deepEqual({ kind: item.kind, x: item.x, z: item.z }, { kind: 'mic', x: 3, z: 4 });
  assert.equal(u.held, null);
  assert.equal(drop(state, u), null);
});
