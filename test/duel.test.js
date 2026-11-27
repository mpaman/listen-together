import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attack, createArena, forfeit, joinQueue, leaveQueue, meleeHits, pickWeapon, publicMatch,
  queueNames, setPose, shotHits, slamHits, stepDuel, winsOf,
} from '../server/duel.js';
import { COUNTDOWN_MS, FIGHT_MS, HP_MAX, RESULT_MS, WEAPON_SPOTS, WEAPONS } from '../public/arena-rules.js';

// เริ่มแมตช์ A vs B แล้วข้ามนับถอยหลังให้เข้าช่วงสู้เลย
function fighting(t0 = 0) {
  const arena = createArena();
  joinQueue(arena, 'a', 'A', t0);
  joinQueue(arena, 'b', 'B', t0);
  stepDuel(arena, t0 + COUNTDOWN_MS);
  return { arena, match: arena.match, t: t0 + COUNTDOWN_MS };
}
const place = (match, id, x, z, ry = 0, y = 0) => setPose(match, id, { x, y, z, ry });

test('คนเดียวกดเข้าคิว = รอ · คนที่สองกด = เริ่มแมตช์', () => {
  const arena = createArena();
  assert.deepEqual(joinQueue(arena, 'a', 'A', 0), { queued: true });
  assert.deepEqual(queueNames(arena), ['A']);
  const res = joinQueue(arena, 'b', 'B', 0);
  assert.ok(res.match);
  assert.equal(res.match.phase, 'countdown');
  assert.deepEqual(queueNames(arena), []);
  assert.equal(res.match.fighters.a.hp, HP_MAX);
  assert.equal(res.match.fighters.a.weapon, 'fists');
});

test('กดซ้ำไม่เข้าคิวสองรอบ · ยกเลิกคิวได้', () => {
  const arena = createArena();
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'a', 'A', 0);
  assert.deepEqual(queueNames(arena), ['A']);
  assert.equal(leaveQueue(arena, 'a'), true);
  assert.deepEqual(queueNames(arena), []);
});

test('ลานไม่ว่าง → คนที่สามรอคิว แล้วได้เข้าเมื่อแมตช์ก่อนปิด', () => {
  const { arena, t } = fighting();
  joinQueue(arena, 'c', 'C', t);
  joinQueue(arena, 'd', 'D', t);
  assert.deepEqual(queueNames(arena), ['C', 'D']);
  const end = forfeit(arena, 'a', t + 10);
  assert.equal(end[0].winner, 'B');
  const events = stepDuel(arena, t + 10 + RESULT_MS);
  assert.deepEqual(events.map((e) => e.type), ['close', 'start']);
  assert.deepEqual(Object.keys(arena.match.fighters), ['c', 'd']);
});

test('ช่วงนับถอยหลังยังตีไม่ได้', () => {
  const arena = createArena();
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'b', 'B', 0);
  assert.equal(attack(arena.match, 'a', 0, 100), null);
});

test('ฟันโดนเมื่ออยู่ในระยะและอยู่ข้างหน้า · อยู่ข้างหลังไม่โดน', () => {
  const sword = WEAPONS.sword;
  const a = { x: 0, y: 0, z: 0 };
  assert.equal(meleeHits(a, { x: 0, y: 0, z: 1.5 }, 0, sword), true);
  assert.equal(meleeHits(a, { x: 0, y: 0, z: -1.5 }, 0, sword), false); // หลังเรา
  assert.equal(meleeHits(a, { x: 0, y: 0, z: 3 }, 0, sword), false); // ไกลไป
  assert.equal(meleeHits(a, { x: 0, y: 2, z: 1 }, 0, sword), false); // ลอยสูงเหนือหัว
});

test('หอกยาวกว่าดาบแต่แนวแคบกว่า', () => {
  const a = { x: 0, y: 0, z: 0 };
  assert.equal(meleeHits(a, { x: 0, y: 0, z: 3 }, 0, WEAPONS.spear), true);
  assert.equal(meleeHits(a, { x: 0, y: 0, z: 3 }, 0, WEAPONS.sword), false);
  const side = { x: 0.8, y: 0, z: 1.4 }; // เฉียง ~30° (ดาบกว้างข้างละ 40° · หอกแค่ 15°)
  assert.equal(meleeHits(a, side, 0, WEAPONS.sword), true);
  assert.equal(meleeHits(a, side, 0, WEAPONS.spear), false);
});

test('ค้อนทุบเป็นวงข้างหน้า · กระโดดหลบได้', () => {
  const a = { x: 0, y: 0, z: 0 };
  const hammer = WEAPONS.hammer;
  assert.equal(slamHits(a, { x: 1, y: 0, z: 2 }, 0, hammer), true);
  assert.equal(slamHits(a, { x: 1, y: 1, z: 2 }, 0, hammer), false);
  assert.equal(slamHits(a, { x: 0, y: 0, z: -2 }, 0, hammer), false);
});

test('ลูกธนูโดนตัว · ตีนลอยสูงกว่าลูก = ข้ามได้', () => {
  const shot = { x: 0, y: 1, z: 0 };
  assert.equal(shotHits(shot, { x: 0.3, y: 0, z: 0 }, 0.35), true);
  assert.equal(shotHits(shot, { x: 0, y: 1.3, z: 0 }, 0.35), false);
  assert.equal(shotHits(shot, { x: 2, y: 0, z: 0 }, 0.35), false);
});

test('ตีได้หลังง้างเสร็จ เลือดลดตามดาเมจ และติด cooldown', () => {
  const { match, t } = fighting();
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.2, Math.PI);
  const swing = attack(match, 'a', 0, t);
  assert.equal(swing.weapon, 'fists');
  assert.equal(attack(match, 'a', 0, t + 10), null); // ยังติด cooldown
  const arena = { match };
  assert.deepEqual(stepDuel(arena, t + 10), []); // ยังง้างไม่เสร็จ
  const events = stepDuel(arena, t + WEAPONS.fists.windup);
  const hit = events.find((e) => e.type === 'hit');
  assert.equal(hit.target, 'b');
  assert.equal(hit.hp, HP_MAX - WEAPONS.fists.dmg);
  assert.ok(hit.kz > 0.9); // กระเด็นออกไปทางที่โดนตี
  assert.ok(attack(match, 'a', 0, t + WEAPONS.fists.cooldown));
});

test('หลบออกจากระยะระหว่างคู่ง้าง = ไม่โดน', () => {
  const { arena, match, t } = fighting();
  pickWeaponAt(match, 'a', 'hammer');
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.5, Math.PI);
  attack(match, 'a', 0, t);
  place(match, 'b', 5, 1.5, Math.PI); // วิ่งหนีทัน
  const events = stepDuel(arena, t + WEAPONS.hammer.windup);
  assert.equal(events.some((e) => e.type === 'hit'), false);
});

test('ลูกธนูบินไปโดนคนที่ยืนอยู่ไกล · มีเสาบังแล้วไม่โดน', () => {
  const { arena, match, t } = fighting();
  pickWeaponAt(match, 'a', 'bow');
  place(match, 'a', 0, -6, 0);
  place(match, 'b', 0, 6, Math.PI);
  attack(match, 'a', 0, t);
  let now = t + WEAPONS.bow.windup;
  const all = [];
  for (let i = 0; i < 30; i += 1, now += 50) all.push(...stepDuel(arena, now));
  assert.ok(all.some((e) => e.type === 'shot'));
  assert.equal(all.find((e) => e.type === 'hit')?.target, 'b');

  // ยิงไปทางเสา (-4.5, -4.5) จากตรงกลาง → ลูกชนเสาก่อนถึงคนข้างหลังเสา
  place(match, 'a', 0, 0, 0);
  place(match, 'b', -7, -7, 0);
  const ry = Math.atan2(-1, -1);
  attack(match, 'a', ry, now);
  const later = [];
  for (let i = 0; i < 40; i += 1, now += 50) later.push(...stepDuel(arena, now));
  assert.equal(later.find((e) => e.type === 'shotEnd')?.why, 'pillar');
  assert.equal(later.some((e) => e.type === 'hit'), false);
});

test('เลือดหมด = จบ ชนะน็อก · นับสถิติชนะ · ครบเวลาโชว์ผลแล้วปิดลาน', () => {
  const { arena, match, t } = fighting();
  match.fighters.b.hp = 3;
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1, Math.PI);
  attack(match, 'a', 0, t);
  const events = stepDuel(arena, t + 100);
  assert.deepEqual(events.find((e) => e.type === 'end'), { type: 'end', winner: 'A', winnerId: 'a', reason: 'ko' });
  assert.equal(match.phase, 'over');
  assert.deepEqual(winsOf(arena, ['A', 'B']), { A: 1, B: 0 });
  assert.equal(attack(match, 'b', 0, t + 2000), null); // จบแล้วตีต่อไม่ได้
  assert.deepEqual(stepDuel(arena, t + 100 + RESULT_MS).map((e) => e.type), ['close']);
  assert.equal(arena.match, null);
});

test('หมดเวลา: เลือดมากกว่าชนะ · เท่ากัน = เสมอ', () => {
  const one = fighting();
  one.match.fighters.a.hp = 40;
  const end = stepDuel(one.arena, one.t + FIGHT_MS).find((e) => e.type === 'end');
  assert.equal(end.winner, 'B');
  assert.equal(end.reason, 'time');

  const two = fighting();
  const draw = stepDuel(two.arena, two.t + FIGHT_MS).find((e) => e.type === 'end');
  assert.equal(draw.winner, null);
});

test('เก็บอาวุธต้องอยู่ใกล้ · ถืออยู่แล้วเก็บอันใหม่ = ของเก่าหล่นที่เท้า', () => {
  const { match } = fighting();
  const sword = match.weapons.find((w) => w.kind === 'sword');
  place(match, 'a', 5, 5);
  assert.equal(pickWeapon(match, 'a', sword.id), null);
  place(match, 'a', sword.x, sword.z + 0.5);
  assert.deepEqual(pickWeapon(match, 'a', sword.id), { weapon: 'sword', dropped: null });
  const hammer = match.weapons.find((w) => w.kind === 'hammer');
  place(match, 'a', hammer.x, hammer.z);
  const res = pickWeapon(match, 'a', hammer.id);
  assert.equal(res.weapon, 'hammer');
  assert.equal(res.dropped.kind, 'sword');
  assert.equal(match.weapons.length, WEAPON_SPOTS.length - 1);
});

test('ตำแหน่ง: บีบให้อยู่ในลาน · ยืนในเสาไม่ได้ · ค่าแปลกทิ้ง', () => {
  const { match } = fighting();
  assert.equal(place(match, 'a', 99, 0).x < 9, true);
  assert.equal(place(match, 'a', -4.5, -4.5), null);
  assert.equal(setPose(match, 'a', { x: NaN, z: 0, ry: 0 }), null);
  assert.equal(setPose(match, 'zzz', { x: 0, z: 0, ry: 0 }), null);
});

test('publicMatch บอกเวลาที่เหลือเป็น ms (ไม่ส่งนาฬิกา server)', () => {
  const { match, t } = fighting();
  const pub = publicMatch(match, t + 1000);
  assert.equal(pub.phase, 'fight');
  assert.equal(pub.msLeft, FIGHT_MS - 1000);
  assert.deepEqual(pub.fighters.map((f) => f.name), ['A', 'B']);
});

test('หลุดตอนอยู่ในคิว = แค่ออกจากคิว ไม่มีแมตช์จบ', () => {
  const arena = createArena();
  joinQueue(arena, 'a', 'A', 0);
  assert.deepEqual(forfeit(arena, 'a', 1), []);
  assert.deepEqual(queueNames(arena), []);
});

function pickWeaponAt(match, id, kind) {
  const spot = match.weapons.find((w) => w.kind === kind);
  const keep = { ...match.fighters[id].pose };
  place(match, id, spot.x, spot.z);
  pickWeapon(match, id, spot.id);
  place(match, id, keep.x, keep.z, keep.ry);
}
