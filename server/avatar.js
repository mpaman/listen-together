// ตัวละครในห้อง 3D: server ไม่คำนวณฟิสิกส์ — แต่ละเครื่องคุมตัวเอง แล้วส่งท่าทาง/ตำแหน่งมา
// หน้าที่ของไฟล์นี้ = กรองข้อมูลที่ client ส่งมาให้อยู่ในกรอบ (กันส่งค่าแปลกๆ ไปพังเครื่องคนอื่น)

// จำนวนตัวเลือกของแต่ละส่วน — ต้องตรงกับ public/lounge-avatar.js
// ตัวละครโมเดล 3D (public/lounge-model.js) ใช้: cls = คลาส (5 แบบ ตรงกับ CLASSES) · body = สีเสื้อ / outfit = สีผ้าคลุม (0 = สีเดิม, 1..10 = BODY_COLORS)
// hat = 0 ของประจำตัวละคร / 1..6 หมวกแบบเก่า / 7 ไม่ใส่ · back = ของบนหลังแบบเก่า (ปลอกดาบ ธนู ปีก ผ้าคลุม ...)
// skin / face ใช้แค่ตัวกล่องที่โชว์ระหว่างโหลด
export const LOOK_PARTS = { body: 11, skin: 6, hat: 8, face: 4, back: 9, outfit: 11, cls: 5 };
// ลานทั้งหมด (เวทีฟังเพลงอยู่ตรงกลาง) — ต้องตรงกับ HALF_X/HALF_Z ใน public/lounge-terrain.js
export const ROOM_HALF_X = 24;
export const ROOM_HALF_Z = 18;
export const SEAT_COUNT = 8;
// สูงสุดที่ยืนได้ (ยอดเขา 10 ขั้น × 0.5 m) + เผื่อลอยตอนกระโดด — ต้องตรงกับ MAX_LEVEL/LEVEL ใน public/lounge-terrain.js
export const MAX_Y = 7;
export const GESTURES = ['jump', 'punch', 'wave', 'dance', 'laugh', 'love', 'party', 'cry', 'clap', 'angry', 'hit'];

const isIndex = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function randomLook(rand = Math.random) {
  return Object.fromEntries(Object.entries(LOOK_PARTS).map(([key, n]) => [key, Math.floor(rand() * n)]));
}

// ค่าที่ไม่ถูกต้อง → สุ่มให้แทน (ตัวละครต้องมีหน้าตาเสมอ)
export function cleanLook(raw, rand = Math.random) {
  const fallback = randomLook(rand);
  if (!raw || typeof raw !== 'object') return fallback;
  return Object.fromEntries(Object.keys(LOOK_PARTS).map((key) => [key, isIndex(raw[key], LOOK_PARTS[key]) ? raw[key] : fallback[key]]));
}

// ตำแหน่ง: บีบให้อยู่ในห้อง · ry = ทิศที่หันหน้า (เรเดียน) · sit = เลขที่นั่ง หรือ null
export function cleanPose(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { x, z, ry } = raw;
  if (![x, z, ry].every(Number.isFinite)) return null;
  const round = (v) => Math.round(v * 100) / 100;
  return {
    x: round(clamp(x, -ROOM_HALF_X, ROOM_HALF_X)),
    // y = ความสูงเท้า (ยืนบนภูเขา/กำลังกระโดด) · client รุ่นเก่าไม่ส่งมา → 0 (ยืนพื้น)
    y: Number.isFinite(raw.y) ? round(clamp(raw.y, 0, MAX_Y)) : 0,
    z: round(clamp(z, -ROOM_HALF_Z, ROOM_HALF_Z)),
    ry: round(((ry % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)),
    sit: isIndex(raw.sit, SEAT_COUNT) ? raw.sit : null,
    // ท่าค้าง (นั่งพื้น/นอน/ไหว้) · ค้างจนกดใหม่หรือเดิน
    rest: RESTS.includes(raw.rest) ? raw.rest : null,
  };
}

export const RESTS = ['sit', 'lie', 'hello'];

export const cleanGesture = (raw) => (GESTURES.includes(raw) ? raw : null);

// จุดเกิด: กระจายรอบกลางห้อง ไม่ให้ทุกคนทับกันที่จุดเดียว
export function spawnPose(rand = Math.random) {
  const angle = rand() * 2 * Math.PI;
  const r = 1 + rand() * 1.5;
  return cleanPose({ x: Math.cos(angle) * r, z: 1 + Math.sin(angle) * r * 0.6, ry: 0 });
}

// จำกัดความถี่แบบหน้าต่างเลื่อนตายตัว 1 วินาที (ตำแหน่งส่งถี่ได้กว่า action ปกติ)
export function createPerSecondLimiter(max) {
  let windowStart = 0;
  let count = 0;
  return (now) => {
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}
