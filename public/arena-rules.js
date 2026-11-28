// กติกาลานประลอง 1v1 — ใช้ร่วมกันทั้ง server (ตัดสินดาเมจ) และหน้าเว็บ (วาดลาน/โชว์ค่าอาวุธ)
// ไฟล์เดียวกันสองฝั่ง → ตัวเลขไม่มีทางเพี้ยนกัน · ห้ามใช้ DOM/three ในไฟล์นี้ (server import ด้วย)
// พิกัดในไฟล์นี้เป็นพิกัด "ในลาน" (กลางลาน = 0,0) หน้าเว็บค่อยบวกตำแหน่งลานในโลก 3D เอง

export const ARENA_HALF = 9; // ลานสี่เหลี่ยม 18 × 18 m
export const HP_MAX = 100;
export const COUNTDOWN_MS = 3000;
export const FIGHT_MS = 90_000;
export const RESULT_MS = 5500; // โชว์ผลแพ้ชนะก่อนส่งกลับลานฟังเพลง (เผื่อท่าปิดเกม ~1.6 วิ ให้ดูจบก่อนป้ายผล)
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.9;

// ลานประลอง 3 แบบ สุ่มทุกแมตช์ (Man ขอ 11-28 ให้ไม่ซ้ำเดิม) · obstacles = กล่องที่เดินผ่านไม่ได้ + ลูกยิงชนแล้วหาย
// x, z = กลาง · sx, sz = ครึ่งความกว้าง/ลึก · h = ความสูง (ใช้แค่วาด · ชนกันดูแค่แนวราบ)
// จุดเกิด (0, ±6.5) กับกลางลานต้องว่างทุกแบบ (test เช็ค) · ต่างกันที่การเล่น:
//   ลานหิน = เสา 4 มุม หลบลูกยิงได้ · ซากปราสาท = ก้อนใหญ่กลางลานบังสายตา ต้องอ้อมเข้าหา · ทุ่งหิมะ = หินเตี้ยกระจาย ที่โล่งเยอะ ธนูได้เปรียบ
const box = (x, z, sx, sz, h) => ({ x, z, sx, sz, h });
export const ARENA_MAPS = {
  stone: {
    name: 'ลานหิน',
    obstacles: [box(-4.5, -4.5, 0.7, 0.7, 2.6), box(4.5, -4.5, 0.7, 0.7, 2.6), box(-4.5, 4.5, 0.7, 0.7, 2.6), box(4.5, 4.5, 0.7, 0.7, 2.6)],
  },
  ruins: {
    name: 'ซากปราสาท',
    obstacles: [box(0, 0, 1.3, 1.3, 2.4), box(-5.5, 0, 0.45, 2.4, 1.8), box(5.5, 0, 0.45, 2.4, 1.8), box(-2.6, -4.2, 0.9, 0.35, 1.2), box(2.6, 4.2, 0.9, 0.35, 1.2)],
  },
  snow: {
    name: 'ทุ่งหิมะ',
    obstacles: [box(-3, -2.5, 0.6, 0.6, 1.3), box(3, 2.5, 0.6, 0.6, 1.3), box(-6, 3, 0.8, 0.5, 1.1), box(6, -3, 0.8, 0.5, 1.1), box(2.8, -5.2, 0.5, 0.5, 1.2), box(-2.8, 5.2, 0.5, 0.5, 1.2)],
  },
};
export const MAP_KINDS = Object.keys(ARENA_MAPS);
export const pickMap = (rand = Math.random) => MAP_KINDS[Math.floor(rand() * MAP_KINDS.length)];
export const obstaclesOf = (map) => (ARENA_MAPS[map] ?? ARENA_MAPS.stone).obstacles;
// ลานหินเดิม (โค้ด/test ที่ยังไม่รู้จักหลายแผนที่ใช้ค่านี้)
export const PILLARS = ARENA_MAPS.stone.obstacles;

// คนแรกเกิดฝั่ง +z หันเข้ากลาง (ry = π) · คนที่สองฝั่ง -z (ry = 0)
export const SPAWNS = [
  { x: 0, z: 6.5, ry: Math.PI },
  { x: 0, z: -6.5, ry: 0 },
];

// type: melee = ฟันเป็นรูปพัดตรงหน้า · slam = ทุบพื้นเป็นวงข้างหน้า (กระโดดหลบได้) · shot = ยิงลูกบิน
// windup = เวลาง้างก่อนโดนจริง (คู่ต่อสู้เห็นท่าแล้วหลบได้) · cooldown = นับจากกด
// move = ตัวคูณความเร็วเดินตอนถือ · knock = ระยะกระเด็น (m)
// guard = บล็อกด้วยอาวุธนี้ลดดาเมจได้กี่ส่วน (0–1) · pierce = ทะลุการบล็อกของอีกฝ่ายกี่ส่วน
// wall = โล่ใหญ่: บล็อกแล้วโดนแค่ SHIELD.chip ทุกท่า แต่เสียสตามินาต่อครั้งที่รับ (สตามินาไม่พอ = กันได้แค่ guard ปกติ)
// ตีกับบล็อกไม่ใช้สตามินา (Man ตั้ง 2026-11-27) — สตามินามีไว้คุมการกลิ้งอย่างเดียว
// hint = ประโยคสั้นบอกวิธีใช้ (โชว์ตอนเอาเมาส์ชี้การ์ดอาวุธ)
// ค่าตัวเลขปรับ 2026-11-28 จากจำลองบอทชนบอท (ระดับ normal ทุกคู่อาวุธ 150 แมตช์):
// ก่อนปรับ มีดคู่ชนะ 90% · ดาบ 81% · โล่ 8% → หลังปรับทุกอาวุธอยู่ช่วง 34–52% (หมัด ~20% เพราะเป็นของติดตัวสำรอง)
// มีดคู่ง้างเดิม 50 ms เร็วกว่าที่ใครจะหลบทัน → เพิ่มเป็น 100 ms · ค้อนดาเมจ 32 = ต้องโดน 4 ที (34 = 3 ที แรงเกิน)
export const WEAPONS = {
  fists: {
    name: 'หมัด', type: 'melee', dmg: 5, range: 1.4, arc: 70, windup: 80, cooldown: 380, knock: 1, move: 1.05, anim: 'jab',
    guard: 0.4, hint: 'ติดตัวเสมอ ใช้ตอนอาวุธยังไม่พร้อม',
    pro: 'ออกหมัดไว', con: 'เบามาก ต้องเข้าประชิด',
  },
  sword: {
    name: 'ดาบ', type: 'melee', dmg: 12, range: 2, arc: 80, windup: 160, cooldown: 600, knock: 1.6, move: 1, anim: 'slash',
    guard: 0.7, hint: 'ฟันเป็นพัดข้างหน้า บล็อกได้ดีพอใช้',
    pro: 'สมดุล ฟันกว้าง ใช้ง่าย', con: 'ไม่มีจุดเด่นพิเศษ',
  },
  dagger: {
    name: 'มีดคู่', type: 'melee', dmg: 6, range: 1.5, arc: 70, windup: 100, cooldown: 320, knock: 0.6, move: 1.12, anim: 'jab',
    guard: 0.5, hint: 'กดรัวๆ ตามติดตัว ใช้คู่กับการกลิ้ง',
    pro: 'ฟันรัวที่สุด วิ่งเร็วขึ้น', con: 'ระยะสั้น ทีละนิด',
  },
  hammer: {
    name: 'ค้อนยักษ์', type: 'slam', dmg: 32, range: 1.5, radius: 1.9, windup: 520, cooldown: 1250, knock: 3.2, move: 0.85, anim: 'slam',
    guard: 0.8, hint: 'ทุบเป็นวงข้างหน้า มีวงแดงเตือนอีกฝ่าย · ทะลุบล็อกครึ่งหนึ่ง', pierce: 0.5,
    pro: 'แรงสุด ทุบเป็นวง กระเด็นไกล', con: 'ง้างนาน เดินช้า กระโดดหลบได้',
  },
  spear: {
    name: 'หอก', type: 'melee', dmg: 17, range: 3, arc: 36, windup: 220, cooldown: 680, knock: 2, move: 0.95, anim: 'stab',
    guard: 0.6, hint: 'แทงตรงไกล 3 m ยืนห่างแล้วจิ้ม',
    pro: 'แทงไกลที่สุด', con: 'แนวแคบ เล็งพลาดง่าย',
  },
  bow: {
    name: 'ธนู', type: 'shot', dmg: 12, speed: 20, radius: 0.35, life: 1.2, windup: 260, cooldown: 850, knock: 0.8, move: 0.85, anim: 'shoot',
    guard: 0.3, hint: 'ยิงลูกเร็ว หลบหลังเสาได้ · กระโดดข้ามลูกได้',
    pro: 'ยิงไกล ลูกเร็ว', con: 'โดนเสาบัง กระโดดข้ามได้',
  },
  shield: {
    name: 'โล่ใหญ่', type: 'melee', dmg: 11, range: 1.5, arc: 90, windup: 140, cooldown: 520, knock: 2.2, move: 0.85, anim: 'jab',
    guard: 0.5, wall: true, hint: 'ค้างบล็อกไว้ โดนแค่ 1 ดาเมจ แต่รับแต่ละครั้งเสียสตามินา · กระแทกโล่ผลักกระเด็น',
    pro: 'บล็อกแทบไม่เข้า (1 ดาเมจ)', con: 'ตีเบา เดินช้า สตามินาหมดโล่ก็กันไม่อยู่',
  },
  staff: {
    name: 'คทาไฟ', type: 'shot', dmg: 18, speed: 9, radius: 0.85, life: 2, windup: 380, cooldown: 1700, knock: 2.4, move: 0.9, anim: 'cast',
    guard: 0.4, hint: 'ลูกไฟใหญ่ช้า ยิงดักทางที่อีกฝ่ายจะเดินไป',
    pro: 'ลูกไฟใหญ่ โดนง่าย แรง', con: 'ลูกช้า ยิงช้า หลบทันถ้าระวัง',
  },
};
export const WEAPON_KINDS = Object.keys(WEAPONS).filter((kind) => kind !== 'fists');

export const DEFAULT_LOADOUT = ['sword', 'bow'];
// อาวุธหลัก/รองต้องเป็นอาวุธที่มีจริงและไม่ซ้ำกัน · ผิดรูป → ใช้ชุดเริ่มต้น
export function cleanLoadout(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_LOADOUT];
  const [main, sub] = raw;
  if (!WEAPON_KINDS.includes(main) || !WEAPON_KINDS.includes(sub) || main === sub) return [...DEFAULT_LOADOUT];
  return [main, sub];
}

// ---------- สตามินา / ท่าหลบ ----------
// ใช้แค่ตอนกลิ้ง (กันกลิ้งรัวจนอมตะตลอด) · ไม่ได้กลิ้งสักพัก = ฟื้นเอง
export const STAMINA = {
  max: 100,
  regen: 30, // ต่อวินาที
  regenDelay: 650, // กลิ้งแล้วพักนานเท่านี้ก่อนเริ่มฟื้น (ms)
  roll: 30,
  // dash: 20, // ปิดไว้ก่อน: แดชพุ่งไกลเร็วเกินไป เล่นแล้วโกง (Man ขอ 2026-11-27) · เปิดกลับ = ใส่ค่านี้ + DASH_ENABLED = true
};
export const DASH_ENABLED = false;
// โล่ใหญ่: บล็อกได้ = โดน chip ดาเมจ · เสียสตามินา cost ต่อครั้ง (ท่าที่ทะลุบล็อก เช่น ค้อน เสียเพิ่มตาม pierce)
export const SHIELD = { chip: 1, cost: 15 };
// ยาเติมเลือด: แมตช์ละ 2 ขวด · ดื่มนาน (ระหว่างดื่มเดินช้า ตี/กลิ้ง/บล็อกไม่ได้) → ต้องหาจังหวะปลอดภัยก่อนดื่ม
// เลือดเข้าตอนดื่มเสร็จ · โดนตีระหว่างดื่มไม่ยกเลิก (ขวดหมดไปแล้วตั้งแต่ยกดื่ม) · Man ขอ 11-28
export const POTION = { count: 2, heal: 35, ms: 1600, move: 0.35 };
export const ROLL_MS = 480; // กลิ้งทั้งท่า (ตีไม่ได้)
export const ROLL_IFRAME_MS = 330; // ช่วงแรกของการกลิ้ง = โดนอะไรไม่เข้า
export const ROLL_DIST = 3.4; // กลิ้งไปไกลกี่ m
export const DASH_MS = 170;
export const DASH_DIST = 3;
export const SWAP_MS = 350; // สลับอาวุธแล้วต้องรอแป๊บนึงก่อนตี
export const BLOCK_ARC = 150; // บล็อกได้เฉพาะที่มาจากด้านหน้า (องศารวม)
export const BLOCK_MOVE = 0.5; // ยกการ์ดอยู่เดินช้าลง

// ลูกยิงลอยที่ความสูงอก (ตีนยืน + 1 m) · ตีนคนโดนต้องอยู่ต่ำกว่าลูก และหัวสูงกว่า → กระโดดข้ามลูกธนูได้
export const SHOT_HEIGHT = 1;
// ค้อนทุบพื้น: ลอยสูงจากพื้นที่คนทุบยืนเกินเท่านี้ = รอด
export const SLAM_DODGE_Y = 0.6;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clampArena = (v) => clamp(v, -(ARENA_HALF - BODY_RADIUS), ARENA_HALF - BODY_RADIUS);

// จุด (x, z) อยู่ในสิ่งกีดขวางไหม (pad = เผื่อรัศมี เช่น ตัวคน/ลูกไฟ) · obstacles = ของแผนที่นั้น (obstaclesOf)
export function inPillar(x, z, pad = 0, obstacles = PILLARS) {
  return obstacles.some((p) => Math.abs(x - p.x) < p.sx + pad && Math.abs(z - p.z) < p.sz + pad);
}
