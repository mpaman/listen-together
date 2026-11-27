// ความสูงพื้นของลาน: แบ่งเป็นช่อง 1×1 แต่ละช่องสูงเป็นขั้นละ LEVEL แบบบล็อก voxel
// คิดจากสูตรคงที่ (hash ของพิกัด ไม่ใช่สุ่มตามลำดับ) → ทุกเครื่องได้ภูเขาหน้าตาเดียวกันและชนตรงกัน
// แยกจาก lounge-world.js เพราะไม่ต้องใช้ three → เทสใน Node ได้ (test/lounge-terrain.test.js)
// ขนาดลานต้องตรงกับ server/avatar.js (ROOM_HALF_*) · เวที/สระต้องตรงกับ server/items.js (NO_SPAWN)

export const HALF_X = 24;
export const HALF_Z = 18;
export const STAGE = { x0: -8, x1: 8, z0: -7, z1: 5 };
export const POND = { x0: 11, x1: 19, z0: 6, z1: 12 };
export const LEVEL = 0.5; // สูง 1 ขั้น (เมตร)
export const STEP_UP = 0.55; // เดินขึ้นได้เองแค่ 1 ขั้น · สูงกว่านี้ต้องกระโดด
export const MAX_LEVEL = 10;
export const BODY_RADIUS = 0.28;

export const inRect = (x, z, r, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
export const onPath = (x, z) => (Math.abs(x) <= 1.2 && z > STAGE.z1) || (Math.abs(z - 9) <= 1.2 && Math.abs(x) < HALF_X);

// ---------- noise แบบคงที่ ----------
export function hash2(ix, iz) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
// value noise 0..1 ที่ค่อยๆ เปลี่ยน (scale = ขนาดเนิน เป็นจำนวนช่อง)
export function noise2(x, z, scale, salt = 0) {
  const gx = x / scale;
  const gz = z / scale;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const fx = smooth(gx - x0);
  const fz = smooth(gz - z0);
  const v = (i, j) => hash2(x0 + i + salt * 131, z0 + j - salt * 71);
  const top = v(0, 0) + (v(1, 0) - v(0, 0)) * fx;
  const bottom = v(0, 1) + (v(1, 1) - v(0, 1)) * fx;
  return top + (bottom - top) * fz;
}

// ---------- จุดเด่นของแมพ ----------
// ภูเขาเป็นวงรี: ยอดแบน ไหล่เขาชัน + ขรุขระด้วย noise → บางช่วงเดินขึ้นได้ บางช่วงต้องกระโดด
const HILLS = [
  { x: -17, z: -11, rx: 7.5, rz: 6.5, peak: 9, kind: 'mountain' }, // ภูเขาหิมะ มุมซ้ายบน
  { x: -16, z: 12.5, rx: 6, rz: 5, peak: 4, kind: 'hill' }, // เนินซ้ายล่าง (ทางเดินผ่ากลางเป็นหุบ)
  { x: -7, z: 14.5, rx: 4.5, rz: 3.5, peak: 3, kind: 'hill' },
  { x: 21, z: 2, rx: 3.5, rz: 5, peak: 3, kind: 'hill' }, // เนินขวาข้างสระ
];
// ที่ราบสูงทรายแดง (mesa) มุมขวาบน + บันไดขึ้นทางซ้าย
const MESA = { x0: 12, x1: 22, z0: -16, z1: -8, level: 6 };
const MESA_STAIRS = { x0: 6, x1: 12, z0: -12, z1: -10 }; // ขึ้นทีละขั้นตามแกน x
// เสากระโดด (parkour) มุมล่าง: ต้องกระโดดข้ามช่องว่างไล่ขึ้นไปจนถึงหอชมวิว
// [ช่อง x, ช่อง z, ขั้น]
const PILLARS = [
  [3, 16, 1], [5, 16, 2], [7, 16, 3], [9, 15, 4], [9, 13, 5], [7, 12, 6], [5, 13, 7],
  [3, 12, 8], [3, 13, 8], [2, 12, 8], [2, 13, 8], // หอชมวิว 2×2
];
const PILLAR_MAP = new Map(PILLARS.map(([x, z, l]) => [`${x},${z}`, l]));
export const PARKOUR = { x0: 1.5, x1: 10.5, z0: 11.5, z1: 17.5 };

function hillLevel(cx, cz) {
  let best = { level: 0, kind: 'ground' };
  for (const h of HILLS) {
    const d = Math.hypot((cx - h.x) / h.rx, (cz - h.z) / h.rz);
    if (d >= 1) continue;
    const rough = (noise2(cx, cz, 2.5, 3) - 0.5) * 2.2;
    const level = Math.round(h.peak * smooth(Math.min(1, (1 - d) * 1.35)) + rough * (1 - d * 0.5));
    if (level > best.level) best = { level, kind: h.kind };
  }
  return best;
}

// ฉากหลังเวที: ขั้นบันไดดินไล่ขึ้นไปทางเหนือ (ไม่บังจอ เพราะอยู่หลังกำแพงเวที)
function ridgeLevel(cx, cz) {
  if (Math.abs(cx) > 10.5 || cz > -8) return 0;
  return Math.min(6, Math.ceil((-8 - cz) / 1.6));
}

function mesaLevel(cx, cz) {
  if (inRect(cx, cz, MESA)) {
    // ขอบกร่อนนิดๆ ไม่ให้เป็นกล่องเหลี่ยมเป๊ะ
    const edge = Math.min(cx - MESA.x0, MESA.x1 - cx, cz - MESA.z0, MESA.z1 - cz);
    return edge < 1 && noise2(cx, cz, 1.5, 9) < 0.35 ? MESA.level - 1 : MESA.level;
  }
  if (inRect(cx, cz, MESA_STAIRS)) return Math.max(1, Math.min(MESA.level, Math.floor(cx - MESA_STAIRS.x0) + 1));
  return 0;
}

// ขั้น + ชนิดของช่องที่ศูนย์กลาง (cx, cz) — ยังไม่รวมโซนที่บังคับให้แบน
function rawCell(ix, iz) {
  const cx = ix + 0.5;
  const cz = iz + 0.5;
  const pillar = PILLAR_MAP.get(`${ix},${iz}`);
  if (pillar !== undefined) return { level: pillar, kind: 'pillar' };
  if (inRect(cx, cz, PARKOUR)) return { level: 0, kind: 'ground' }; // ช่องว่างระหว่างเสาต้องเป็นพื้นราบ
  const mesa = mesaLevel(cx, cz);
  if (mesa) return { level: mesa, kind: 'mesa' };
  const hill = hillLevel(cx, cz);
  const ridge = ridgeLevel(cx, cz);
  // เนินเตี้ยๆ ทั่วลาน (0–1 ขั้น) ให้พื้นไม่แบนเป็นกระดาน
  const mound = noise2(cx, cz, 5, 1) > 0.68 ? 1 : 0;
  const level = Math.max(hill.level, ridge, mound);
  if (level === 0) return { level: 0, kind: 'ground' };
  if (hill.level === level) return hill;
  return { level, kind: ridge === level ? 'ridge' : 'hill' };
}

// โซนที่ต้องแบนเสมอ: เวที (ที่นั่ง/ฟลอร์/จอ) · สระ+ขอบหิน · ทางเดิน · ขอบรั้ว
function forcedFlat(cx, cz) {
  return inRect(cx, cz, STAGE, 1.5)
    || inRect(cx, cz, POND, 1.2)
    || onPath(cx, cz)
    || Math.abs(cx) > HALF_X - 1.5
    || Math.abs(cz) > HALF_Z - 1.5;
}

// ---------- ตาราง (คิดครั้งเดียวตอนโหลด) ----------
const X0 = -HALF_X - 1;
const Z0 = -HALF_Z - 1;
const W = HALF_X * 2 + 2;
const D = HALF_Z * 2 + 2;
const levels = new Uint8Array(W * D);
const kinds = new Array(W * D);
for (let i = 0; i < W; i += 1) {
  for (let j = 0; j < D; j += 1) {
    const ix = X0 + i;
    const iz = Z0 + j;
    const cell = forcedFlat(ix + 0.5, iz + 0.5) ? { level: 0, kind: 'ground' } : rawCell(ix, iz);
    levels[i * D + j] = Math.max(0, Math.min(MAX_LEVEL, cell.level));
    kinds[i * D + j] = cell.kind;
  }
}

// ข้อมูลช่อง (ix, iz) = ช่องที่ครอบ [ix, ix+1) × [iz, iz+1) · นอกตาราง = พื้นราบ
export function cellAt(ix, iz) {
  const i = ix - X0;
  const j = iz - Z0;
  if (i < 0 || j < 0 || i >= W || j >= D) return { level: 0, kind: 'ground' };
  return { level: levels[i * D + j], kind: kinds[i * D + j] };
}

export const eachCell = (fn) => {
  for (let i = 0; i < W; i += 1) for (let j = 0; j < D; j += 1) fn(X0 + i, Z0 + j, levels[i * D + j], kinds[i * D + j]);
};

// ความสูงผิวพื้น (เมตร) ตรงจุด (x, z)
export const groundAt = (x, z) => cellAt(Math.floor(x), Math.floor(z)).level * LEVEL;

// พื้นที่รองรับตัวละคร = ช่องที่สูงที่สุดใต้รอยเท้า (สี่เหลี่ยมรอบตัว) → ยืนริมหน้าผาได้ไม่ร่วง
export function supportAt(x, z, r = BODY_RADIUS) {
  return Math.max(groundAt(x - r, z - r), groundAt(x + r, z - r), groundAt(x - r, z + r), groundAt(x + r, z + r));
}

// ตำแหน่งนี้มีผนังสูงเกินกว่าจะก้าวขึ้นจากความสูง y ไหม
// step = ก้าวขึ้นได้เองเท่าไหร่ · ลอยกลางอากาศใช้ AIR_STEP (ต้องลอยพ้นขอบจริงๆ ถึงจะขึ้นไปยืนได้)
export const AIR_STEP = 0.05;
export const blockedAt = (x, z, y, step = STEP_UP) => supportAt(x, z) > y + step;
