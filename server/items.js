// ไอเทมแต่งตัวในลาน 3D (ดาบ กีตาร์ ไมค์ ...) — ถือโชว์อย่างเดียว ไม่มีผลกับคนอื่น
// server เป็นคนตัดสินว่าใครเก็บได้ (กันสองคนเก็บชิ้นเดียวกันพร้อมกัน)
// ฟังก์ชันในไฟล์นี้ไม่แตะ socket — รับสถานะห้อง คืนผลลัพธ์ ให้ index.js เป็นคนกระจาย
import { ROOM_HALF_X, ROOM_HALF_Z } from './avatar.js';

// ต้องตรงกับ public/lounge-items.js
export const ITEM_KINDS = ['sword', 'guitar', 'mic', 'torch', 'shield', 'wand'];
export const MAX_GROUND_ITEMS = 6;
export const SPAWN_EVERY_MS = 15_000;
// ตำแหน่งที่ server รู้มาช้ากว่าจริง ~100–200 ms → เผื่อระยะไว้ (client เก็บตอนห่าง ≤ 1 หน่วย)
export const PICK_RANGE = 2;

// พื้นที่ที่ไม่ให้ของเกิด: เวทีกลาง (จอ/โซฟา) + สระน้ำ — ต้องตรงกับ BLOCKS ใน public/lounge-world.js
const NO_SPAWN = [
  { x0: -8, x1: 8, z0: -7, z1: 5 }, // เวที
  { x0: 11, x1: 19, z0: 6, z1: 12 }, // สระ
];
const SPAWN_MARGIN = 2;

export const isItemKind = (kind) => ITEM_KINDS.includes(kind);
const inside = (x, z, a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1;
const round = (v) => Math.round(v * 100) / 100;

export function createItemState() {
  return { ground: [], seq: 0, lastSpawnAt: 0 };
}

// ของที่วางอยู่บนพื้น (ส่งให้ client)
export const groundList = (state) => state.ground.map(({ id, kind, x, z }) => ({ id, kind, x, z }));

function placeOnGround(state, kind, x, z) {
  state.seq += 1;
  const item = {
    id: state.seq,
    kind,
    x: round(Math.max(-ROOM_HALF_X, Math.min(ROOM_HALF_X, x))),
    z: round(Math.max(-ROOM_HALF_Z, Math.min(ROOM_HALF_Z, z))),
  };
  state.ground.push(item);
  return item;
}

// จุดเกิดสุ่ม: ห่างขอบ ไม่อยู่บนเวที/ในสระ (สุ่มใหม่ได้ไม่เกิน 20 ครั้ง ไม่เจอก็ไม่วาง)
function randomSpot(rand) {
  for (let i = 0; i < 20; i += 1) {
    const x = (rand() * 2 - 1) * (ROOM_HALF_X - SPAWN_MARGIN);
    const z = (rand() * 2 - 1) * (ROOM_HALF_Z - SPAWN_MARGIN);
    if (!NO_SPAWN.some((area) => inside(x, z, area))) return { x, z };
  }
  return null;
}

// เรียกเป็นระยะ: ครบเวลาและของบนพื้นยังไม่เต็ม → วางของใหม่ 1 ชิ้น · คืนของที่วาง หรือ null
export function spawnTick(state, now, rand = Math.random) {
  if (now - state.lastSpawnAt < SPAWN_EVERY_MS || state.ground.length >= MAX_GROUND_ITEMS) return null;
  const spot = randomSpot(rand);
  if (!spot) return null;
  state.lastSpawnAt = now;
  const kind = ITEM_KINDS[Math.floor(rand() * ITEM_KINDS.length)];
  return placeOnGround(state, kind, spot.x, spot.z);
}

// เก็บของ: ต้องมีของชิ้นนั้นจริง และยืนใกล้พอ · ถือของอยู่แล้ว = สลับ (ของเก่าหล่นที่เท้า)
// คืน { held, dropped } หรือ null ถ้าเก็บไม่ได้
export function pickUp(state, user, rawId) {
  const index = state.ground.findIndex((item) => item.id === rawId);
  if (index < 0 || !user?.pose) return null;
  const item = state.ground[index];
  if (Math.hypot(item.x - user.pose.x, item.z - user.pose.z) > PICK_RANGE) return null;
  state.ground.splice(index, 1);
  const dropped = user.held ? placeOnGround(state, user.held, user.pose.x, user.pose.z) : null;
  user.held = item.kind;
  return { held: item.kind, dropped };
}

// วางของที่ถืออยู่ลงตรงที่ยืน (ใช้ตอนกดวาง และตอนออกจากห้อง) · คืนของที่วาง หรือ null
export function drop(state, user) {
  if (!user?.held || !user.pose) return null;
  const item = placeOnGround(state, user.held, user.pose.x, user.pose.z);
  user.held = null;
  return item;
}
