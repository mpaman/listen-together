import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  act, attack, createArena, forfeit, joinQueue, leaveQueue, meleeHits, publicMatch,
  matchOf, MAX_MATCHES, queueNames, setPose, setPracticeWeapon, shotHits, slamHits, stepDuel, swapWeapon, winsOf,
} from '../server/duel.js';
import {
  ARENA_MAPS, inPillar, MAP_KINDS, SPAWNS,
  cleanLoadout, COUNTDOWN_MS, DEFAULT_LOADOUT, FIGHT_MS, HP_MAX, POTION, RESULT_MS, ROLL_IFRAME_MS, ROLL_MS, SHIELD, STAMINA, SWAP_MS, WEAPONS,
} from '../public/arena-rules.js';

// เริ่มแมตช์ A vs B แล้วข้ามนับถอยหลังให้เข้าช่วงสู้เลย
function fighting(t0 = 0) {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', t0);
  joinQueue(arena, 'b', 'B', t0);
  stepDuel(arena, t0 + COUNTDOWN_MS);
  // test เดิมเขียนไว้ตอนทุกคนเริ่มด้วยหมัด → ให้ถือหมัดก่อน แล้วแต่ละ test เปลี่ยนอาวุธเอง
  hold(arena.match, 'a', 'fists');
  hold(arena.match, 'b', 'fists');
  return { arena, match: arena.match, t: t0 + COUNTDOWN_MS };
}
// ใส่อาวุธให้ตรงๆ (เฉพาะใน test)
function hold(match, id, kind) {
  match.fighters[id].weapon = kind;
}
const place = (match, id, x, z, ry = 0, y = 0) => setPose(match, id, { x, y, z, ry });

test('คนเดียวกดเข้าคิว = รอ · คนที่สองกด = เริ่มแมตช์', () => {
  const arena = createArena({ map: 'stone' });
  assert.deepEqual(joinQueue(arena, 'a', 'A', 0), { queued: true });
  assert.deepEqual(queueNames(arena), ['A']);
  const res = joinQueue(arena, 'b', 'B', 0);
  assert.ok(res.match);
  assert.equal(res.match.phase, 'countdown');
  assert.deepEqual(queueNames(arena), []);
  assert.equal(res.match.fighters.a.hp, HP_MAX);
  assert.equal(res.match.fighters.a.weapon, DEFAULT_LOADOUT[0]); // เริ่มด้วยอาวุธหลัก
});

test('กดซ้ำไม่เข้าคิวสองรอบ · ยกเลิกคิวได้', () => {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'a', 'A', 0);
  assert.deepEqual(queueNames(arena), ['A']);
  assert.equal(leaveQueue(arena, 'a'), true);
  assert.deepEqual(queueNames(arena), []);
});

test('สู้ได้หลายคู่พร้อมกัน: คู่ที่สองเริ่มทันที · ตีกันข้ามแมตช์ไม่ได้ · จบแยกกัน', () => {
  const { arena, match: first, t } = fighting();
  joinQueue(arena, 'c', 'C', t);
  assert.deepEqual(queueNames(arena), ['C']);
  const res = joinQueue(arena, 'd', 'D', t);
  assert.ok(res.match);
  assert.equal(arena.matches.size, 2);
  assert.equal(matchOf(arena, 'c'), res.match);
  assert.equal(matchOf(arena, 'a'), first);
  assert.equal(joinQueue(arena, 'c', 'C', t).error, 'กำลังประลองอยู่');
  const end = forfeit(arena, 'a', t + 10);
  assert.equal(end[0].winner, 'B');
  assert.equal(end[0].matchId, first.id);
  assert.equal(res.match.phase, 'countdown'); // อีกคู่ไม่โดนผลกระทบ
  const events = stepDuel(arena, t + 10 + RESULT_MS);
  assert.deepEqual(events.filter((e) => e.type === 'close').map((e) => e.matchId), [first.id]);
  assert.deepEqual([...arena.matches.keys()], [res.match.id]);
});

test('ลานเต็ม (ครบ MAX_MATCHES) → คนที่เหลือรอคิว แล้วได้ลงเมื่อแมตช์ไหนปิด', () => {
  const arena = createArena({ map: 'stone' });
  for (let i = 0; i < MAX_MATCHES * 2; i += 1) joinQueue(arena, `p${i}`, `P${i}`, 0);
  assert.equal(arena.matches.size, MAX_MATCHES);
  joinQueue(arena, 'x', 'X', 0);
  joinQueue(arena, 'y', 'Y', 0);
  assert.deepEqual(queueNames(arena), ['X', 'Y']);
  forfeit(arena, 'p0', 10);
  const events = stepDuel(arena, 10 + RESULT_MS);
  assert.deepEqual(events.filter((e) => e.type !== 'phase').map((e) => e.type), ['close', 'start']);
  assert.ok(matchOf(arena, 'x'));
  assert.deepEqual(queueNames(arena), []);
});

test('ช่วงนับถอยหลังยังตีไม่ได้', () => {
  const arena = createArena({ map: 'stone' });
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
  const { arena, match, t } = fighting();
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.2, Math.PI);
  const swing = attack(match, 'a', 0, t);
  assert.equal(swing.weapon, 'fists');
  assert.equal(attack(match, 'a', 0, t + 10), null); // ยังติด cooldown
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
  hold(match, 'a', 'hammer');
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.5, Math.PI);
  attack(match, 'a', 0, t);
  place(match, 'b', 5, 1.5, Math.PI); // วิ่งหนีทัน
  const events = stepDuel(arena, t + WEAPONS.hammer.windup);
  assert.equal(events.some((e) => e.type === 'hit'), false);
});

test('ลูกธนูบินไปโดนคนที่ยืนอยู่ไกล · มีเสาบังแล้วไม่โดน', () => {
  const { arena, match, t } = fighting();
  hold(match, 'a', 'bow');
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
  assert.deepEqual(events.find((e) => e.type === 'end'), { type: 'end', winner: 'A', winnerId: 'a', reason: 'ko', matchId: match.id });
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

test('เลือกอาวุธหลัก/รองก่อนเข้าลาน · เริ่มด้วยอาวุธหลัก · ค่าผิดใช้ชุดเริ่มต้น', () => {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0, ['hammer', 'staff']);
  joinQueue(arena, 'b', 'B', 0, ['spear', 'spear']); // ซ้ำกัน = ไม่ถูก
  assert.deepEqual(arena.match.fighters.a.loadout, ['hammer', 'staff']);
  assert.equal(arena.match.fighters.a.weapon, 'hammer');
  assert.deepEqual(arena.match.fighters.b.loadout, DEFAULT_LOADOUT);
  assert.deepEqual(cleanLoadout(['fists', 'bow']), DEFAULT_LOADOUT);
  assert.deepEqual(cleanLoadout('x'), DEFAULT_LOADOUT);
  assert.deepEqual(cleanLoadout(['axe', 'bow']), DEFAULT_LOADOUT); // อาวุธที่ถอดออกไปแล้ว (เครื่องที่ยังจำค่าเก่า)
});

test('สลับอาวุธ: ได้อีกอัน · ต้องรอแป๊บก่อนตี', () => {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0, ['sword', 'bow']);
  joinQueue(arena, 'b', 'B', 0);
  const t = COUNTDOWN_MS;
  stepDuel(arena, t);
  const match = arena.match;
  assert.deepEqual(swapWeapon(match, 'a', undefined, t), { weapon: 'bow', slot: 1 });
  assert.equal(attack(match, 'a', 0, t + 10), null);
  assert.ok(attack(match, 'a', 0, t + SWAP_MS));
  assert.equal(swapWeapon(match, 'a', 1, t + 2000), null); // ถืออันนี้อยู่แล้ว
});

test('สตามินา: ตี/บล็อกไม่ใช้ · กลิ้งใช้ · ไม่พอกลิ้งไม่ได้ · แดชปิดอยู่ · พักแล้วฟื้น', () => {
  const { arena, match, t } = fighting();
  hold(match, 'a', 'sword');
  attack(match, 'a', 0, t);
  act(match, 'a', 'block', t + 600, true);
  assert.equal(match.fighters.a.stamina, STAMINA.max);
  act(match, 'a', 'block', t + 700, false);
  assert.ok(act(match, 'a', 'roll', t + 800));
  assert.equal(match.fighters.a.stamina, STAMINA.max - STAMINA.roll);
  match.fighters.a.stamina = STAMINA.roll - 1;
  assert.equal(act(match, 'a', 'roll', t + 2000), null);
  assert.equal(act(match, 'a', 'dash', t + 2000), null);
  match.fighters.a.stamina = 0; // หมดเกลี้ยงก็ยังตีได้
  assert.ok(attack(match, 'a', 0, t + 2000));
  const before = match.fighters.a.stamina;
  stepDuel(arena, t + 800 + STAMINA.regenDelay + 100, 0.5);
  assert.ok(match.fighters.a.stamina > before);
});

test('กลิ้ง: ช่วงต้นโดนอะไรไม่เข้า · กลิ้งอยู่ตีไม่ได้', () => {
  const { arena, match, t } = fighting();
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1, Math.PI);
  attack(match, 'a', 0, t);
  assert.deepEqual(act(match, 'b', 'roll', t), { act: 'roll', ms: ROLL_MS });
  assert.equal(attack(match, 'b', Math.PI, t + 10), null);
  const events = stepDuel(arena, t + WEAPONS.fists.windup);
  assert.ok(events.some((e) => e.type === 'dodge' && e.target === 'b'));
  assert.equal(match.fighters.b.hp, HP_MAX);
  assert.ok(t + WEAPONS.fists.windup < t + ROLL_IFRAME_MS);
});

test('บล็อก: หันหน้ารับ = ดาเมจลด สตามินาไม่ลด · โดนจากข้างหลังบล็อกไม่ได้', () => {
  const { arena, match, t } = fighting();
  hold(match, 'a', 'sword');
  hold(match, 'b', 'sword');
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.2, Math.PI); // หันเข้าหา a
  assert.deepEqual(act(match, 'b', 'block', t, true), { act: 'block', on: true });
  attack(match, 'a', 0, t);
  const hit = stepDuel(arena, t + WEAPONS.sword.windup).find((e) => e.type === 'hit');
  assert.equal(hit.blocked, true);
  assert.ok(hit.dmg < WEAPONS.sword.dmg);
  assert.equal(hit.dmg, WEAPONS.sword.dmg - Math.round(WEAPONS.sword.dmg * WEAPONS.sword.guard));
  assert.equal(match.fighters.b.stamina, STAMINA.max);

  place(match, 'b', 0, 1.2, 0); // หันหลังให้
  attack(match, 'a', 0, t + 1000);
  const back = stepDuel(arena, t + 1000 + WEAPONS.sword.windup).find((e) => e.type === 'hit');
  assert.equal(back.blocked, false);
  assert.equal(back.dmg, WEAPONS.sword.dmg);
});

test('ค้อนทุบทะลุการบล็อกครึ่งหนึ่ง · บล็อกนานแค่ไหนการ์ดก็ไม่แตก', () => {
  const { arena, match, t } = fighting();
  hold(match, 'a', 'hammer');
  hold(match, 'b', 'sword');
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.5, Math.PI);
  act(match, 'b', 'block', t, true);
  match.fighters.b.stamina = 0;
  attack(match, 'a', 0, t);
  const events = stepDuel(arena, t + WEAPONS.hammer.windup);
  const hit = events.find((e) => e.type === 'hit');
  const cut = Math.round(WEAPONS.hammer.dmg * WEAPONS.sword.guard * (1 - WEAPONS.hammer.pierce));
  assert.equal(hit.blocked, true);
  assert.equal(hit.dmg, WEAPONS.hammer.dmg - cut);
  assert.equal(match.fighters.b.blocking, true);
  assert.ok(!events.some((e) => e.type === 'guardBreak'));
});

test('โล่ใหญ่: บล็อกได้โดนแค่ 1 · เสียสตามินาต่อครั้ง · ค้อนเสียเพิ่ม · สตามินาไม่พอกันได้แค่ครึ่ง', () => {
  const { arena, match, t } = fighting();
  hold(match, 'a', 'sword');
  hold(match, 'b', 'shield');
  place(match, 'a', 0, 0, 0);
  place(match, 'b', 0, 1.2, Math.PI);
  act(match, 'b', 'block', t, true);
  attack(match, 'a', 0, t);
  const hit = stepDuel(arena, t + WEAPONS.sword.windup).find((e) => e.type === 'hit');
  assert.equal(hit.blocked, true);
  assert.equal(hit.dmg, SHIELD.chip);
  assert.equal(match.fighters.b.stamina, STAMINA.max - SHIELD.cost);

  // ค้อนทะลุบล็อก → โล่ยังกันได้ แต่กินสตามินามากกว่า
  hold(match, 'a', 'hammer');
  match.fighters.b.stamina = STAMINA.max;
  attack(match, 'a', 0, t + 2000);
  const slam = stepDuel(arena, t + 2000 + WEAPONS.hammer.windup).find((e) => e.type === 'hit');
  assert.equal(slam.dmg, SHIELD.chip);
  assert.equal(match.fighters.b.stamina, STAMINA.max - Math.round(SHIELD.cost * (1 + 2 * WEAPONS.hammer.pierce)));

  // สตามินาหมด = กันได้แค่ guard ปกติของโล่
  hold(match, 'a', 'sword');
  match.fighters.b.stamina = 0;
  attack(match, 'a', 0, t + 4000);
  const weak = stepDuel(arena, t + 4000 + WEAPONS.sword.windup).find((e) => e.type === 'hit');
  assert.equal(weak.blocked, true);
  assert.equal(weak.dmg, WEAPONS.sword.dmg - Math.round(WEAPONS.sword.dmg * WEAPONS.shield.guard));
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
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0);
  assert.deepEqual(forfeit(arena, 'a', 1), []);
  assert.deepEqual(queueNames(arena), []);
});

test('ยาเติมเลือด: แมตช์ละ 2 ขวด · เลือดเข้าตอนดื่มเสร็จ · ระหว่างดื่มตี/กลิ้งไม่ได้ · เลือดเต็มดื่มไม่ได้', () => {
  const { arena, match, t } = fighting();
  const a = match.fighters.a;
  assert.equal(a.potions, POTION.count);
  assert.equal(act(match, 'a', 'heal', t), null); // เลือดเต็ม
  a.hp = 30;
  const res = act(match, 'a', 'heal', t);
  assert.deepEqual(res, { act: 'heal', ms: POTION.ms, potions: POTION.count - 1 });
  assert.equal(attack(match, 'a', 0, t + 100), null);
  assert.equal(act(match, 'a', 'roll', t + 100), null);
  assert.equal(act(match, 'a', 'heal', t + 100), null); // ดื่มซ้อนไม่ได้
  stepDuel(arena, t + POTION.ms - 50);
  assert.equal(a.hp, 30); // ยังไม่เสร็จ
  const events = stepDuel(arena, t + POTION.ms);
  assert.equal(a.hp, 30 + POTION.heal);
  assert.ok(events.some((e) => e.type === 'healed' && e.id === 'a' && e.gain === POTION.heal));
  assert.ok(attack(match, 'a', 0, t + POTION.ms + 1)); // ดื่มเสร็จตีได้
  // ขวดที่ 2 แล้วหมด
  a.hp = 10;
  const t2 = t + 5000;
  assert.ok(act(match, 'a', 'heal', t2));
  stepDuel(arena, t2 + POTION.ms);
  a.hp = 10;
  assert.equal(act(match, 'a', 'heal', t2 + POTION.ms + 10), null);
  assert.equal(publicMatch(match, t2).fighters[0].potions, 0);
});

test('เลือดเติมไม่เกินเต็ม', () => {
  const { arena, match, t } = fighting();
  match.fighters.a.hp = HP_MAX - 5;
  act(match, 'a', 'heal', t);
  stepDuel(arena, t + POTION.ms);
  assert.equal(match.fighters.a.hp, HP_MAX);
});

test('เปลี่ยนอาวุธได้เฉพาะโหมดลองอาวุธ · ชิ้นไหนก็ได้ · ซ้ำกับอีกช่อง = สลับช่อง', () => {
  const { match, t } = fighting();
  match.fighters.a.loadout = ['sword', 'bow'];
  assert.equal(setPracticeWeapon(match, 'a', 'hammer', t), null); // แมตช์จริงไม่ได้
  match.practice = true;
  assert.equal(setPracticeWeapon(match, 'a', 'nope', t), null);
  assert.deepEqual(setPracticeWeapon(match, 'a', 'hammer', t), { weapon: 'hammer', slot: 0 });
  assert.deepEqual(match.fighters.a.loadout, ['hammer', 'bow']);
  assert.equal(match.fighters.a.weapon, 'hammer');
  assert.equal(attack(match, 'a', 0, t + 10), null); // รอ SWAP_MS ก่อนตี
  setPracticeWeapon(match, 'a', 'bow', t + 1000);
  assert.deepEqual(match.fighters.a.loadout, ['bow', 'hammer']);
});

test('โหมดลองอาวุธ ยาไม่ลด', () => {
  const { match, t } = fighting();
  match.practice = true;
  match.fighters.a.hp = 50;
  assert.equal(act(match, 'a', 'heal', t).potions, POTION.count);
});

test('ลาน 3 แบบ: จุดเกิดกับกลางลานว่าง · สิ่งกีดขวางอยู่ในลาน · สุ่มทุกแมตช์', () => {
  assert.equal(MAP_KINDS.length, 3);
  for (const kind of MAP_KINDS) {
    const { obstacles } = ARENA_MAPS[kind];
    for (const s of SPAWNS) assert.ok(!inPillar(s.x, s.z, 0.6, obstacles), `${kind} จุดเกิดชน`);
    for (const o of obstacles) assert.ok(Math.abs(o.x) + o.sx < 9 && Math.abs(o.z) + o.sz < 9, `${kind} ออกนอกลาน`);
  }
  const arena = createArena();
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) {
    joinQueue(arena, `a${i}`, `A${i}`, 0);
    joinQueue(arena, `b${i}`, `B${i}`, 0);
    seen.add(arena.match.map);
    assert.equal(publicMatch(arena.match, 0).map, arena.match.map);
    arena.matches.clear();
  }
  assert.equal(seen.size, 3);
});

test('ลานซากปราสาท: ก้อนกลางลานบังลูกยิง · ลานหินยิงตรงกลางได้', () => {
  const arena = createArena({ map: 'ruins' });
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'b', 'B', 0);
  stepDuel(arena, COUNTDOWN_MS);
  const { match } = arena;
  hold(match, 'a', 'bow');
  place(match, 'a', 0, -6, 0);
  place(match, 'b', 0, 6, Math.PI);
  let now = COUNTDOWN_MS;
  attack(match, 'a', 0, now);
  const all = [];
  for (let i = 0; i < 40; i += 1, now += 50) all.push(...stepDuel(arena, now));
  assert.equal(all.find((e) => e.type === 'shotEnd')?.why, 'pillar');
  assert.equal(all.some((e) => e.type === 'hit'), false);
});
