// ลานฟังเพลง: พื้นต่างระดับ (ภูเขา/ที่ราบสูง/เสากระโดด) ต้นไม้ สระ รั้ว ทางเดิน + เวทีฟังเพลงตรงกลาง
// ความสูงพื้นมาจาก lounge-terrain.js (ชนเป็นขั้นๆ) · หน้าตาพื้น/ภูเขาฉากหลังอยู่ใน lounge-ground.js
// ของประดับเป็นทรงโค้งมน (ทรงกระบอก/ทรงกลม/กล่องลบมุม) แทนกล่องเหลี่ยม · สุ่มด้วย seed คงที่ → ทุกเครื่องเห็นเหมือนกันและชนตรงกัน
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBackdrop, buildTerrainMesh, buildWater } from './lounge-ground.js';
import { cellAt, groundAt, HALF_X, HALF_Z, hash2, inRect, onPath, PARKOUR, POND, STAGE } from './lounge-terrain.js';

export { HALF_X, HALF_Z } from './lounge-terrain.js';

// ที่นั่ง 8 ที่ (= SEAT_COUNT ใน server): โซฟาซ้าย 3 · โซฟาขวา 3 · บีนแบ็ก 2
// ry = ทิศที่หันหน้าเมื่อนั่ง (0 = หันหาจอ/กล้อง +z)
export const SEATS = [
  ...[-1, 0.2, 1.4].map((z) => ({ x: -6.3, z, ry: Math.PI / 2, h: 0.5 })),
  ...[-1, 0.2, 1.4].map((z) => ({ x: 6.3, z, ry: -Math.PI / 2, h: 0.5 })),
  { x: -1.6, z: 3.3, ry: Math.PI, h: 0.4 },
  { x: 1.6, z: 3.3, ry: Math.PI, h: 0.4 },
];

// จานสี ENDESGA 32 (ชุดเดียวกับหน้าเว็บ)
const C = {
  grass: [0x4fa83f, 0x6dc455, 0x3e8948, 0x2f6b39],
  trunk: [0x733e39, 0x5e3a30, 0x8f563b],
  leaves: [0x3e8948, 0x2f7a3e, 0x4fa83f, 0x5fb84a],
  pine: [0x265c42, 0x1f4e3a, 0x2f6b45],
  stone: [0x8b9bb4, 0x7a8aa6, 0x5a6988, 0x9aa8bf],
  sofa: 0xb55088,
  sofaDark: 0x68386c,
  cushion: 0xc66a9c,
  dark: 0x262b44,
  fence: [0xc28569, 0xb07258, 0xd09a7a],
  flower: [0xe43b44, 0xfee761, 0xffffff, 0xb55088, 0x2ce8f5, 0xf77622],
};

// RNG ที่ให้ลำดับเดิมทุกครั้ง (mulberry32)
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ฟลอร์เต้น = พรมแดงกลางเวที (วงกลมรัศมี 3) · ยืนนิ่งบนนี้ตอนเพลงเล่น → ตัวละครโยกตามเพลงเอง
export const DANCE_FLOOR = { x: 0, z: 0.6, r: 3 };
export const onDanceFloor = (x, z) => Math.hypot(x - DANCE_FLOOR.x, z - DANCE_FLOOR.z) <= DANCE_FLOOR.r;

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

// ผิวเรียบ (ไม่ flatShading) → ทรงโค้งดูนุ่ม · หินใช้ flat ให้เห็นเหลี่ยมหินตามธรรมชาติ
const soft = (color) => new THREE.MeshLambertMaterial({ color });

// กล่องลบมุม: รัศมีมุมตามด้านที่บางที่สุด (RoundedBox ต้องมีรัศมีไม่เกินครึ่งของด้านที่สั้นสุด)
function block(parent, w, h, d, color, x, y, z, { shadow = true, round = 0.08 } = {}) {
  const r = Math.min(round, Math.min(w, h, d) * 0.45);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), typeof color === 'number' ? soft(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function mesh(parent, geo, color, x, y, z, { shadow = true } = {}) {
  const m = new THREE.Mesh(geo, typeof color === 'number' ? soft(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ของหน้าตาเดียวกันหลายชิ้น สี/ขนาด/การหมุนต่างกันได้ → InstancedMesh เดียว (วาดครั้งเดียว)
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
function instanced(scene, geometry, items, { shadow = true, receive = true, flat = false } = {}) {
  const inst = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ flatShading: flat }), items.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  items.forEach((it, i) => {
    _q.setFromEuler(_e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0));
    m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1));
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, color.setHex(it.color));
  });
  inst.castShadow = shadow;
  inst.receiveShadow = receive;
  scene.add(inst);
  return inst;
}

// ---------- พื้น ----------
function buildGround(scene, rand) {
  const terrain = buildTerrainMesh();
  const backdrop = buildBackdrop();
  scene.add(terrain, backdrop, buildWater());

  // ขอบสระเป็นก้อนหินกลมๆ ไม่เท่ากันวางเรียงรอบ (แทนแผ่นหินเหลี่ยม)
  const rim = [];
  const addRim = (x, z) => {
    for (let k = 0; k < 2; k += 1) {
      const s = 0.32 + rand() * 0.22;
      rim.push({ x: x + (rand() - 0.5) * 0.6, y: 0.02, z: z + (rand() - 0.5) * 0.6, sx: s * 1.3, sy: s * 0.55, sz: s, rx: rand() * 3, ry: rand() * 6, color: pick(C.stone, rand) });
    }
  };
  for (let x = POND.x0 - 1; x <= POND.x1; x += 1) for (const z of [POND.z0 - 1, POND.z1]) addRim(x + 0.5, z + 0.5);
  for (let z = POND.z0; z < POND.z1; z += 1) for (const x of [POND.x0 - 1, POND.x1]) addRim(x + 0.5, z + 0.5);
  instanced(scene, new THREE.DodecahedronGeometry(0.5, 0), rim, { flat: true });

  // ทุ่งหญ้านอกรั้ว (เดินไม่ได้) ให้ลานไม่ดูลอยอยู่กลางความมืด — จางหายไปในหมอก
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: 0x3e8948 }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.45; // ต่ำกว่าผิวน้ำในสระ (-0.25) ไม่งั้นทับสระจนมองไม่เห็นน้ำ
  meadow.receiveShadow = true;
  scene.add(meadow);

  // พื้นล่องหนสำรองไว้ให้คลิกเดิน (raycast) — เผื่อคลิกโดนช่องว่าง
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2 + 2, HALF_Z * 2 + 2), new THREE.MeshBasicMaterial({ visible: false }));
  plane.rotation.x = -Math.PI / 2;
  scene.add(plane);
  return [terrain, backdrop, plane];
}

// รั้วไม้: เสากลมกลึง + ราวกลม (ราว = ทรงกระบอกยาว 1 หน่วยวางนอน แล้วยืดตามแนว)
function buildFence(scene) {
  const posts = [];
  const rails = [];
  const X = HALF_X + 0.6;
  const Z = HALF_Z + 0.6;
  const post = (x, z) => posts.push({ x, y: 0.45, z, sy: 0.9, ry: hash2(x * 10, z * 10) * 6, color: C.fence[Math.floor(hash2(x, z) * 3)] });
  for (let x = -X; x <= X + 0.01; x += 2) for (const z of [-Z, Z]) post(x, z);
  for (let z = -Z + 2; z < Z; z += 2) for (const x of [-X, X]) post(x, z);
  instanced(scene, new THREE.CylinderGeometry(0.08, 0.1, 1, 8), posts);
  for (const y of [0.35, 0.7]) {
    rails.push({ x: 0, y, z: -Z, sx: X * 2, color: C.fence[0] }, { x: 0, y, z: Z, sx: X * 2, color: C.fence[0] });
    rails.push({ x: -X, y, z: 0, sz: Z * 2, color: C.fence[0] }, { x: X, y, z: 0, sz: Z * 2, color: C.fence[0] });
  }
  instanced(scene, new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateZ(Math.PI / 2), rails.filter((r) => r.sx));
  instanced(scene, new THREE.CylinderGeometry(0.035, 0.035, 1, 6).rotateX(Math.PI / 2), rails.filter((r) => r.sz));
}

// ---------- ธรรมชาติ ----------
// กอหญ้า: ใบเรียว 5 ใบเอนออกรอบโคน (รวมเป็น geometry เดียวแล้ว instance ทั้งลาน)
function tuftGeometry() {
  const blades = [];
  for (let k = 0; k < 5; k += 1) {
    const g = new THREE.ConeGeometry(0.03, 0.3 + (k % 2) * 0.08, 3);
    g.translate(0, 0.15, 0);
    g.rotateZ(0.28 + (k % 3) * 0.12);
    g.rotateY((k / 5) * Math.PI * 2);
    blades.push(g);
  }
  return mergeGeometries(blades);
}

// ดอกไม้: กลีบรีๆ 5 กลีบรอบเกสร (ทั้งดอกสีเดียวกันตาม instance)
function flowerGeometry() {
  const parts = [new THREE.SphereGeometry(0.03, 6, 4)];
  for (let k = 0; k < 5; k += 1) {
    const a = (k / 5) * Math.PI * 2;
    const petal = new THREE.SphereGeometry(0.045, 6, 4);
    petal.scale(1, 0.35, 0.6);
    petal.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
    parts.push(petal);
  }
  return mergeGeometries(parts);
}

// ช่องนี้เป็นหญ้าไหม (ไว้โรยกอหญ้า/ดอกไม้)
function grassy(x, z) {
  const { level, kind } = cellAt(Math.floor(x), Math.floor(z));
  return level < 5 && kind !== 'mesa' && kind !== 'pillar';
}

// ต้นไม้ (ใบไม้พุ่มกลม/สนทรงกรวย) + ดอกไม้ + กอหญ้า + หิน (ไม่อยู่บนเวที/สระ/ทางเดิน/จุดเกิด)
function buildNature(scene, rand, blocks) {
  // ไม่ปลูกบนเวที/สระ/ทางเดิน/ลานเสากระโดด/ที่ราบสูง (ไว้ให้ยืนชมวิวโล่งๆ)
  const free = (x, z, pad) => !inRect(x, z, STAGE, pad + 1) && !inRect(x, z, POND, pad) && !inRect(x, z, PARKOUR, pad)
    && !onPath(x, z) && Math.abs(x) < HALF_X - 1 && Math.abs(z) < HALF_Z - 1
    && cellAt(Math.floor(x), Math.floor(z)).kind !== 'mesa';
  const trunks = [];
  const blobs = [];
  const cones = [];
  const trees = [];
  for (let tries = 0; trees.length < 34 && tries < 600; tries += 1) {
    const x = Math.round((rand() * 2 - 1) * (HALF_X - 2)) + 0.5;
    const z = Math.round((rand() * 2 - 1) * (HALF_Z - 2)) + 0.5;
    if (!free(x, z, 1.5) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    const base = groundAt(x, z);
    if (base >= 4) continue; // ยอดเขาหิมะ ไม่มีต้นไม้
    const h = 1.4 + rand() * 0.8;
    const lean = (rand() - 0.5) * 0.08; // เอียงนิดๆ ไม่ตั้งตรงเป๊ะเหมือนเสา
    trees.push({ x, z });
    const pine = base >= 1.5 || rand() < 0.25; // บนเนินเป็นสน · ที่ราบส่วนใหญ่เป็นไม้พุ่ม
    if (pine) {
      trunks.push({ x, y: base + h * 0.3, z, sx: 0.8, sy: h * 0.6, sz: 0.8, rz: lean, color: pick(C.trunk, rand) });
      const color = pick(C.pine, rand);
      for (let i = 0; i < 3; i += 1) {
        const r = 1.1 - i * 0.28;
        cones.push({ x, y: base + h * 0.55 + 0.45 + i * 0.62, z, sx: r, sy: 1.15 - i * 0.1, sz: r, ry: rand() * 6, color });
      }
    } else {
      trunks.push({ x, y: base + h / 2, z, sy: h, rz: lean, color: pick(C.trunk, rand) });
      const color = pick(C.leaves, rand);
      const top = base + h + 0.45;
      blobs.push({ x, y: top, z, sx: 1.1, sy: 0.9, sz: 1.1, ry: rand() * 6, color });
      for (let k = 0; k < 3; k += 1) {
        const a = rand() * Math.PI * 2;
        const r = 0.6 + rand() * 0.2;
        blobs.push({ x: x + Math.cos(a) * 0.6, y: top - 0.15 + rand() * 0.5, z: z + Math.sin(a) * 0.6, sx: r, sy: r * 0.85, sz: r, ry: rand() * 6, color: pick(C.leaves, rand) });
      }
      blobs.push({ x, y: top + 0.75, z, sx: 0.65, sy: 0.6, sz: 0.65, ry: rand() * 6, color: C.leaves[3] });
    }
    blocks.push({ box: false, x, z, r: 0.45, y0: base, y1: base + h + 2.3 });
  }
  instanced(scene, new THREE.CylinderGeometry(0.11, 0.2, 1, 7), trunks);
  instanced(scene, new THREE.IcosahedronGeometry(1, 1), blobs);
  instanced(scene, new THREE.ConeGeometry(1, 1, 9), cones);

  const stems = [];
  const heads = [];
  for (let i = 0; i < 160; i += 1) {
    const x = (rand() * 2 - 1) * (HALF_X - 1);
    const z = (rand() * 2 - 1) * (HALF_Z - 1);
    if (!free(x, z, 0) || !grassy(x, z) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.3)) continue;
    const base = groundAt(x, z);
    const tall = 0.2 + rand() * 0.12;
    stems.push({ x, y: base + tall / 2, z, sy: tall, color: C.grass[3] });
    heads.push({ x, y: base + tall, z, rx: (rand() - 0.5) * 0.6, ry: rand() * 6, color: pick(C.flower, rand) });
  }
  instanced(scene, new THREE.CylinderGeometry(0.01, 0.014, 1, 4), stems, { shadow: false });
  instanced(scene, flowerGeometry(), heads, { shadow: false });

  // กอหญ้าโรยทั่วลาน: ทำให้พื้นไม่เรียบเป็นแผ่นสี (ไม่ทำเงา เล็กเกินจะเห็นเงาอยู่แล้ว)
  const tufts = [];
  for (let i = 0; tufts.length < 520 && i < 1400; i += 1) {
    const x = (rand() * 2 - 1) * (HALF_X - 0.6);
    const z = (rand() * 2 - 1) * (HALF_Z - 0.6);
    if (!free(x, z, 0) || !grassy(x, z)) continue;
    const s = 0.7 + rand() * 0.6;
    tufts.push({ x, y: groundAt(x, z), z, sx: s, sy: s, sz: s, ry: rand() * 6, color: pick(C.grass, rand) });
  }
  instanced(scene, tuftGeometry(), tufts, { shadow: false });

  // หินก้อนใหญ่ (ชนได้ กระโดดข้ามได้) + กรวดเล็กโรยข้างๆ (แค่ภาพ)
  const rocks = [];
  for (let tries = 0; rocks.length < 40 && tries < 200; tries += 1) {
    const x = (rand() * 2 - 1) * (HALF_X - 2);
    const z = (rand() * 2 - 1) * (HALF_Z - 2);
    if (!free(x, z, 1) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2)) continue;
    const s = 0.6 + rand() * 0.5;
    const base = groundAt(x, z);
    rocks.push({ x, y: base + s * 0.28, z, sx: s * 1.2, sy: s * 0.8, sz: s, rx: rand() * 0.4, ry: rand() * 6, color: pick(C.stone, rand) });
    for (let k = 0; k < 3; k += 1) {
      const a = rand() * Math.PI * 2;
      const p = 0.15 + rand() * 0.12;
      rocks.push({ x: x + Math.cos(a) * s * 0.9, y: base + p * 0.25, z: z + Math.sin(a) * s * 0.9, sx: p * 1.3, sy: p * 0.7, sz: p, rx: rand() * 3, ry: rand() * 6, color: pick(C.stone, rand) });
    }
    blocks.push({ box: false, x, z, r: s * 0.5, y0: base, y1: base + s * 0.7 });
  }
  instanced(scene, new THREE.DodecahedronGeometry(0.5, 0), rocks, { flat: true });
}

// ---------- เวที ----------
// ไฟประดับ: หลอดกลมห้อยตามสายโค้ง (สายเป็นท่อบางผ่านจุดเดียวกับหลอด)
function buildBulbs(scene) {
  const bulbGeo = new THREE.SphereGeometry(0.075, 10, 8);
  const points = [];
  for (let i = 0; i <= 22; i += 1) {
    const x = -4.4 + (i / 22) * 8.8;
    const y = 3.75 - Math.sin((i / 22) * Math.PI * 3) ** 2 * 0.2;
    points.push(new THREE.Vector3(x, y + 0.08, -6.3));
    mesh(scene, bulbGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xfeae34 : 0xfee761 }), x, y, -6.3, { shadow: false });
  }
  mesh(scene, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 80, 0.012, 4), 0x181425, 0, 0, 0, { shadow: false });
}

// ลำโพง: ตู้ลบมุม + ดอกลำโพงกลม (ขอบยาง/กรวย/ฝาครอบกลาง)
// cone = group ที่ lounge.js ขยาย x/y ตามจังหวะเพลง → ต้องเป็น group ที่ไม่ได้หมุน ไม่งั้นแกนที่ขยายจะเพี้ยน
function buildSpeaker(side) {
  const g = new THREE.Group();
  block(g, 1, 1.8, 0.8, 0x181425, 0, 0.9, 0, { round: 0.1 });
  const coneMat = new THREE.MeshLambertMaterial({ color: 0x5a6988, side: THREE.DoubleSide });
  const driver = (r, y) => {
    const d = new THREE.Group();
    d.position.set(0, y, 0.41);
    mesh(d, new THREE.TorusGeometry(r, r * 0.13, 8, 28), 0x262b44, 0, 0, 0);
    mesh(d, new THREE.CylinderGeometry(r * 0.92, r * 0.3, r * 0.4, 28, 1, true).rotateX(-Math.PI / 2), coneMat, 0, 0, -r * 0.18);
    mesh(d, new THREE.SphereGeometry(r * 0.28, 12, 8).scale(1, 1, 0.5), 0x8b9bb4, 0, 0, -r * 0.3);
    g.add(d);
    return d;
  };
  const cone = driver(0.28, 1.15);
  driver(0.14, 0.45);
  g.position.set(side * 5.4, 0, -6);
  return { cone, box: g };
}

function buildSofa(side) {
  const sofa = new THREE.Group();
  block(sofa, 1.0, 0.45, 3.8, C.sofa, 0, 0.225, 0.2, { round: 0.12 });
  block(sofa, 0.3, 1.0, 3.8, C.sofaDark, side * 0.5, 0.5, 0.2, { round: 0.14 });
  for (const z of [-1.75, 2.15]) block(sofa, 1.1, 0.7, 0.3, C.sofaDark, 0, 0.35, z, { round: 0.14 }); // ที่วางแขน
  for (const z of [-1, 0.2, 1.4]) {
    block(sofa, 0.8, 0.14, 1.1, C.cushion, -side * 0.05, 0.5, z, { round: 0.07 }); // เบาะนั่ง (ขอบมนมาก ดูนุ่ม)
    const back = block(sofa, 0.18, 0.5, 1.05, C.cushion, side * 0.28, 0.8, z, { round: 0.08 }); // หมอนพิง
    back.rotation.z = side * 0.12;
  }
  sofa.position.x = side * 6.6;
  return sofa;
}

function buildStage(scene, blocks) {
  // ผนังหลังเวที + กรอบจอ
  block(scene, 9, 3.6, 0.5, C.dark, 0, 1.8, -6.6, { round: 0.12 });
  block(scene, 7.6, 2.2, 0.1, 0x181425, 0, 2.0, -6.32, { round: 0.04 });
  blocks.push({ box: true, x: 0, z: -6.6, hx: 4.5, hz: 0.3 });
  buildBulbs(scene);

  // ลำโพง 2 ข้าง (ดอกลำโพงเต้นตามเพลง)
  const speakers = [-1, 1].map((side) => {
    const sp = buildSpeaker(side);
    scene.add(sp.box);
    blocks.push({ box: true, x: side * 5.4, z: -6, hx: 0.5, hz: 0.4 });
    return sp;
  });

  // โซฟา 2 ตัว (ที่นั่งจริงคือ SEATS — เฟอร์นิเจอร์แค่ให้ดูเป็นที่นั่ง)
  for (const side of [-1, 1]) {
    scene.add(buildSofa(side));
    blocks.push({ box: true, x: side * 6.6, z: 0.2, hx: 0.6, hz: 2.1 });
  }
  // บีนแบ็ก: ถุงกลมยุบตัว + ส่วนบนที่โป่งขึ้นมา
  for (const side of [-1, 1]) {
    const color = side < 0 ? 0x0099db : 0xb55088;
    const g = new THREE.Group();
    mesh(g, new THREE.SphereGeometry(0.58, 20, 14).scale(1, 0.55, 1), color, 0, 0.3, 0);
    mesh(g, new THREE.SphereGeometry(0.34, 16, 10).scale(1, 0.5, 1), color, 0, 0.5, 0.12);
    g.position.set(side * 1.6, 0, 3.3);
    scene.add(g);
    blocks.push({ box: false, x: side * 1.6, z: 3.3, r: 0.5 });
  }
  // เสาไฟมุมเวที: ฐานกลม เสากลม โคมกลมเรืองแสง
  for (const [x, z] of [[-7.6, 4.6], [7.6, 4.6]]) {
    mesh(scene, new THREE.CylinderGeometry(0.2, 0.26, 0.14, 14), C.dark, x, 0.07, z);
    mesh(scene, new THREE.CylinderGeometry(0.05, 0.07, 2.6, 10), C.dark, x, 1.3, z);
    mesh(scene, new THREE.CylinderGeometry(0.16, 0.1, 0.12, 14), C.dark, x, 2.62, z);
    mesh(scene, new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfee761 }), x, 2.85, z, { shadow: false });
    const lamp = new THREE.PointLight(0xffc56b, 6, 9, 1.6);
    lamp.position.set(x, 2.6, z);
    scene.add(lamp);
    blocks.push({ box: false, x, z, r: 0.15 });
  }

  // จุดกดนั่ง (มองไม่เห็น แต่ raycast โดน)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const seatHits = SEATS.map((seat, index) => {
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 10), hitMat);
    hit.position.set(seat.x, 0.5, seat.z);
    hit.userData.seat = index;
    scene.add(hit);
    return hit;
  });
  return { speakers, seatHits };
}

// ไฟฟลอร์: แผ่นเรืองแสงบางๆ วางทับพรมทีละช่อง (แยกจากพื้นจริง จะได้เปลี่ยนสีทุกเฟรมได้โดยไม่แตะพื้นทั้งลาน)
// แสงแบบบวก (additive) → พรมสว่างขึ้นเป็นจังหวะ · ปิดเพลง = ดับ
const FLOOR_COLORS = [0x22c55e, 0x2ce8f5, 0xb55088, 0xfee761]; // เขียว action ของเว็บ + สีจาก ENDESGA
function buildFloorLights(scene) {
  const tiles = [];
  for (let x = -4; x < 4; x += 1) {
    for (let z = -3; z < 4; z += 1) {
      if (onDanceFloor(x + 0.5, z + 0.5)) tiles.push({ x: x + 0.5, z: z + 0.5 });
    }
  }
  const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const geo = new THREE.PlaneGeometry(0.92, 0.92);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
  const m = new THREE.Matrix4();
  tiles.forEach((t, i) => mesh.setMatrixAt(i, m.makeTranslation(t.x, 0.012, t.z)));
  const color = new THREE.Color();
  const black = new THREE.Color(0x000000);
  mesh.renderOrder = 1;
  scene.add(mesh);

  // level 0..1 = ความแรงของแสง · beat = นับจังหวะ (เลขจำนวนเต็มเปลี่ยนทุกบีต ใช้สลับลายสี)
  // ลาย: วงคลื่นกระจายจากกลางฟลอร์ + สีเลื่อนไปทีละบีต · ไม่กะพริบดำ-ขาวสุดขั้ว (กันคนแพ้แสงกะพริบ)
  function update(level, beat, phase) {
    tiles.forEach((t, i) => {
      const ring = Math.floor(Math.hypot(t.x - DANCE_FLOOR.x, t.z - DANCE_FLOOR.z));
      const hue = FLOOR_COLORS[(ring + beat) % FLOOR_COLORS.length];
      const wave = 0.55 + 0.45 * Math.cos((phase - ring * 0.18) * Math.PI * 2);
      mesh.setColorAt(i, color.setHex(hue).lerp(black, 1 - level * wave * 0.5));
    });
    mesh.instanceColor.needsUpdate = true;
  }
  update(0, 0, 0);
  return update;
}

export function buildWorld(scene) {
  const rand = seeded(20261105);
  const blocks = [{ box: true, x: (POND.x0 + POND.x1) / 2, z: (POND.z0 + POND.z1) / 2, hx: (POND.x1 - POND.x0) / 2, hz: (POND.z1 - POND.z0) / 2 }];
  const floor = buildGround(scene, rand);
  buildFence(scene);
  const { speakers, seatHits } = buildStage(scene, blocks);
  const floorLights = buildFloorLights(scene);
  buildNature(scene, rand, blocks);
  return { floor, speakers, seatHits, blocks, floorLights };
}

// ผลักวงกลมของตัวละคร (x, z) ออกจากสิ่งกีดขวาง · คืนตำแหน่งใหม่
// y = ระดับเท้า: ของที่มีช่วงความสูง (y0..y1) จะชนเฉพาะตอนตัวซ้อนกับช่วงนั้น → กระโดดข้ามก้อนหินได้
const BODY_HEIGHT = 1.6;
export function pushOutOfBlocks(blocks, x, z, y = 0) {
  let nx = x;
  let nz = z;
  for (const b of blocks) {
    if (b.y1 !== undefined && (y >= b.y1 || y + BODY_HEIGHT <= b.y0)) continue;
    if (b.box) {
      const cx = Math.max(b.x - b.hx, Math.min(b.x + b.hx, nx));
      const cz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, nz));
      const dx = nx - cx;
      const dz = nz - cz;
      const d = Math.hypot(dx, dz);
      if (d >= BODY_RADIUS) continue;
      if (d < 1e-4) { // จุดศูนย์กลางอยู่ในกล่อง → ดันออกทางด้านที่ใกล้สุด
        const toX = b.hx - Math.abs(nx - b.x);
        const toZ = b.hz - Math.abs(nz - b.z);
        if (toX < toZ) nx = b.x + (Math.sign(nx - b.x) || 1) * (b.hx + BODY_RADIUS);
        else nz = b.z + (Math.sign(nz - b.z) || 1) * (b.hz + BODY_RADIUS);
        continue;
      }
      nx = cx + (dx / d) * BODY_RADIUS;
      nz = cz + (dz / d) * BODY_RADIUS;
    } else {
      const dx = nx - b.x;
      const dz = nz - b.z;
      const d = Math.hypot(dx, dz);
      const min = b.r + BODY_RADIUS;
      if (d >= min) continue;
      const ux = d < 1e-4 ? 1 : dx / d;
      const uz = d < 1e-4 ? 0 : dz / d;
      nx = b.x + ux * min;
      nz = b.z + uz * min;
    }
  }
  return [nx, nz];
}
