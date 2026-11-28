// พื้นลานฟังเพลงแบบ "ผืนเดียว": ยังเป็นขั้นบันได (ชนตรงกับ lounge-terrain.js เป๊ะ) แต่ขอบลบมุม + สีไล่เนียน
// เดิมเป็นกล่อง 1×1 หลายพันก้อน → ดูเป็นตาราง voxel และวาดหน้าที่ถูกบังไว้ทิ้งเปล่าๆ
// แบบใหม่สร้างเฉพาะผิวที่มองเห็น (หน้าบน + ผนังตรงที่ช่องข้างๆ ต่ำกว่า) → จุดยอดน้อยลงหลายเท่า
// ภูเขาฉากหลังนอกรั้วเป็นผืนลอนโค้งต่อเนื่อง (เดินไม่ได้) แทนเสา voxel ~2,000 ต้น
import * as THREE from 'three';
import { cellAt, eachCell, HALF_X, HALF_Z, inRect, LEVEL, noise2, hash2, onPath, POND, STAGE } from './lounge-terrain.js';

const CHAMFER = 0.1; // ลบมุมขอบบนของขั้น · ต้องน้อยกว่าครึ่งขั้น (LEVEL) ไม่งั้นหน้าบนหาย
const POND_BED = -0.6; // ก้นสระ (ผิวน้ำอยู่ -0.25)
const OUTSIDE = -0.5; // นอกตาราง = ทุ่งหญ้าที่ต่ำลงไป → ขอบลานมีผนังลงไปหาทุ่ง
const BACKDROP_STEP = 0.5; // ความละเอียดผืนภูเขาฉากหลัง (เมตรต่อช่อง)

const onDance = (x, z) => Math.hypot(x, z - 0.6) <= 3; // = DANCE_FLOOR ใน lounge-world.js (import วนกันไม่ได้)

// ---------- สี ----------
const hex = (h) => new THREE.Color(h);
const PAL = {
  grass: [hex(0x4fa83f), hex(0x6dc455), hex(0x3e8948)],
  path: [hex(0xdcc193), hex(0xe4a672)],
  plank: [hex(0xb86f50), hex(0xa65f43), hex(0xc27c5a)],
  rug: [hex(0xa22633), hex(0xc42f3c)],
  bed: hex(0x2f6f73),
  dirt: [hex(0x733e39), hex(0x8f563b), hex(0x5e3a30)],
  rock: [hex(0x5a6988), hex(0x4a5675), hex(0x6f7f9c)],
  stone: [hex(0x8b9bb4), hex(0x7a8aa6)],
  snow: [hex(0xffffff), hex(0xe3ecfb)],
  mesaTop: [hex(0xe4a672), hex(0xead4aa)],
  mesaSide: [hex(0xb86f50), hex(0xbe4a2f), hex(0xa65f43), hex(0xd08a5c)],
  pillarTop: [hex(0x2ce8f5), hex(0x1aa6e0)],
  pillarSide: [hex(0x3a4466), hex(0x262b44)],
};
const tmp = new THREE.Color();
// ผสม 2 สีตาม noise ของตำแหน่งจุดยอด (ไม่ใช่สุ่มรายช่อง) → ช่องติดกันสีต่อกันเนียน ไม่เป็นลายหมากรุก
const blend = (pair, x, z, scale, salt) => tmp.copy(pair[0]).lerp(pair[1], noise2(x, z, scale, salt));

// ชนิดผิวหน้าบนของช่อง
function surfaceOf(ix, iz, level, kind) {
  const cx = ix + 0.5;
  const cz = iz + 0.5;
  if (level > 0) {
    if (kind === 'mesa' || kind === 'pillar') return kind;
    if (level >= 8) return 'snow';
    if (level >= 5) return 'stone';
    return 'grass';
  }
  if (inRect(cx, cz, POND)) return 'pond';
  if (inRect(cx, cz, STAGE)) return onDance(cx, cz) ? 'rug' : 'plank';
  if (onPath(cx, cz)) return 'path';
  return 'grass';
}

// สีหน้าบน ณ จุดยอด (x, z) ของช่อง (ix, iz)
function topColor(surface, ix, iz, x, z, level) {
  switch (surface) {
    case 'pond': return tmp.copy(PAL.bed);
    case 'rug': return tmp.copy(PAL.rug[(ix + iz) & 1]);
    case 'plank': return tmp.copy(PAL.plank[Math.floor(hash2(ix, iz * 7) * 3)]); // ไม้ทีละแผ่น ขอบคม
    case 'path': return blend(PAL.path, x, z, 2.5, 3);
    case 'mesa': return blend(PAL.mesaTop, x, z, 2, 4);
    case 'pillar': return tmp.copy(PAL.pillarTop[(ix + iz) & 1]);
    case 'snow': return blend(PAL.snow, x, z, 1.5, 5);
    case 'stone': return blend(PAL.stone, x, z, 1.5, 6);
    default: { // หญ้า: สองโทนไล่ตาม noise ใหญ่ + จุดเข้มประปราย · บนเนินสูงหญ้าซีดลงนิด
      const c = blend(PAL.grass, x, z, 3.5, 1);
      if (noise2(x, z, 1.2, 2) > 0.72) c.lerp(PAL.grass[2], 0.5);
      return level > 2 ? c.lerp(PAL.stone[1], (level - 2) * 0.08) : c;
    }
  }
}

// สีผนังข้างช่องที่ความสูง y (เป็นชั้นๆ เหมือนชั้นดิน/หิน) · ล่างสุดมืดลง = เงาซอกแบบถูกๆ
function sideColor(surface, ix, iz, y, bottom) {
  const band = Math.floor(y / LEVEL + 0.001);
  const r = hash2(ix * 13 + band, iz * 5 - band);
  let pal = PAL.dirt;
  if (surface === 'mesa') pal = PAL.mesaSide;
  else if (surface === 'pillar') pal = PAL.pillarSide;
  else if (surface === 'snow' || surface === 'stone' || band >= 4) pal = PAL.rock;
  else if (surface === 'pond') pal = PAL.stone;
  tmp.copy(pal[Math.floor(r * pal.length)]);
  return tmp.multiplyScalar(0.65 + 0.35 * Math.min(1, (y - bottom) / 0.6));
}

// ---------- ตัวเก็บสามเหลี่ยม ----------
function collector() {
  const pos = [];
  const col = [];
  const vert = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  return {
    // สี่เหลี่ยม a-b-c-d (เรียงรอบรูป) · colorAt(x, y, z) คืนสีของจุดนั้น
    quad(a, b, c, d, colorAt) {
      for (const p of [a, b, c, a, c, d]) vert(p[0], p[1], p[2], colorAt(p[0], p[1], p[2]));
    },
    tri(a, b, c, colorAt) {
      for (const p of [a, b, c]) vert(p[0], p[1], p[2], colorAt(p[0], p[1], p[2]));
    },
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals(); // ไม่มี index → ได้ normal รายหน้า (หน้าเรียบ ขอบลบมุมสะท้อนแสงชัด)
      return g;
    },
  };
}

// ความสูงที่ "วาด" ของช่อง (สระต่ำลงเป็นแอ่ง · นอกตาราง = ทุ่งหญ้า)
function visualHeight(ix, iz, inGrid) {
  if (!inGrid(ix, iz)) return OUTSIDE;
  if (inRect(ix + 0.5, iz + 0.5, POND)) return POND_BED;
  return cellAt(ix, iz).level * LEVEL;
}

// ---------- พื้นที่เดินได้ ----------
// ด้าน 4 ทิศของช่อง: dx/dz = ทิศไปหาช่องข้างๆ
const SIDES = [
  { dx: -1, dz: 0 }, { dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: 0, dz: 1 },
];

export function buildTerrainMesh() {
  const cells = new Map();
  eachCell((ix, iz, level, kind) => cells.set(`${ix},${iz}`, { level, kind }));
  const inGrid = (ix, iz) => cells.has(`${ix},${iz}`);
  const out = collector();

  for (const [key, { level, kind }] of cells) {
    const [ix, iz] = key.split(',').map(Number);
    const surface = surfaceOf(ix, iz, level, kind);
    const h = visualHeight(ix, iz, inGrid);
    const x0 = ix;
    const x1 = ix + 1;
    const z0 = iz;
    const z1 = iz + 1;
    const lower = SIDES.map((s) => visualHeight(ix + s.dx, iz + s.dz, inGrid));
    const cut = lower.map((n) => (n < h - 0.01 ? CHAMFER : 0)); // ลบมุมเฉพาะด้านที่ต่ำลง
    const [cL, cR, cB, cF] = cut;
    const top = (x, _y, z) => topColor(surface, ix, iz, x, z, level);
    const ht = h - CHAMFER;

    // หน้าบน (หดเข้าตรงด้านที่ลบมุม)
    out.quad([x0 + cL, h, z0 + cB], [x1 - cR, h, z0 + cB], [x1 - cR, h, z1 - cF], [x0 + cL, h, z1 - cF], top);

    // แถบลาดลบมุม + ปิดรูสามเหลี่ยมที่ปลายแถบ (ตรงที่ด้านข้างไม่ได้ลบมุม)
    if (cL) {
      out.quad([x0 + CHAMFER, h, z0 + cB], [x0 + CHAMFER, h, z1 - cF], [x0, ht, z1 - cF], [x0, ht, z0 + cB], top);
      if (!cB) out.tri([x0, h, z0], [x0 + CHAMFER, h, z0], [x0, ht, z0], top);
      if (!cF) out.tri([x0, h, z1], [x0 + CHAMFER, h, z1], [x0, ht, z1], top);
    }
    if (cR) {
      out.quad([x1 - CHAMFER, h, z0 + cB], [x1, ht, z0 + cB], [x1, ht, z1 - cF], [x1 - CHAMFER, h, z1 - cF], top);
      if (!cB) out.tri([x1, h, z0], [x1 - CHAMFER, h, z0], [x1, ht, z0], top);
      if (!cF) out.tri([x1, h, z1], [x1 - CHAMFER, h, z1], [x1, ht, z1], top);
    }
    if (cB) {
      out.quad([x0 + cL, h, z0 + CHAMFER], [x0 + cL, ht, z0], [x1 - cR, ht, z0], [x1 - cR, h, z0 + CHAMFER], top);
      if (!cL) out.tri([x0, h, z0], [x0, h, z0 + CHAMFER], [x0, ht, z0], top);
      if (!cR) out.tri([x1, h, z0], [x1, h, z0 + CHAMFER], [x1, ht, z0], top);
    }
    if (cF) {
      out.quad([x0 + cL, h, z1 - CHAMFER], [x1 - cR, h, z1 - CHAMFER], [x1 - cR, ht, z1], [x0 + cL, ht, z1], top);
      if (!cL) out.tri([x0, h, z1], [x0, h, z1 - CHAMFER], [x0, ht, z1], top);
      if (!cR) out.tri([x1, h, z1], [x1, h, z1 - CHAMFER], [x1, ht, z1], top);
    }
    // มุมที่ลบสองด้าน: สามเหลี่ยมเอียงตัดมุม + สามเหลี่ยมเล็กแนวนอนปิดฐาน
    const corner = (xa, za, sx, sz) => {
      out.tri([xa + sx * CHAMFER, h, za + sz * CHAMFER], [xa, ht, za + sz * CHAMFER], [xa + sx * CHAMFER, ht, za], top);
      out.tri([xa, ht, za + sz * CHAMFER], [xa, ht, za], [xa + sx * CHAMFER, ht, za], top);
    };
    if (cL && cB) corner(x0, z0, 1, 1);
    if (cL && cF) corner(x0, z1, 1, -1);
    if (cR && cB) corner(x1, z0, -1, 1);
    if (cR && cF) corner(x1, z1, -1, -1);

    // ผนังลงไปหาช่องข้างๆ ที่ต่ำกว่า · ตัดเป็นท่อนทีละขั้น ให้แต่ละท่อนได้สีชั้นหินของตัวเอง
    lower.forEach((n, side) => {
      if (!cut[side]) return;
      const wallAt = (ya, yb) => {
        const color = (_x, y) => sideColor(surface, ix, iz, Math.min(y, yb - 0.001), n);
        if (side === 0) out.quad([x0, yb, z0], [x0, yb, z1], [x0, ya, z1], [x0, ya, z0], color);
        else if (side === 1) out.quad([x1, yb, z0], [x1, ya, z0], [x1, ya, z1], [x1, yb, z1], color);
        else if (side === 2) out.quad([x0, yb, z0], [x0, ya, z0], [x1, ya, z0], [x1, yb, z0], color);
        else out.quad([x0, yb, z1], [x1, yb, z1], [x1, ya, z1], [x0, ya, z1], color);
      };
      let ya = n;
      while (ya < ht - 0.001) {
        const yb = Math.min(ht, (Math.floor(ya / LEVEL + 0.001) + 1) * LEVEL);
        wallAt(ya, yb);
        ya = yb;
      }
    });
  }

  // DoubleSide: ไม่ต้องห่วงลำดับจุดของแต่ละหน้า (three กลับ normal ให้เองเมื่อมองด้านหลัง)
  const mesh = new THREE.Mesh(out.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ผิวน้ำในสระ: แผ่นใสสะท้อนแสงแดด (Phong ให้จุดวาวจากดวงอาทิตย์) มองทะลุเห็นก้นสระ
export function buildWater() {
  const w = POND.x1 - POND.x0;
  const d = POND.z1 - POND.z0;
  const geo = new THREE.PlaneGeometry(w, d, w * 2, d * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({ color: 0x1aa6e0, specular: 0xbfefff, shininess: 90, transparent: true, opacity: 0.78 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set((POND.x0 + POND.x1) / 2, -0.25, (POND.z0 + POND.z1) / 2);
  mesh.receiveShadow = true;
  const base = Float32Array.from(geo.attributes.position.array);
  // คลื่นเบาๆ: ขยับความสูงจุดยอดก่อนวาดทุกเฟรม (จุดยอดไม่กี่ร้อยจุด เบามาก)
  // ใช้ onBeforeRender → ไม่ต้องให้ lounge.js เรียก · ไม่ได้อยู่ในรอบวาดเงา (ไม่ cast เงา) จึงคิดแค่ครั้งเดียวต่อเฟรม
  mesh.onBeforeRender = () => {
    const t = performance.now() / 1000;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 1) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      p.setY(i, Math.sin(x * 2.1 + t * 1.6) * 0.012 + Math.cos(z * 2.7 - t * 1.3) * 0.012);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  };
  return mesh;
}

// ---------- ภูเขาฉากหลัง ----------
const PAD = 11; // ระยะที่ภูเขาแผ่ออกไปนอกรั้ว
function backdropHeight(x, z) {
  // ระยะห่างจากขอบลาน (สูตรเดียวกับแบบ voxel เดิม แต่ต่อเนื่อง ไม่ปัดเป็นขั้น)
  const d = Math.max(-HALF_X - 0.5 - x, x - HALF_X - 0.5, -HALF_Z - 0.5 - z, z - HALF_Z - 0.5);
  const ramp = THREE.MathUtils.clamp((d - 1.5) / 4, 0, 1);
  const smooth = ramp * ramp * (3 - 2 * ramp);
  const hills = (1 + noise2(x, z, 4, 5) * 11) * LEVEL; // ลอนใหญ่ (สูงสุด ~6 ม.)
  const rugged = (noise2(x, z, 1.3, 9) - 0.5) * 0.9; // ผิวขรุขระเล็กๆ ไม่ให้เนียนเหมือนพลาสติก
  return -0.7 + smooth * (hills + rugged + 0.7);
}

export function buildBackdrop() {
  const w = (HALF_X + PAD) * 2;
  const d = (HALF_Z + PAD) * 2;
  const geo = new THREE.PlaneGeometry(w, d, Math.round(w / BACKDROP_STEP), Math.round(d / BACKDROP_STEP));
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 1) p.setY(i, backdropHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  // สีตามความสูง + ความชัน: ล่าง = หญ้า · ชัน/สูงขึ้น = หิน · ยอด = หิมะ (ขอบไม่ตรงเป๊ะ มี noise เหลื่อม)
  const n = geo.attributes.normal;
  const colors = [];
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const jitter = (noise2(x, z, 1.1, 7) - 0.5) * 0.9;
    const steep = 1 - n.getY(i);
    c.copy(PAL.grass[0]).lerp(PAL.grass[2], noise2(x, z, 3, 8));
    const rockK = THREE.MathUtils.smoothstep(y + jitter + steep * 6, 1.6, 2.8);
    c.lerp(tmp.copy(PAL.rock[0]).lerp(PAL.rock[2], noise2(x, z, 1.5, 10)), rockK);
    c.lerp(PAL.snow[1], THREE.MathUtils.smoothstep(y + jitter - steep * 3, 3.9, 4.5));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  // ไม่ทำ/ไม่รับเงา: อยู่นอกกรอบเงาของดวงอาทิตย์อยู่แล้ว แต่จะถูกวาดซ้ำในรอบเงาทุกเฟรม = เปลือง FPS
  return mesh;
}
