import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_Y } from '../server/avatar.js';
import {
  AIR_STEP, blockedAt, cellAt, eachCell, groundAt, LEVEL, MAX_LEVEL, POND, STAGE, STEP_UP, supportAt,
} from '../public/lounge-terrain.js';

// ฟิสิกส์ใน public/lounge.js: กระโดดสูงสุด = v²/2g
const JUMP_HEIGHT = 7.6 ** 2 / (2 * 22);
const JUMP_LEVELS = Math.floor((JUMP_HEIGHT - AIR_STEP) / LEVEL); // ขึ้นได้กี่ขั้นด้วยการกระโดด 1 ครั้ง

test('เวที สระ ทางเดิน ต้องแบน (ที่นั่ง/ฟลอร์/จอ MV คิดว่าพื้นสูง 0)', () => {
  for (let x = STAGE.x0; x <= STAGE.x1; x += 0.5) {
    for (let z = STAGE.z0; z <= STAGE.z1; z += 0.5) assert.equal(groundAt(x, z), 0, `เวที ${x},${z}`);
  }
  for (let x = POND.x0; x < POND.x1; x += 1) assert.equal(groundAt(x + 0.5, POND.z0 + 0.5), 0);
  for (let z = 6; z < 18; z += 1) assert.equal(groundAt(0, z + 0.5), 0, `ทางเดินกลาง z=${z}`);
});

test('แมพมีความสูงจริง: ภูเขาสูง ≥ 8 ขั้น และมีช่องที่ยกสูงจำนวนมาก', () => {
  let raised = 0;
  let max = 0;
  eachCell((x, z, level) => {
    if (level > 0) raised += 1;
    max = Math.max(max, level);
  });
  assert.ok(max >= 8, `สูงสุด ${max}`);
  assert.ok(raised > 300, `ยกสูง ${raised} ช่อง`);
  assert.ok(max <= MAX_LEVEL && MAX_LEVEL * LEVEL + JUMP_HEIGHT <= MAX_Y, 'server ต้องรับ y ได้สูงพอ');
});

test('ขั้นเตี้ยเดินขึ้นเอง · ขั้นสูงต้องกระโดด · กระโดดได้ 2 ขั้นแต่ไม่ถึง 3', () => {
  assert.ok(STEP_UP >= LEVEL && STEP_UP < 2 * LEVEL);
  assert.equal(JUMP_LEVELS, 2);
});

test('supportAt: ยืนคร่อมขอบหน้าผา = ยืนบนช่องที่สูงกว่า · blockedAt กันเดินทะลุผนัง', () => {
  // หาขอบที่ต่างกัน ≥ 2 ขั้นสักที่
  let edge = null;
  eachCell((x, z, level) => {
    if (!edge && level >= 2 && cellAt(x - 1, z).level === 0) edge = { x, z, level };
  });
  assert.ok(edge, 'ต้องมีหน้าผาอย่างน้อย 1 จุด');
  const top = edge.level * LEVEL;
  assert.equal(supportAt(edge.x + 0.1, edge.z + 0.5), top); // เท้าเหยียบขอบบน
  assert.equal(groundAt(edge.x - 0.5, edge.z + 0.5), 0);
  assert.equal(blockedAt(edge.x + 0.1, edge.z + 0.5, 0), true); // จากพื้นเดินเข้าไม่ได้
  assert.equal(blockedAt(edge.x + 0.1, edge.z + 0.5, top), false);
  assert.equal(blockedAt(edge.x + 0.1, edge.z + 0.5, top - LEVEL, AIR_STEP), true); // ลอยไม่พ้นขอบ = ชน
});

// ไล่หาว่าจากเวทีไปถึงไหนได้บ้าง: เดิน/กระโดดไปช่องติดกัน หรือกระโดดข้ามช่องว่าง 1 ช่อง
function reachable() {
  const key = (x, z) => `${x},${z}`;
  const seen = new Set([key(0, 0)]);
  const queue = [[0, 0]];
  const steps = [];
  for (let dx = -2; dx <= 2; dx += 1) for (let dz = -2; dz <= 2; dz += 1) if (dx || dz) steps.push([dx, dz]);
  while (queue.length) {
    const [x, z] = queue.shift();
    const from = cellAt(x, z).level;
    for (const [dx, dz] of steps) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > 23 || Math.abs(nz) > 17 || seen.has(key(nx, nz))) continue;
      const to = cellAt(nx, nz).level;
      const far = Math.abs(dx) === 2 || Math.abs(dz) === 2;
      if (to - from > (far ? JUMP_LEVELS : Math.max(JUMP_LEVELS, 1))) continue;
      if (far && to < from - 4) continue; // กระโดดข้ามแล้วตกลงไปลึกมาก ไม่นับ (ไม่ใช่เส้นทางที่ตั้งใจ)
      seen.add(key(nx, nz));
      queue.push([nx, nz]);
    }
  }
  return (x, z) => seen.has(key(x, z));
}

test('ปีนถึงได้: ยอดเขาหิมะ · ที่ราบสูง · หอชมวิวบนเสากระโดด', () => {
  const can = reachable();
  let peak = null;
  eachCell((x, z, level, kind) => {
    if (kind === 'mountain' && (!peak || level > peak.level)) peak = { x, z, level };
  });
  assert.ok(can(peak.x, peak.z), `ยอดเขา ${peak.x},${peak.z} (${peak.level} ขั้น)`);
  assert.equal(cellAt(17, -12).kind, 'mesa');
  assert.ok(can(17, -12), 'ที่ราบสูง');
  assert.equal(cellAt(2, 12).level, 8);
  assert.ok(can(2, 12), 'หอชมวิว');
});

test('เสากระโดด: ขึ้นจากพื้นตรงๆ ไม่ได้ ต้องไต่ทีละต้น', () => {
  // ต้นที่ 3 ขึ้นไป (≥ 3 ขั้น) สูงเกินกระโดดจากพื้น
  assert.ok(cellAt(7, 16).level > JUMP_LEVELS);
  assert.equal(cellAt(6, 16).level, 0); // ระหว่างเสาเป็นช่องว่าง
});
