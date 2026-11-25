import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMatrix, quadInside, quadMatrix } from '../public/lounge-screen.js';

const near = (got, want) => {
  assert.ok(Math.abs(got[0] - want[0]) < 1e-6 && Math.abs(got[1] - want[1]) < 1e-6, `${got} ≠ ${want}`);
};

test('quadMatrix: มุมทั้ง 4 ของวิดีโอไปลงมุมของจอในฉากพอดี (ทั้งแบบคางหมูและแบบย่อธรรมดา)', () => {
  const w = 640;
  const h = 360;
  for (const quad of [
    [[100, 50], [500, 80], [480, 300], [120, 260]], // มองเฉียง → คางหมู
    [[10, 20], [330, 20], [330, 200], [10, 200]], // มองตรง → แค่ย่อ/เลื่อน
  ]) {
    const m = quadMatrix(w, h, quad);
    near(applyMatrix(m, 0, 0), quad[0]);
    near(applyMatrix(m, w, 0), quad[1]);
    near(applyMatrix(m, w, h), quad[2]);
    near(applyMatrix(m, 0, h), quad[3]);
  }
});

test('quadMatrix: มุมยุบเป็นเส้น → null', () => {
  assert.equal(quadMatrix(640, 360, [[0, 0], [10, 10], [20, 20], [30, 30]]), null);
});

test('quadInside: ล้นกรอบลาน → false', () => {
  assert.equal(quadInside([[0, 0], [10, 0], [10, 10], [0, 10]], 100, 100), true);
  assert.equal(quadInside([[0, -20], [10, 0], [10, 10], [0, 10]], 100, 100), false);
});
