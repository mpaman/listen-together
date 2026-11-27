// กติกาลานประลอง 1v1 — ใช้ร่วมกันทั้ง server (ตัดสินดาเมจ) และหน้าเว็บ (วาดลาน/โชว์ค่าอาวุธ)
// ไฟล์เดียวกันสองฝั่ง → ตัวเลขไม่มีทางเพี้ยนกัน · ห้ามใช้ DOM/three ในไฟล์นี้ (server import ด้วย)
// พิกัดในไฟล์นี้เป็นพิกัด "ในลาน" (กลางลาน = 0,0) หน้าเว็บค่อยบวกตำแหน่งลานในโลก 3D เอง

export const ARENA_HALF = 9; // ลานสี่เหลี่ยม 18 × 18 m
export const HP_MAX = 100;
export const COUNTDOWN_MS = 3000;
export const FIGHT_MS = 90_000;
export const RESULT_MS = 4000; // โชว์ผลแพ้ชนะก่อนส่งกลับลานฟังเพลง
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.9;
export const PICK_RANGE = 1.2;

// เสาหิน 4 ต้น = ที่หลบลูกธนู/ลูกไฟ (ลูกยิงชนเสาแล้วหาย) · x, z = กลางเสา · s = ครึ่งความกว้าง
export const PILLARS = [
  { x: -4.5, z: -4.5, s: 0.7, h: 2.6 },
  { x: 4.5, z: -4.5, s: 0.7, h: 2.6 },
  { x: -4.5, z: 4.5, s: 0.7, h: 2.6 },
  { x: 4.5, z: 4.5, s: 0.7, h: 2.6 },
];

// คนแรกเกิดฝั่ง +z หันเข้ากลาง (ry = π) · คนที่สองฝั่ง -z (ry = 0)
export const SPAWNS = [
  { x: 0, z: 6.5, ry: Math.PI },
  { x: 0, z: -6.5, ry: 0 },
];

// อาวุธวางรอบลาน (ทุกคนเริ่มด้วยหมัด เดินไปเก็บเอง)
export const WEAPON_SPOTS = [
  { kind: 'sword', x: -7, z: 0 },
  { kind: 'hammer', x: 7, z: 0 },
  { kind: 'dagger', x: 0, z: 0 },
  { kind: 'spear', x: -2.5, z: -2.5 },
  { kind: 'bow', x: 2.5, z: 2.5 },
  { kind: 'staff', x: -2.5, z: 2.5 },
];

// type: melee = ฟันเป็นรูปพัดตรงหน้า · slam = ทุบพื้นเป็นวงข้างหน้า (กระโดดหลบได้) · shot = ยิงลูกบิน
// windup = เวลาง้างก่อนโดนจริง (คู่ต่อสู้เห็นท่าแล้วหลบได้) · cooldown = นับจากกด
// move = ตัวคูณความเร็วเดินตอนถือ · knock = ระยะกระเด็น (m)
export const WEAPONS = {
  fists: {
    name: 'หมัด', type: 'melee', dmg: 5, range: 1.4, arc: 70, windup: 80, cooldown: 380, knock: 1, move: 1.05, anim: 'jab',
    pro: 'ออกหมัดไว', con: 'เบามาก ต้องเข้าประชิด',
  },
  sword: {
    name: 'ดาบ', type: 'melee', dmg: 13, range: 2, arc: 80, windup: 140, cooldown: 520, knock: 1.6, move: 1, anim: 'slash',
    pro: 'สมดุล ฟันกว้าง ใช้ง่าย', con: 'ไม่มีจุดเด่นพิเศษ',
  },
  dagger: {
    name: 'มีดคู่', type: 'melee', dmg: 7, range: 1.5, arc: 70, windup: 50, cooldown: 220, knock: 0.5, move: 1.18, anim: 'jab',
    pro: 'ฟันรัวที่สุด วิ่งเร็วขึ้น', con: 'ระยะสั้น ทีละนิด',
  },
  hammer: {
    name: 'ค้อนยักษ์', type: 'slam', dmg: 28, range: 1.5, radius: 1.7, windup: 620, cooldown: 1500, knock: 3.2, move: 0.78, anim: 'slam',
    pro: 'แรงสุด ทุบเป็นวง กระเด็นไกล', con: 'ง้างนาน เดินช้า กระโดดหลบได้',
  },
  spear: {
    name: 'หอก', type: 'melee', dmg: 15, range: 3, arc: 30, windup: 220, cooldown: 780, knock: 2, move: 0.95, anim: 'stab',
    pro: 'แทงไกลที่สุด', con: 'แนวแคบ เล็งพลาดง่าย',
  },
  bow: {
    name: 'ธนู', type: 'shot', dmg: 11, speed: 20, radius: 0.35, life: 1.2, windup: 260, cooldown: 850, knock: 0.8, move: 0.85, anim: 'shoot',
    pro: 'ยิงไกล ลูกเร็ว', con: 'โดนเสาบัง กระโดดข้ามได้',
  },
  staff: {
    name: 'คทาไฟ', type: 'shot', dmg: 20, speed: 9, radius: 0.85, life: 2, windup: 380, cooldown: 1700, knock: 2.4, move: 0.9, anim: 'cast',
    pro: 'ลูกไฟใหญ่ โดนง่าย แรง', con: 'ลูกช้า ยิงช้า หลบทันถ้าระวัง',
  },
};
export const WEAPON_KINDS = Object.keys(WEAPONS).filter((kind) => kind !== 'fists');

// ลูกยิงลอยที่ความสูงอก (ตีนยืน + 1 m) · ตีนคนโดนต้องอยู่ต่ำกว่าลูก และหัวสูงกว่า → กระโดดข้ามลูกธนูได้
export const SHOT_HEIGHT = 1;
// ค้อนทุบพื้น: ลอยสูงจากพื้นที่คนทุบยืนเกินเท่านี้ = รอด
export const SLAM_DODGE_Y = 0.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampArena = (v) => clamp(v, -(ARENA_HALF - BODY_RADIUS), ARENA_HALF - BODY_RADIUS);

// จุด (x, z) อยู่ในเสาไหม (pad = เผื่อรัศมี เช่น ตัวคน/ลูกไฟ)
export function inPillar(x, z, pad = 0) {
  return PILLARS.some((p) => Math.abs(x - p.x) < p.s + pad && Math.abs(z - p.z) < p.s + pad);
}
