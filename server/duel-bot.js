// NPC คู่ซ้อมในลานประลอง: คิดบน server ทุก tick (ใช้กฎเดียวกับคนจริงทุกอย่าง — เก็บอาวุธ ติด cooldown โดนตีเลือดลด)
// ความยากต่างกันที่ "ความไวในการตอบสนอง / ความแม่นในการเล็ง / โอกาสหลบ / ความเร็ว" ไม่ได้โกงดาเมจ
// ไม่แตะ socket: คืนเหตุการณ์ให้ index.js กระจาย เหมือน duel.js
import { attack, createMatch, pickWeapon } from './duel.js';
import { BODY_RADIUS, clampArena, inPillar, PICK_RANGE, SLAM_DODGE_Y, WEAPONS } from '../public/arena-rules.js';

export const BOT_LEVELS = {
  easy: { name: 'NPC มือใหม่', react: 650, aimErr: 0.35, dodge: 0.15, speed: 0.75, prefer: ['sword', 'hammer'] },
  normal: { name: 'NPC นักสู้', react: 380, aimErr: 0.14, dodge: 0.5, speed: 1, prefer: ['sword', 'spear', 'bow'] },
  dummy: { name: 'หุ่นซ้อม', react: 1e9, aimErr: 0, dodge: 0, speed: 0, prefer: [] }, // โหมดลองอาวุธ: ยืนนิ่ง ไม่ตีกลับ
  hard: { name: 'NPC แชมป์', react: 200, aimErr: 0.05, dodge: 0.85, speed: 1.2, prefer: ['spear', 'dagger', 'bow', 'staff'] },
};
export const isBotId = (id) => typeof id === 'string' && id.startsWith('npc:');

const WALK = 3;
const RUN = 5.2;
const GRAVITY = 22;
const JUMP = 7.6;
const round = (v) => Math.round(v * 100) / 100;
const wrap = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const turnToward = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// สร้างสมองบอทให้ fighter ที่เป็นบอท (เก็บไว้ใน match.brain)
export function createBrain(level, rand = Math.random) {
  return { level, vy: 0, nextThinkAt: 0, strafe: rand() < 0.5 ? 1 : -1, dodgeUntil: 0, dodgeDir: null, nextAttackAt: 0, rand };
}

// มีเสาบังระหว่างสองจุดไหม (ยิงไปก็ชนเสา)
export function blockedLine(a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.4);
  for (let i = 1; i < steps; i += 1) {
    const k = i / steps;
    if (inPillar(a.x + (b.x - a.x) * k, a.z + (b.z - a.z) * k, 0.15)) return true;
  }
  return false;
}

// ระยะที่อยากยืนห่างคู่ตามอาวุธ (ระยะประชิดเข้าไปให้ถึง · ยิงไกลถอยมายิง)
export function preferredRange(kind) {
  const w = WEAPONS[kind];
  if (w.type === 'shot') return kind === 'bow' ? 7 : 5.5;
  if (w.type === 'slam') return w.range;
  return Math.max(0.9, w.range * 0.7);
}

// ท่าของคู่ที่กำลังจะโดนเรา (ง้างอยู่) → ต้องหลบ · ลูกยิงที่พุ่งมาหาเรา
function threat(match, botId, me, now) {
  for (const p of match.pending) {
    if (p.by === botId || p.at - now > 700) continue;
    const w = WEAPONS[p.kind];
    const atk = match.fighters[p.by].pose;
    if (w.type === 'slam') {
      const cx = atk.x + Math.sin(p.ry) * w.range;
      const cz = atk.z + Math.cos(p.ry) * w.range;
      if (Math.hypot(me.x - cx, me.z - cz) < w.radius + BODY_RADIUS + 0.4) return { kind: 'slam', from: { x: cx, z: cz } };
    } else if (w.type === 'melee' && Math.hypot(me.x - atk.x, me.z - atk.z) < w.range + 0.8) {
      return { kind: 'melee', from: atk };
    }
  }
  for (const s of match.shots) {
    if (s.by === botId) continue;
    const toMe = { x: me.x - s.x, z: me.z - s.z };
    const speed = Math.hypot(s.vx, s.vz);
    const ahead = (toMe.x * s.vx + toMe.z * s.vz) / speed; // ลูกจะผ่านเราในอีกกี่เมตร
    const side = Math.abs(toMe.x * s.vz - toMe.z * s.vx) / speed; // ห่างจากแนวลูกด้านข้าง
    if (ahead > 0 && ahead < 5 && side < WEAPONS[s.kind].radius + 0.7) return { kind: 'shot', dir: { x: s.vx / speed, z: s.vz / speed }, arrow: s.kind === 'bow' };
  }
  return null;
}

// เดินไปทาง (dx, dz) ทีละนิด · ชนเสาลองเบี่ยงซ้าย/ขวา · ไม่ออกนอกลาน
function step(pose, dx, dz, speed, dt) {
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;
  const ux = dx / len;
  const uz = dz / len;
  for (const [ax, az] of [[ux, uz], [uz, -ux], [-uz, ux]]) {
    const nx = clampArena(pose.x + ax * speed * dt);
    const nz = clampArena(pose.z + az * speed * dt);
    if (inPillar(nx, nz, BODY_RADIUS)) continue;
    pose.x = round(nx);
    pose.z = round(nz);
    return;
  }
}

function inStrikeRange(kind, me, them, ry) {
  const w = WEAPONS[kind];
  const d = Math.hypot(them.x - me.x, them.z - me.z);
  if (w.type === 'shot') return d < 14 && !blockedLine(me, them);
  if (w.type === 'slam') return Math.abs(d - w.range) < w.radius * 0.8;
  const facing = Math.cos(angleTo(me, them) - ry);
  return d <= w.range + BODY_RADIUS * 0.6 && facing > Math.cos(((w.arc / 2) * Math.PI) / 180);
}

// อาวุธบนพื้นที่บอทอยากได้ (ตามนิสัยแต่ละระดับ ไม่มีก็เอาอันใกล้สุด)
function wantedWeapon(match, me, prefer) {
  let best = null;
  for (const w of match.weapons) {
    const rank = prefer.includes(w.kind) ? prefer.indexOf(w.kind) : prefer.length + 1;
    const score = rank * 4 + Math.hypot(w.x - me.x, w.z - me.z);
    if (!best || score < best.score) best = { w, score };
  }
  return best?.w ?? null;
}

// เดิน 1 tick ของบอท · คืนเหตุการณ์ (swing / state) ให้ index.js กระจาย
export function stepBot(match, botId, now, dt) {
  const bot = match.fighters[botId];
  const brain = match.brain;
  const cfg = BOT_LEVELS[brain.level];
  const them = match.fighters[match.order.find((id) => id !== botId)].pose;
  const me = bot.pose;
  const events = [];

  // แรงโน้มถ่วง (กระโดดหลบ)
  if (me.y > 0 || brain.vy > 0) {
    brain.vy -= GRAVITY * dt;
    me.y = round(Math.max(0, me.y + brain.vy * dt));
    if (me.y === 0) brain.vy = 0;
  }
  if (match.phase !== 'fight' || brain.level === 'dummy') {
    me.ry = round(wrap(turnToward(me.ry, angleTo(me, them), 0.2)));
    return events;
  }

  // คิดใหม่ตามรอบความไว (ระดับง่าย = ช้ากว่า → หลบไม่ทัน ตีช้า)
  if (now >= brain.nextThinkAt) {
    brain.nextThinkAt = now + cfg.react * (0.7 + brain.rand() * 0.6);
    const danger = threat(match, botId, me, now);
    if (danger && now >= brain.dodgeUntil && brain.rand() < cfg.dodge) {
      brain.dodgeUntil = now + 450;
      if ((danger.kind === 'slam' || (danger.kind === 'shot' && danger.arrow)) && brain.rand() < 0.5 && me.y === 0) brain.vy = JUMP; // กระโดดหลบ
      if (danger.kind === 'shot') brain.dodgeDir = { x: -danger.dir.z * brain.strafe, z: danger.dir.x * brain.strafe }; // เบี่ยงข้าง
      else brain.dodgeDir = { x: me.x - danger.from.x, z: me.z - danger.from.z }; // ถอยออก
    }
    if (brain.rand() < 0.15) brain.strafe *= -1;
  }

  const speed = (bot.weapon === 'fists' ? RUN : WALK + 1) * cfg.speed * WEAPONS[bot.weapon].move;
  if (now < brain.dodgeUntil && brain.dodgeDir) {
    step(me, brain.dodgeDir.x, brain.dodgeDir.z, RUN * cfg.speed, dt);
  } else if (bot.weapon === 'fists' && match.weapons.length) {
    // ยังมือเปล่า → วิ่งไปเก็บอาวุธที่ชอบก่อน
    const target = wantedWeapon(match, me, cfg.prefer);
    if (Math.hypot(target.x - me.x, target.z - me.z) <= PICK_RANGE * 0.8) {
      if (pickWeapon(match, botId, target.id)) events.push({ type: 'state' });
    } else step(me, target.x - me.x, target.z - me.z, speed, dt);
  } else {
    // มีอาวุธแล้ว → รักษาระยะที่ถนัด + เดินวนข้าง (ยิงไกลวนมากกว่า)
    const dx = them.x - me.x;
    const dz = them.z - me.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = preferredRange(bot.weapon);
    const radial = d > want + 0.3 ? 1 : d < want - 0.6 ? -1 : 0;
    const orbit = WEAPONS[bot.weapon].type === 'shot' ? 0.8 : 0.35;
    step(me, (dx / d) * radial + (-dz / d) * brain.strafe * orbit, (dz / d) * radial + (dx / d) * brain.strafe * orbit, speed, dt);
  }

  // หันหาคู่ + โจมตีเมื่อเข้าระยะ (เล็งพลาดได้ตามระดับ)
  me.ry = round(wrap(turnToward(me.ry, angleTo(me, them), 0.35)));
  if (now >= bot.readyAt && now >= brain.nextAttackAt && me.y < SLAM_DODGE_Y && inStrikeRange(bot.weapon, me, them, me.ry)) {
    const aim = angleTo(me, them) + (brain.rand() - 0.5) * 2 * cfg.aimErr;
    const swing = attack(match, botId, aim, now);
    if (swing) events.push({ type: 'swing', id: botId, ...swing });
    brain.nextAttackAt = now + cfg.react * (0.4 + brain.rand() * 0.8);
  }
  return events;
}

// เริ่มแมตช์ซ้อม คน vs NPC (เฉพาะตอนลานว่าง) · ไม่นับสถิติชนะ
// level 'dummy' = โหมดลองอาวุธ (หุ่นไม่ตอบโต้ ไม่จับเวลา เลือดหมดฟื้นใหม่ · ออกเองด้วย duel:quit)
export function startBotMatch(arena, id, name, level, now, look, rand = Math.random) {
  if (arena.match) return { error: 'ลานไม่ว่าง มีคนประลองอยู่' };
  if (!BOT_LEVELS[level]) return { error: 'ไม่มีโหมดนี้' };
  arena.queue = arena.queue.filter((q) => q.id !== id); // ออกจากคิวหาคู่ก่อน
  const botId = `npc:${arena.seq + 1}`;
  const match = createMatch(arena, [{ id, name }, { id: botId, name: BOT_LEVELS[level].name, look }], now, { brain: createBrain(level, rand), botId, ...(level === 'dummy' ? { practice: true } : {}) });
  return { match };
}

// เดินบอทในแมตช์ปัจจุบัน 1 tick (เรียกก่อน stepDuel) · คืนเหตุการณ์ swing/state + ตำแหน่งบอทให้ส่งคนเล่น
export function tickBot(arena, now, dt) {
  const match = arena.match;
  if (!match?.botId || match.phase === 'over') return [];
  const events = stepBot(match, match.botId, now, dt);
  const f = match.fighters[match.botId];
  events.push({ type: 'pose', id: match.botId, pose: { ...f.pose } });
  return events;
}
