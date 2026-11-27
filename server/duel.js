// ลานประลอง 1v1: คิวรอคู่ + ตัดสินว่าใครโดนอะไร เลือดเหลือเท่าไร ใครชนะ
// server เป็นคนตัดสินดาเมจทั้งหมด (คนตีแค่บอกว่า "ฟันแล้ว" คนโดนแค่ส่งตำแหน่ง) → โกงยิงโดนเองไม่ได้
// ฟังก์ชันในไฟล์นี้ไม่แตะ socket/เวลาเครื่อง: รับ now เข้ามา คืนรายการเหตุการณ์ ให้ index.js เป็นคนกระจาย
import {
  ARENA_HALF, BODY_HEIGHT, BODY_RADIUS, clampArena, COUNTDOWN_MS, FIGHT_MS, HP_MAX, inPillar,
  PICK_RANGE, RESULT_MS, SHOT_HEIGHT, SLAM_DODGE_Y, SPAWNS, WEAPON_SPOTS, WEAPONS,
} from '../public/arena-rules.js';

const MAX_Y = 6; // กระโดดในลาน (พื้นเรียบ) สูงสุด ~1.3 m เผื่อไว้
const round = (v) => Math.round(v * 100) / 100;
const wrapAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

export function createArena() {
  return { queue: [], match: null, seq: 0, wins: new Map() };
}

// ---------- คิว ----------
// กดเข้าคิว: ถ้ามีคนรออยู่แล้วและลานว่าง → เริ่มแมตช์ทันที · คืน { queued } หรือ { match }
export function joinQueue(arena, id, name, now) {
  if (isFighter(arena, id)) return { error: 'กำลังประลองอยู่' };
  if (!arena.queue.some((q) => q.id === id)) arena.queue.push({ id, name });
  const match = startIfReady(arena, now);
  return match ? { match } : { queued: true };
}

export function leaveQueue(arena, id) {
  const before = arena.queue.length;
  arena.queue = arena.queue.filter((q) => q.id !== id);
  return arena.queue.length !== before;
}

export const queueNames = (arena) => arena.queue.map((q) => q.name);
export const isFighter = (arena, id) => Boolean(arena.match?.fighters[id]);

export function startIfReady(arena, now) {
  if (arena.match || arena.queue.length < 2) return null;
  return createMatch(arena, arena.queue.splice(0, 2), now);
}

// สร้างแมตช์จากผู้เล่น 2 คน (คนจริง หรือคน + NPC) · extra = ช่องเสริมของผู้เล่น เช่น look ของ NPC
export function createMatch(arena, pair, now, extra = {}) {
  arena.seq += 1;
  const fighters = {};
  pair.forEach(({ id, name, look }, side) => {
    const spawn = SPAWNS[side];
    fighters[id] = { id, name, side, hp: HP_MAX, weapon: 'fists', readyAt: 0, pose: { x: spawn.x, y: 0, z: spawn.z, ry: spawn.ry }, ...(look ? { look } : {}) };
  });
  arena.match = {
    id: arena.seq,
    phase: 'countdown',
    phaseAt: now,
    order: pair.map((p) => p.id),
    fighters,
    weapons: WEAPON_SPOTS.map((spot, i) => ({ id: i + 1, kind: spot.kind, x: spot.x, z: spot.z })),
    weaponSeq: WEAPON_SPOTS.length,
    pending: [], // ท่าที่กำลังง้าง รอถึงเวลาโดน
    shots: [], // ลูกธนู/ลูกไฟที่ลอยอยู่
    shotSeq: 0,
    winner: null,
    ...extra,
  };
  return arena.match;
}

const opponentOf = (match, id) => match.fighters[match.order.find((other) => other !== id)];

// ข้อมูลที่ส่งให้หน้าเว็บ: ms ที่เหลือ (ไม่ส่งเวลา server ตรงๆ เพราะนาฬิกาแต่ละเครื่องไม่ตรงกัน)
export function publicMatch(match, now) {
  const length = { countdown: COUNTDOWN_MS, fight: match.practice ? 0 : FIGHT_MS, over: RESULT_MS }[match.phase];
  return {
    id: match.id,
    phase: match.phase,
    msLeft: Math.max(0, match.phaseAt + length - now),
    fighters: match.order.map((id) => {
      const f = match.fighters[id];
      return { id, name: f.name, side: f.side, hp: f.hp, weapon: f.weapon, pose: f.pose, ...(f.look ? { look: f.look, npc: true } : {}) };
    }),
    weapons: match.weapons,
    winner: match.winner,
    practice: Boolean(match.practice),
  };
}

// ---------- ตำแหน่ง ----------
// เชื่อตำแหน่งที่เครื่องคนเล่นส่งมา แต่บีบให้อยู่ในลาน และไม่ให้ยืนในเสา
export function setPose(match, id, raw) {
  const f = match?.fighters[id];
  if (!f || !raw || typeof raw !== 'object') return null;
  const { x, z, ry } = raw;
  if (![x, z, ry].every(Number.isFinite)) return null;
  const nx = clampArena(x);
  const nz = clampArena(z);
  if (inPillar(nx, nz, BODY_RADIUS * 0.5)) return null;
  f.pose = {
    x: round(nx),
    y: Number.isFinite(raw.y) ? round(Math.min(MAX_Y, Math.max(0, raw.y))) : 0,
    z: round(nz),
    ry: round(wrapAngle(ry)),
  };
  return f.pose;
}

// ---------- เก็บอาวุธ ----------
// สลับ: ของที่ถืออยู่ (ถ้าไม่ใช่หมัด) วางลงตรงที่ยืน · คืน { weapon, dropped } หรือ null
export function pickWeapon(match, id, spotId) {
  const f = match?.fighters[id];
  if (!f || match.phase === 'over') return null;
  const index = match.weapons.findIndex((w) => w.id === spotId);
  if (index < 0) return null;
  const item = match.weapons[index];
  if (Math.hypot(item.x - f.pose.x, item.z - f.pose.z) > PICK_RANGE + 0.8) return null; // เผื่อตำแหน่งที่ server รู้ช้ากว่าจริง
  match.weapons.splice(index, 1);
  let dropped = null;
  if (f.weapon !== 'fists') {
    match.weaponSeq += 1;
    dropped = { id: match.weaponSeq, kind: f.weapon, x: f.pose.x, z: f.pose.z };
    match.weapons.push(dropped);
  }
  f.weapon = item.kind;
  f.readyAt = 0;
  return { weapon: item.kind, dropped };
}

// ---------- โจมตี ----------
// กดฟัน/ยิง: เช็คช่วงเวลา + cooldown แล้วตั้งให้โดนจริงหลังง้างเสร็จ · ry = ทิศที่เล็ง (หน้าเว็บช่วยเล็งหาคู่ให้นิดนึง)
// คืน { weapon, ry, windup } ให้ทุกเครื่องเล่นท่า หรือ null ถ้ายังกดไม่ได้
export function attack(match, id, rawRy, now) {
  const f = match?.fighters[id];
  if (!f || match.phase !== 'fight' || now < f.readyAt) return null;
  const ry = Number.isFinite(rawRy) ? wrapAngle(rawRy) : f.pose.ry;
  const weapon = WEAPONS[f.weapon];
  f.readyAt = now + weapon.cooldown;
  f.pose.ry = round(ry);
  match.pending.push({ by: id, kind: f.weapon, ry, at: now + weapon.windup });
  return { weapon: f.weapon, ry: round(ry), windup: weapon.windup };
}

function facingOf(ry) {
  return { fx: Math.sin(ry), fz: Math.cos(ry) };
}

// ฟันแบบพัด: อยู่ในระยะ + อยู่ในมุมด้านหน้า + ความสูงพอๆ กัน
export function meleeHits(attacker, target, ry, weapon) {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const dist = Math.hypot(dx, dz);
  if (dist > weapon.range + BODY_RADIUS || Math.abs(target.y - attacker.y) > 1.3) return false;
  if (dist < BODY_RADIUS) return true; // ติดตัวกันอยู่ = โดน
  const { fx, fz } = facingOf(ry);
  return (fx * dx + fz * dz) / dist >= Math.cos(((weapon.arc / 2) * Math.PI) / 180);
}

// ทุบพื้นเป็นวงข้างหน้า: ในวง + ไม่ได้ลอยอยู่ (กระโดดหลบได้)
export function slamHits(attacker, target, ry, weapon) {
  const { fx, fz } = facingOf(ry);
  const cx = attacker.x + fx * weapon.range;
  const cz = attacker.z + fz * weapon.range;
  if (target.y - attacker.y > SLAM_DODGE_Y) return false;
  return Math.hypot(target.x - cx, target.z - cz) <= weapon.radius + BODY_RADIUS;
}

// ลูกยิงโดนตัว: ใกล้พอในแนวราบ + ลูกอยู่ระหว่างเท้ากับหัว
export function shotHits(shot, target, radius) {
  if (Math.hypot(target.x - shot.x, target.z - shot.z) > radius + BODY_RADIUS) return false;
  const above = shot.y - target.y;
  return above >= -radius * 0.5 && above <= BODY_HEIGHT;
}

function knockbackOf(from, to, knock) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  return { kx: round(dx / d), kz: round(dz / d), knock };
}

function applyHit(match, by, target, kind, from, events) {
  const weapon = WEAPONS[kind];
  target.hp = Math.max(0, target.hp - weapon.dmg);
  events.push({ type: 'hit', by, target: target.id, weapon: kind, dmg: weapon.dmg, hp: target.hp, ...knockbackOf(from, target.pose, weapon.knock) });
  if (target.hp > 0) return;
  // โหมดลองอาวุธ: หุ่นเลือดหมดแล้วฟื้นเต็ม ไม่จบแมตช์
  if (match.practice) {
    target.hp = HP_MAX;
    events.push({ type: 'state' });
  } else finish(match, by, 'ko', events);
}

function finish(match, winnerId, reason, events, now = match.phaseAt) {
  if (match.phase === 'over') return;
  match.phase = 'over';
  match.phaseAt = now;
  match.winner = winnerId ? match.fighters[winnerId].name : null;
  events.push({ type: 'end', winner: match.winner, winnerId, reason });
}

function resolvePending(match, now, events) {
  const due = match.pending.filter((p) => p.at <= now);
  match.pending = match.pending.filter((p) => p.at > now);
  for (const p of due) {
    if (match.phase !== 'fight') break;
    const attacker = match.fighters[p.by];
    const target = opponentOf(match, p.by);
    const weapon = WEAPONS[p.kind];
    if (weapon.type === 'shot') {
      const { fx, fz } = facingOf(p.ry);
      match.shotSeq += 1;
      const shot = {
        id: match.shotSeq, by: p.by, kind: p.kind, born: p.at,
        x: attacker.pose.x + fx * 0.5, y: attacker.pose.y + SHOT_HEIGHT, z: attacker.pose.z + fz * 0.5,
        vx: fx * weapon.speed, vz: fz * weapon.speed,
      };
      match.shots.push(shot);
      events.push({ type: 'shot', id: shot.id, by: p.by, kind: p.kind, x: round(shot.x), y: round(shot.y), z: round(shot.z), vx: round(shot.vx), vz: round(shot.vz), life: weapon.life });
      continue;
    }
    const hits = weapon.type === 'slam' ? slamHits : meleeHits;
    if (hits(attacker.pose, target.pose, p.ry, weapon)) applyHit(match, p.by, target, p.kind, attacker.pose, events);
  }
}

const SHOT_STEP = 0.2; // เดินลูกทีละไม่เกิน 0.2 m ต่อการเช็ค (ลูกเร็วไม่ทะลุตัว/เสา)

function moveShots(match, dt, now, events) {
  const alive = [];
  for (const shot of match.shots) {
    const weapon = WEAPONS[shot.kind];
    const target = opponentOf(match, shot.by);
    const steps = Math.max(1, Math.ceil((weapon.speed * dt) / SHOT_STEP));
    let gone = null;
    for (let i = 0; i < steps && !gone; i += 1) {
      shot.x += (shot.vx * dt) / steps;
      shot.z += (shot.vz * dt) / steps;
      if (match.phase === 'fight' && shotHits(shot, target.pose, weapon.radius)) {
        applyHit(match, shot.by, target, shot.kind, { x: shot.x - shot.vx, z: shot.z - shot.vz }, events);
        gone = 'hit';
      } else if (inPillar(shot.x, shot.z, weapon.radius * 0.4)) gone = 'pillar';
      else if (Math.abs(shot.x) > ARENA_HALF + 1 || Math.abs(shot.z) > ARENA_HALF + 1 || now - shot.born > weapon.life * 1000) gone = 'away';
    }
    if (gone) events.push({ type: 'shotEnd', id: shot.id, x: round(shot.x), z: round(shot.z), why: gone });
    else alive.push(shot);
  }
  match.shots = alive;
}

// เรียกทุก ~50 ms: เปลี่ยนช่วง (นับถอยหลัง → สู้ → จบ) + ท่าที่ง้างเสร็จ + ลูกยิง · คืนรายการเหตุการณ์
export function stepDuel(arena, now, dt = 0.05) {
  const match = arena.match;
  if (!match) return [];
  const events = [];
  if (match.phase === 'countdown' && now - match.phaseAt >= COUNTDOWN_MS) {
    match.phase = 'fight';
    match.phaseAt = now;
    events.push({ type: 'phase', phase: 'fight' });
  }
  if (match.phase === 'fight') {
    resolvePending(match, now, events);
    moveShots(match, dt, now, events);
    if (match.phase === 'fight' && !match.practice && now - match.phaseAt >= FIGHT_MS) {
      const [a, b] = match.order.map((id) => match.fighters[id]);
      finish(match, a.hp === b.hp ? null : (a.hp > b.hp ? a : b).id, 'time', events, now);
    }
  }
  if (match.phase === 'over') {
    if (events.some((e) => e.type === 'end')) {
      match.phaseAt = now;
      recordWin(arena, match);
    }
    if (now - match.phaseAt >= RESULT_MS) {
      arena.match = null;
      events.push({ type: 'close' });
      const next = startIfReady(arena, now);
      if (next) events.push({ type: 'start', match: next });
    }
  }
  return events;
}

// แมตช์ซ้อมกับ NPC ไม่นับสถิติ (สถิติไว้วัดกันระหว่างคนจริง)
function recordWin(arena, match) {
  if (match.winner && !match.brain) arena.wins.set(match.winner, (arena.wins.get(match.winner) ?? 0) + 1);
}

export const winsOf = (arena, names) => Object.fromEntries(names.map((name) => [name, arena.wins.get(name) ?? 0]));

// หลุด/ออกจากห้องระหว่างประลอง → อีกฝ่ายชนะเลย · ยังอยู่ในคิว → เอาออก
export function forfeit(arena, id, now) {
  leaveQueue(arena, id);
  const match = arena.match;
  if (!match?.fighters[id]) return [];
  if (match.phase === 'over') return [];
  const events = [];
  finish(match, opponentOf(match, id).id, 'left', events, now);
  recordWin(arena, match);
  return events;
}
