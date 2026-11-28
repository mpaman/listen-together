// ลานประลอง 1v1: คิวรอคู่ + ตัดสินว่าใครโดนอะไร เลือดเหลือเท่าไร ใครชนะ
// server เป็นคนตัดสินดาเมจทั้งหมด (คนตีแค่บอกว่า "ฟันแล้ว" คนโดนแค่ส่งตำแหน่ง) → โกงยิงโดนเองไม่ได้
// ฟังก์ชันในไฟล์นี้ไม่แตะ socket/เวลาเครื่อง: รับ now เข้ามา คืนรายการเหตุการณ์ ให้ index.js เป็นคนกระจาย
import {
  ARENA_HALF, BLOCK_ARC, BODY_HEIGHT, BODY_RADIUS, clampArena, cleanLoadout, COUNTDOWN_MS, DASH_ENABLED, DASH_MS, FIGHT_MS, SHIELD,
  HP_MAX, inPillar, RESULT_MS, ROLL_IFRAME_MS, ROLL_MS, SHOT_HEIGHT, SLAM_DODGE_Y, SPAWNS, STAMINA, SWAP_MS, WEAPONS,
} from '../public/arena-rules.js';

const MAX_Y = 6; // กระโดดในลาน (พื้นเรียบ) สูงสุด ~1.3 m เผื่อไว้
const round = (v) => Math.round(v * 100) / 100;
const wrapAngle = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

// ห้องหนึ่งมีได้หลายแมตช์พร้อมกัน (ทุกแมตช์ใช้ลานเดียวกันบนแมพ แต่คนสู้เห็นแค่คู่ของตัวเอง)
// จำกัดจำนวนไว้กัน server ทำงานหนักเกิน (ทุกแมตช์เดินทุก 50 ms)
export const MAX_MATCHES = 8;

export function createArena() {
  return {
    queue: [],
    matches: new Map(), // id → match
    seq: 0,
    wins: new Map(), // ชื่อ → จำนวนครั้งที่ชนะ (ไว้ใส่มงกุฎ)
    // แมตช์ล่าสุด (test เดิมกับโค้ดที่มีแมตช์เดียวใช้ได้เหมือนเดิม)
    get match() {
      return [...this.matches.values()].at(-1) ?? null;
    },
  };
}

// แมตช์ที่คนนี้สู้อยู่ (ไม่ได้สู้ = null)
export function matchOf(arena, id) {
  for (const match of arena.matches.values()) if (match.fighters[id]) return match;
  return null;
}
// ติดเลขแมตช์ให้ทุกเหตุการณ์ → index.js รู้ว่าต้องส่งให้ใคร · หน้าเว็บกรองเฉพาะแมตช์ตัวเอง
const tagged = (match, events) => events.map((e) => ({ ...e, matchId: match.id }));

// ---------- คิว ----------
// กดเข้าคิว: ถ้ามีคนรออยู่แล้วและลานว่าง → เริ่มแมตช์ทันที · คืน { queued } หรือ { match }
export function joinQueue(arena, id, name, now, loadout) {
  if (isFighter(arena, id)) return { error: 'กำลังประลองอยู่' };
  if (!arena.queue.some((q) => q.id === id)) arena.queue.push({ id, name, loadout: cleanLoadout(loadout) });
  const match = startIfReady(arena, now);
  return match ? { match } : { queued: true };
}

export function leaveQueue(arena, id) {
  const before = arena.queue.length;
  arena.queue = arena.queue.filter((q) => q.id !== id);
  return arena.queue.length !== before;
}

export const queueNames = (arena) => arena.queue.map((q) => q.name);
export const isFighter = (arena, id) => Boolean(matchOf(arena, id));

// มีคนรอครบคู่ และยังเปิดแมตช์เพิ่มได้ → จับคู่สองคนแรกในคิว
export function startIfReady(arena, now) {
  if (arena.matches.size >= MAX_MATCHES || arena.queue.length < 2) return null;
  return createMatch(arena, arena.queue.splice(0, 2), now);
}

// สร้างแมตช์จากผู้เล่น 2 คน (คนจริง หรือคน + NPC) · extra = ช่องเสริมของผู้เล่น เช่น look ของ NPC
export function createMatch(arena, pair, now, extra = {}) {
  arena.seq += 1;
  const fighters = {};
  pair.forEach(({ id, name, look, loadout }, side) => {
    const spawn = SPAWNS[side];
    const kit = cleanLoadout(loadout);
    fighters[id] = {
      id, name, side, hp: HP_MAX, loadout: kit, slot: 0, weapon: kit[0], readyAt: 0,
      stamina: STAMINA.max, spentAt: 0, blocking: false, rollUntil: 0, stunUntil: 0,
      pose: { x: spawn.x, y: 0, z: spawn.z, ry: spawn.ry }, ...(look ? { look } : {}),
    };
  });
  const match = {
    id: arena.seq,
    phase: 'countdown',
    phaseAt: now,
    order: pair.map((p) => p.id),
    fighters,
    weapons: [], // (เดิมมีอาวุธวางบนพื้น · ตอนนี้เลือกหลัก/รองก่อนเข้าลานแทน)
    pending: [], // ท่าที่กำลังง้าง รอถึงเวลาโดน
    shots: [], // ลูกธนู/ลูกไฟที่ลอยอยู่
    shotSeq: 0,
    winner: null,
    ...extra,
  };
  arena.matches.set(match.id, match);
  return match;
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
      return {
        id, name: f.name, side: f.side, hp: f.hp, weapon: f.weapon, loadout: f.loadout, slot: f.slot,
        stamina: Math.round(f.stamina), blocking: f.blocking, pose: f.pose, ...(f.look ? { look: f.look, npc: true } : {}),
      };
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

// ---------- สลับอาวุธ ----------
// slot 0 = หลัก, 1 = รอง · ไม่ส่ง slot = สลับไปอีกอัน · หลังสลับต้องรอ SWAP_MS ก่อนตี
export function swapWeapon(match, id, rawSlot, now) {
  const f = match?.fighters[id];
  if (!f || match.phase === 'over' || busy(f, now)) return null;
  const slot = rawSlot === 0 || rawSlot === 1 ? rawSlot : 1 - f.slot;
  if (slot === f.slot) return null;
  f.slot = slot;
  f.weapon = f.loadout[slot];
  f.blocking = false;
  f.readyAt = Math.max(f.readyAt, now + SWAP_MS);
  return { weapon: f.weapon, slot };
}

// ---------- สตามินา / บล็อก / กลิ้ง / แดช ----------
function spend(f, cost, now) {
  f.stamina = Math.max(0, f.stamina - cost);
  f.spentAt = now;
}
// มึน หรือยังกลิ้งไม่จบท่า = ทำอย่างอื่นไม่ได้
const busy = (f, now) => now < f.stunUntil || now < f.rollUntil + (ROLL_MS - ROLL_IFRAME_MS);

// คนเล่นกดท่า: block (on = ยก/ลดการ์ด) · roll · dash
// คืน { act, on? } ให้ส่งต่อทุกเครื่องเล่นท่า หรือ null ถ้าทำไม่ได้ (สตามินาไม่พอ/กลิ้งอยู่)
// บล็อกไม่ใช้สตามินา · แดชปิดไว้ (DASH_ENABLED)
export function act(match, id, type, now, on = true) {
  const f = match?.fighters[id];
  if (!f || match.phase !== 'fight') return null;
  if (type === 'block') {
    const next = Boolean(on) && !busy(f, now);
    if (next === f.blocking) return null;
    f.blocking = next;
    return { act: 'block', on: next };
  }
  const cost = { roll: STAMINA.roll, ...(DASH_ENABLED ? { dash: STAMINA.dash } : {}) }[type];
  if (cost === undefined || busy(f, now) || f.stamina < cost) return null;
  spend(f, cost, now);
  f.blocking = false;
  if (type === 'roll') f.rollUntil = now + ROLL_IFRAME_MS;
  return { act: type, ms: type === 'roll' ? ROLL_MS : DASH_MS };
}

// สตามินาฟื้นเองเมื่อไม่ได้กลิ้งสักพัก
function regen(match, now, dt) {
  for (const f of Object.values(match.fighters)) {
    if (now - f.spentAt < STAMINA.regenDelay || f.stamina >= STAMINA.max) continue;
    f.stamina = Math.min(STAMINA.max, f.stamina + STAMINA.regen * dt);
  }
}

// ---------- โจมตี ----------
// กดฟัน/ยิง: เช็คช่วงเวลา + cooldown แล้วตั้งให้โดนจริงหลังง้างเสร็จ · ry = ทิศที่เล็ง (หน้าเว็บช่วยเล็งหาคู่ให้นิดนึง)
// คืน { weapon, ry, windup } ให้ทุกเครื่องเล่นท่า หรือ null ถ้ายังกดไม่ได้
export function attack(match, id, rawRy, now) {
  const f = match?.fighters[id];
  if (!f || match.phase !== 'fight' || now < f.readyAt || busy(f, now)) return null;
  const ry = Number.isFinite(rawRy) ? wrapAngle(rawRy) : f.pose.ry;
  const weapon = WEAPONS[f.weapon];
  f.readyAt = now + weapon.cooldown;
  f.blocking = false; // ตีแล้วลดการ์ดลงเอง
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

// ยกการ์ดหันเข้าหาทางที่ดาเมจมาไหม (from = จุดที่ดาเมจมา)
function guarding(target, from) {
  if (!target.blocking) return false;
  const dx = from.x - target.pose.x;
  const dz = from.z - target.pose.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return true;
  const { fx, fz } = facingOf(target.pose.ry);
  return (fx * dx + fz * dz) / d >= Math.cos(((BLOCK_ARC / 2) * Math.PI) / 180);
}

function applyHit(match, by, target, kind, from, events, now) {
  const weapon = WEAPONS[kind];
  // ช่วงต้นของการกลิ้ง = อมตะ
  if (now < target.rollUntil) {
    events.push({ type: 'dodge', by, target: target.id });
    return;
  }
  let dmg = weapon.dmg;
  let knock = weapon.knock;
  let blocked = false;
  if (guarding(target, from)) {
    const shield = WEAPONS[target.weapon];
    const wallCost = Math.round(SHIELD.cost * (1 + 2 * (weapon.pierce ?? 0)));
    if (shield.wall && target.stamina >= wallCost) {
      // โล่ใหญ่ + สตามินาพอ = รับได้เกือบหมด เหลือแค่ chip
      spend(target, wallCost, now);
      dmg = Math.min(dmg, SHIELD.chip);
    } else dmg -= Math.round(dmg * shield.guard * (1 - (weapon.pierce ?? 0)));
    knock *= 0.35;
    blocked = true;
  }
  target.hp = Math.max(0, target.hp - dmg);
  events.push({ type: 'hit', by, target: target.id, weapon: kind, dmg, blocked, hp: target.hp, stamina: Math.round(target.stamina), ...knockbackOf(from, target.pose, knock) });
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
  match.winnerId = winnerId;
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
    if (hits(attacker.pose, target.pose, p.ry, weapon)) applyHit(match, p.by, target, p.kind, attacker.pose, events, now);
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
        applyHit(match, shot.by, target, shot.kind, { x: shot.x - shot.vx, z: shot.z - shot.vz }, events, now);
        gone = 'hit';
      } else if (inPillar(shot.x, shot.z, weapon.radius * 0.4)) gone = 'pillar';
      else if (Math.abs(shot.x) > ARENA_HALF + 1 || Math.abs(shot.z) > ARENA_HALF + 1 || now - shot.born > weapon.life * 1000) gone = 'away';
    }
    if (gone) events.push({ type: 'shotEnd', id: shot.id, x: round(shot.x), z: round(shot.z), why: gone });
    else alive.push(shot);
  }
  match.shots = alive;
}

// เรียกทุก ~50 ms: เดินทุกแมตช์ในห้อง · คืนรายการเหตุการณ์ (ทุกอันมี matchId)
export function stepDuel(arena, now, dt = 0.05) {
  const events = [];
  for (const match of [...arena.matches.values()]) events.push(...tagged(match, stepMatch(arena, match, now, dt)));
  // แมตช์ปิดไปแล้ว → คนที่รอคิวได้ลงต่อ
  let next;
  while ((next = startIfReady(arena, now))) events.push({ type: 'start', match: next, matchId: next.id });
  return events;
}

// เปลี่ยนช่วง (นับถอยหลัง → สู้ → จบ) + ท่าที่ง้างเสร็จ + ลูกยิง ของแมตช์เดียว
function stepMatch(arena, match, now, dt) {
  const events = [];
  if (match.phase === 'countdown' && now - match.phaseAt >= COUNTDOWN_MS) {
    match.phase = 'fight';
    match.phaseAt = now;
    events.push({ type: 'phase', phase: 'fight' });
  }
  if (match.phase === 'fight') {
    regen(match, now, dt);
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
      arena.matches.delete(match.id);
      events.push({ type: 'close', order: match.order });
    }
  }
  return events;
}

// นับชนะ (ได้มงกุฎ): ชนะคนจริง หรือชนะ NPC ก็นับ · บอทชนะไม่นับ · โหมดลองอาวุธ (หุ่น) ไม่นับ
// (Man ขอ 11-28 ให้ชนะแล้วมีมงกุฎ · เล่นคนเดียวก็ต้องได้มงกุฎจากการชนะ NPC)
function recordWin(arena, match) {
  if (!match.winner || match.practice || match.winnerId === match.botId) return;
  arena.wins.set(match.winner, (arena.wins.get(match.winner) ?? 0) + 1);
}
export const allWins = (arena) => Object.fromEntries(arena.wins);

export const winsOf = (arena, names) => Object.fromEntries(names.map((name) => [name, arena.wins.get(name) ?? 0]));

// หลุด/ออกจากห้องระหว่างประลอง → อีกฝ่ายชนะเลย · ยังอยู่ในคิว → เอาออก
export function forfeit(arena, id, now) {
  leaveQueue(arena, id);
  const match = matchOf(arena, id);
  if (!match || match.phase === 'over') return [];
  const events = [];
  finish(match, opponentOf(match, id).id, 'left', events, now);
  recordWin(arena, match);
  return tagged(match, events);
}
