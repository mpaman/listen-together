import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockedLine, BOT_LEVELS, botKitFor, isBotId, preferredRange, startBotMatch, tickBot } from '../server/duel-bot.js';
import { attack, createArena, forfeit, joinQueue, stepDuel } from '../server/duel.js';
import { COUNTDOWN_MS, inPillar } from '../public/arena-rules.js';

// สุ่มแบบกำหนดผลได้ เพื่อให้ test ซ้ำแล้วได้ผลเดิม
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

const LOOK = { body: 0, skin: 0, hat: 0, face: 0, back: 0, outfit: 0 };

// เดินเวลาแมตช์ไปเรื่อยๆ (บอทก่อน แล้วค่อยตัดสินดาเมจ เหมือน index.js)
function run(arena, from, ms, onTick) {
  let now = from;
  for (let t = 0; t < ms && arena.match; t += 50) {
    now += 50;
    onTick?.(now);
    tickBot(arena, now, 0.05);
    stepDuel(arena, now, 0.05);
  }
  return now;
}

test('เริ่มแมตช์ NPC ได้ตอนลานว่าง · มีบอทเป็นผู้เล่นคนที่ 2 พร้อมชุด', () => {
  const arena = createArena({ map: 'stone' });
  const res = startBotMatch(arena, 'a', 'Man', 'normal', 0, LOOK, seeded());
  assert.ok(res.match);
  const [, botId] = res.match.order;
  assert.ok(isBotId(botId));
  assert.equal(res.match.fighters[botId].name, BOT_LEVELS.normal.name);
  assert.deepEqual(res.match.fighters[botId].look, LOOK);
});

test('มีคนประลองอยู่ก็ยังสู้ NPC ได้ (หลายคนพร้อมกัน) · กำลังสู้อยู่/ระดับผิด → ไม่ได้', () => {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'b', 'B', 0);
  const c = startBotMatch(arena, 'c', 'C', 'normal', 0, LOOK);
  const d = startBotMatch(arena, 'd', 'D', 'dummy', 0, LOOK);
  assert.ok(c.match && d.match);
  assert.notEqual(c.match.botId, d.match.botId);
  assert.equal(arena.matches.size, 3);
  assert.ok(startBotMatch(arena, 'a', 'A', 'easy', 0, LOOK).error);
  assert.ok(startBotMatch(createArena({ map: 'stone' }), 'c', 'C', 'god', 0, LOOK).error);
  // บอทแต่ละแมตช์เดินของตัวเอง · ทุกเหตุการณ์บอกว่าเป็นของแมตช์ไหน
  const events = tickBot(arena, COUNTDOWN_MS + 100, 0.05);
  assert.deepEqual(new Set(events.filter((e) => e.type === 'pose').map((e) => e.matchId)), new Set([c.match.id, d.match.id]));
});

test('ชนะ NPC = นับชนะ (ได้มงกุฎ) · ลองอาวุธไม่นับ', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'easy', 0, LOOK);
  stepDuel(arena, COUNTDOWN_MS);
  match.fighters[match.botId].hp = 0;
  forfeit(arena, match.botId, COUNTDOWN_MS + 10); // บอทแพ้ (เหมือนเลือดหมด) → คนชนะ
  assert.equal(arena.wins.get('A'), 1);
});

test('แพ้ = มงกุฎหายหมด (ชนะติดกันเริ่มนับใหม่) · แพ้ NPC ก็หาย', () => {
  const arena = createArena({ map: 'stone' });
  arena.wins.set('A', 4);
  arena.wins.set('B', 2);
  joinQueue(arena, 'a', 'A', 0);
  joinQueue(arena, 'b', 'B', 0);
  forfeit(arena, 'b', 10); // B ออก = แพ้
  assert.equal(arena.wins.get('A'), 5);
  assert.equal(arena.wins.has('B'), false);
  const { match } = startBotMatch(arena, 'c', 'A', 'easy', 20, LOOK);
  forfeit(arena, 'c', 30); // A แพ้ NPC
  assert.equal(arena.wins.has('A'), false);
  assert.equal(match.winnerId, match.botId);
});

test('คนที่ต่อคิวหาคู่อยู่ ไปสู้ NPC → ออกจากคิวก่อน', () => {
  const arena = createArena({ map: 'stone' });
  joinQueue(arena, 'a', 'A', 0);
  startBotMatch(arena, 'a', 'A', 'easy', 0, LOOK);
  assert.equal(arena.queue.length, 0);
});

test('ช่วงนับถอยหลัง บอทไม่เดิน ไม่ตี', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'hard', 0, LOOK, seeded());
  const before = { ...match.fighters[match.botId].pose };
  for (let now = 50; now < COUNTDOWN_MS - 100; now += 50) tickBot(arena, now, 0.05);
  const after = match.fighters[match.botId].pose;
  assert.equal(after.x, before.x);
  assert.equal(after.z, before.z);
  assert.equal(match.pending.length, 0);
});

test('บอทเริ่มด้วยชุดอาวุธของตัวเอง แล้วตีคนที่ยืนนิ่งจนเลือดลด', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'normal', 0, LOOK, seeded(3));
  run(arena, 0, COUNTDOWN_MS + 20000);
  assert.notEqual(match.fighters[match.botId].weapon, 'fists');
  assert.ok(match.fighters.a.hp < 100, `เลือดคนยังเต็ม ${match.fighters.a.hp}`);
});

test('ระดับยากชนะคนที่ยืนเฉยได้ภายในเวลา · ไม่นับสถิติชนะ', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'hard', 0, LOOK, seeded(11));
  run(arena, 0, COUNTDOWN_MS + 90000);
  assert.equal(match.winner, BOT_LEVELS.hard.name);
  assert.equal(arena.wins.size, 0);
});

test('บอทไม่เดินทะลุเสา ไม่ออกนอกลาน', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'hard', 0, LOOK, seeded(5));
  run(arena, 0, COUNTDOWN_MS + 15000, () => {
    const p = match.fighters[match.botId].pose;
    assert.ok(!inPillar(p.x, p.z, 0.3), `อยู่ในเสา ${p.x},${p.z}`);
    assert.ok(Math.abs(p.x) <= 9 && Math.abs(p.z) <= 9);
  });
});

test('บอทระดับยากหลบค้อนที่ง้างใส่ได้บ่อยกว่าระดับง่าย', () => {
  // วางคนถือค้อนหน้าบอท ง้างทุกครั้งที่พร้อม นับว่าโดนกี่ที
  const hitsFor = (level) => {
    const arena = createArena({ map: 'stone' });
    const { match } = startBotMatch(arena, 'a', 'A', level, 0, LOOK, seeded(9));
    const me = match.fighters.a;
    const bot = match.fighters[match.botId];
    me.weapon = 'hammer';
    let hits = 0;
    let lastHp = bot.hp;
    run(arena, 0, COUNTDOWN_MS + 30000, (now) => {
      me.pose.x = bot.pose.x;
      me.pose.z = bot.pose.z - 1.5;
      me.pose.ry = 0;
      me.stamina = 100; // ให้คนทุบได้ตลอด วัดแค่การหลบของบอท
      me.hp = 100; // บอทตีกลับได้ ไม่ให้แมตช์จบก่อนนับครบ
      if (match.phase === 'fight') attack(match, 'a', 0, now);
      if (bot.hp < lastHp) hits += 1;
      lastHp = bot.hp;
      bot.hp = Math.max(bot.hp, 50); // ไม่ให้จบก่อนนับครบ
    });
    return hits;
  };
  const hard = hitsFor('hard');
  const easy = hitsFor('easy');
  assert.ok(hard < easy, `hard ${hard} easy ${easy}`);
});

test('เสาบังแนวยิง', () => {
  assert.equal(blockedLine({ x: -6, z: 4.5 }, { x: -2, z: 4.5 }), true);
  assert.equal(blockedLine({ x: 0, z: -6 }, { x: 0, z: 6 }), false);
});

test('ระยะที่บอทชอบ: ยิงไกลยืนห่าง ประชิดเข้าใกล้', () => {
  assert.ok(preferredRange('bow') > 5);
  assert.ok(preferredRange('dagger') < 1.5);
  assert.ok(preferredRange('spear') > preferredRange('sword'));
});

test('โหมดลองอาวุธ: หุ่นไม่เดิน ไม่ตี เลือดหมดแล้วฟื้น ไม่จบแมตช์ ไม่หมดเวลา', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'dummy', 0, LOOK, seeded());
  assert.equal(match.practice, true);
  const dummy = match.fighters[match.botId];
  const start = { ...dummy.pose };
  const me = match.fighters.a;
  me.weapon = 'hammer';
  run(arena, 0, COUNTDOWN_MS + 200000, (now) => {
    me.pose.x = dummy.pose.x;
    me.pose.z = dummy.pose.z - 1.5;
    if (match.phase === 'fight') attack(match, 'a', 0, now);
  });
  assert.equal(match.phase, 'fight');
  assert.equal(me.hp, 100);
  assert.ok(dummy.hp > 0);
  assert.equal(dummy.pose.x, start.x);
  assert.equal(arena.wins.size, 0);
});

test('บอทถืออาวุธยิงตอนอยู่ไกล สลับเป็นอาวุธประชิดตอนเข้าใกล้', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'normal', 0, LOOK, seeded(2));
  const bot = match.fighters[match.botId];
  bot.loadout = ['sword', 'bow'];
  const me = match.fighters.a;
  let now = run(arena, 0, COUNTDOWN_MS + 1500, () => { me.pose.x = 0; me.pose.z = 8; me.hp = 100; bot.pose.x = 0; bot.pose.z = -8; });
  assert.equal(bot.weapon, 'bow');
  run(arena, now, 1500, () => { me.pose.x = bot.pose.x; me.pose.z = bot.pose.z + 1.5; me.hp = 100; });
  assert.equal(bot.weapon, 'sword');
});

test('บอทถือโล่ใหญ่ยกโล่รับท่าฟันได้ (เดิมเช็คแค่ guard ≥ 0.6 → ไม่เคยยกโล่เลย)', () => {
  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'normal', 0, LOOK, seeded(3), undefined);
  const me = match.fighters.a;
  const bot = match.fighters[match.botId];
  Object.assign(bot, { loadout: ['shield', 'bow'], slot: 0, weapon: 'shield' });
  me.weapon = 'sword';
  let blocked = false;
  run(arena, 0, COUNTDOWN_MS + 15000, (now) => {
    me.pose.x = bot.pose.x;
    me.pose.z = bot.pose.z - 1.5;
    me.hp = 100;
    bot.hp = Math.max(bot.hp, 50);
    if (match.phase === 'fight') attack(match, 'a', 0, now);
    if (bot.blocking) blocked = true;
  });
  assert.ok(blocked);
});

test('เลือกอาวุธให้ NPC ได้ (ไว้ทดสอบ) · ช่องรองประเภทเดียวกัน บอทจะได้ไม่สลับ · ชื่อผิด = สุ่มตามเดิม', () => {
  assert.deepEqual(botKitFor('hammer'), ['hammer', 'sword']);
  assert.deepEqual(botKitFor('sword'), ['sword', 'dagger']);
  assert.deepEqual(botKitFor('bow'), ['bow', 'staff']);
  assert.deepEqual(botKitFor('staff'), ['staff', 'bow']);
  assert.equal(botKitFor('fists'), null);
  assert.equal(botKitFor('<script>'), null);
  assert.equal(botKitFor(undefined), null);

  const arena = createArena({ map: 'stone' });
  const { match } = startBotMatch(arena, 'a', 'A', 'normal', 0, LOOK, seeded(1), undefined, 'spear');
  assert.deepEqual(match.fighters[match.botId].loadout, ['spear', 'sword']);
  assert.equal(match.fighters[match.botId].weapon, 'spear');

  const other = createArena({ map: 'stone' });
  const { match: random } = startBotMatch(other, 'b', 'B', 'normal', 0, LOOK, seeded(1), undefined, 'nope');
  assert.ok(BOT_LEVELS.normal.kits.some((kit) => kit.join() === random.fighters[random.botId].loadout.join()));
});
