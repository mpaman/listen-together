// ลานกว้างแบบ voxel 8-bit: พื้นบล็อก ต้นไม้ สระ รั้ว ทางเดิน + เวทีฟังเพลงตรงกลาง
// ตำแหน่งต้นไม้/ดอกไม้สุ่มด้วย seed คงที่ → ทุกเครื่องเห็นเหมือนกันและชนตรงกัน
// ขนาดลาน + พื้นที่เวที/สระต้องตรงกับ server/avatar.js (ROOM_HALF_*) และ server/items.js (NO_SPAWN)
import * as THREE from 'three';

export const HALF_X = 24;
export const HALF_Z = 18;
const STAGE = { x0: -8, x1: 8, z0: -7, z1: 5 };
const POND = { x0: 11, x1: 19, z0: 6, z1: 12 };
const BODY_RADIUS = 0.28;

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
  grass: [0x63c74d, 0x5ab846, 0x6dd156, 0x3e8948],
  path: [0xead4aa, 0xe4a672, 0xdcc193],
  plank: [0xb86f50, 0xa65f43, 0xc27c5a],
  rug: [0xa22633, 0xe43b44],
  water: [0x0099db, 0x1aa6e0, 0x2ce8f5],
  trunk: 0x733e39,
  leaves: [0x3e8948, 0x265c42, 0x63c74d],
  stone: [0x8b9bb4, 0x5a6988],
  sofa: 0xb55088,
  sofaDark: 0x68386c,
  wood: 0x8f563b,
  dark: 0x262b44,
  fence: 0xc28569,
  flower: [0xe43b44, 0xfee761, 0xffffff, 0xb55088, 0x2ce8f5],
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

const inRect = (x, z, r, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const onPath = (x, z) => (Math.abs(x) <= 1.2 && z > STAGE.z1) || (Math.abs(z - 9) <= 1.2 && Math.abs(x) < HALF_X);
const pick = (list, rand) => list[Math.floor(rand() * list.length)];

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function block(parent, w, h, d, color, x, y, z, { shadow = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? lambert(color) : color);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// กล่องเหมือนกันหลายชิ้น สีต่างกันได้ → InstancedMesh เดียว (วาดเร็ว)
function instanced(scene, geometry, items, { shadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial({ flatShading: true }), items.length);
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  items.forEach((it, i) => {
    m.makeScale(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1).setPosition(it.x, it.y, it.z);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.setHex(it.color));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function tileColor(x, z, rand) {
  const cx = x + 0.5;
  const cz = z + 0.5;
  if (inRect(cx, cz, POND)) return null; // สระ วาดแยก
  if (inRect(cx, cz, STAGE)) {
    if (Math.hypot(cx, cz - 0.6) <= 3) return C.rug[(x + z) & 1];
    return pick(C.plank, rand);
  }
  if (onPath(cx, cz)) return pick(C.path, rand);
  return rand() < 0.08 ? C.grass[3] : pick(C.grass.slice(0, 3), rand);
}

function buildGround(scene, rand) {
  const tiles = [];
  const water = [];
  for (let x = -HALF_X - 1; x < HALF_X + 1; x += 1) {
    for (let z = -HALF_Z - 1; z < HALF_Z + 1; z += 1) {
      const color = tileColor(x, z, rand);
      if (color === null) water.push({ x: x + 0.5, y: -0.4, z: z + 0.5, color: pick(C.water, rand) });
      else tiles.push({ x: x + 0.5, y: -0.25, z: z + 0.5, color });
    }
  }
  instanced(scene, new THREE.BoxGeometry(1, 0.5, 1), tiles, { shadow: false });
  instanced(scene, new THREE.BoxGeometry(1, 0.3, 1), water, { shadow: false });
  // ขอบสระเป็นหิน
  const rim = [];
  for (let x = POND.x0 - 1; x <= POND.x1; x += 1) {
    for (const z of [POND.z0 - 1, POND.z1]) rim.push({ x: x + 0.5, y: 0.1, z: z + 0.5, color: pick(C.stone, rand) });
  }
  for (let z = POND.z0; z < POND.z1; z += 1) {
    for (const x of [POND.x0 - 1, POND.x1]) rim.push({ x: x + 0.5, y: 0.1, z: z + 0.5, color: pick(C.stone, rand) });
  }
  instanced(scene, new THREE.BoxGeometry(1, 0.2, 1), rim);

  // ทุ่งหญ้านอกรั้ว (เดินไม่ได้) ให้ลานไม่ดูลอยอยู่กลางความมืด — จางหายไปในหมอก
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: 0x3e8948 }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.45; // ต่ำกว่าผิวน้ำในสระ (-0.25) ไม่งั้นทับสระจนมองไม่เห็นน้ำ
  meadow.receiveShadow = true;
  scene.add(meadow);

  // พื้นล่องหนไว้ให้คลิกเดิน (raycast)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2 + 2, HALF_Z * 2 + 2), new THREE.MeshBasicMaterial({ visible: false }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  return floor;
}

function buildFence(scene) {
  const posts = [];
  const rails = [];
  const X = HALF_X + 0.6;
  const Z = HALF_Z + 0.6;
  for (let x = -X; x <= X + 0.01; x += 2) {
    for (const z of [-Z, Z]) posts.push({ x, y: 0.45, z, color: C.fence });
  }
  for (let z = -Z + 2; z < Z; z += 2) {
    for (const x of [-X, X]) posts.push({ x, y: 0.45, z, color: C.fence });
  }
  instanced(scene, new THREE.BoxGeometry(0.22, 0.9, 0.22), posts);
  for (const y of [0.35, 0.7]) {
    rails.push({ x: 0, y, z: -Z, sx: X * 2, color: C.fence }, { x: 0, y, z: Z, sx: X * 2, color: C.fence });
    rails.push({ x: -X, y, z: 0, sz: Z * 2, color: C.fence }, { x: X, y, z: 0, sz: Z * 2, color: C.fence });
  }
  // ราว: กล่องยาว 1 หน่วยแล้วยืดตามแกน (ราวแนวนอน ยืด x · ราวแนวตั้ง ยืด z)
  instanced(scene, new THREE.BoxGeometry(1, 0.1, 0.08), rails.filter((r) => r.sx));
  instanced(scene, new THREE.BoxGeometry(0.08, 0.1, 1), rails.filter((r) => r.sz));
}

// ต้นไม้ + ดอกไม้ + หิน (ไม่อยู่บนเวที/สระ/ทางเดิน/จุดเกิด)
function buildNature(scene, rand, blocks) {
  const free = (x, z, pad) => !inRect(x, z, STAGE, pad + 1) && !inRect(x, z, POND, pad) && !onPath(x, z) && Math.abs(x) < HALF_X - 1 && Math.abs(z) < HALF_Z - 1;
  const trunks = [];
  const leaves = [];
  const trees = [];
  for (let tries = 0; trees.length < 34 && tries < 600; tries += 1) {
    const x = Math.round((rand() * 2 - 1) * (HALF_X - 2)) + 0.5;
    const z = Math.round((rand() * 2 - 1) * (HALF_Z - 2)) + 0.5;
    if (!free(x, z, 1.5) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
    const h = 1.4 + Math.floor(rand() * 3) * 0.4;
    trees.push({ x, z });
    trunks.push({ x, y: h / 2, z, sy: h, color: C.trunk });
    const leaf = pick(C.leaves, rand);
    leaves.push({ x, y: h + 0.4, z, sx: 2.2, sy: 1, sz: 2.2, color: leaf });
    leaves.push({ x, y: h + 1.2, z, sx: 1.6, sy: 0.8, sz: 1.6, color: leaf });
    leaves.push({ x, y: h + 1.8, z, sx: 0.8, sy: 0.6, sz: 0.8, color: C.leaves[2] });
    blocks.push({ box: false, x, z, r: 0.45 });
  }
  instanced(scene, new THREE.BoxGeometry(0.5, 1, 0.5), trunks);
  instanced(scene, new THREE.BoxGeometry(1, 1, 1), leaves);

  const flowers = [];
  for (let i = 0; i < 160; i += 1) {
    const x = (rand() * 2 - 1) * (HALF_X - 1);
    const z = (rand() * 2 - 1) * (HALF_Z - 1);
    if (!free(x, z, 0) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 1.3)) continue;
    flowers.push({ x, y: 0.12, z, color: C.grass[3], sy: 1.6, sx: 0.4, sz: 0.4 }); // ก้าน
    flowers.push({ x, y: 0.28, z, color: pick(C.flower, rand) });
  }
  instanced(scene, new THREE.BoxGeometry(0.16, 0.16, 0.16), flowers, { shadow: false });

  const rocks = [];
  for (let tries = 0; rocks.length < 10 && tries < 200; tries += 1) {
    const x = (rand() * 2 - 1) * (HALF_X - 2);
    const z = (rand() * 2 - 1) * (HALF_Z - 2);
    if (!free(x, z, 1) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2)) continue;
    const s = 0.6 + rand() * 0.5;
    rocks.push({ x, y: s * 0.35, z, sx: s, sy: s * 0.7, sz: s * 0.9, color: pick(C.stone, rand) });
    blocks.push({ box: false, x, z, r: s * 0.5 });
  }
  instanced(scene, new THREE.BoxGeometry(1, 1, 1), rocks);
}

function buildStage(scene, blocks) {
  // ผนังหลังเวที + กรอบจอ
  block(scene, 9, 3.6, 0.5, C.dark, 0, 1.8, -6.6);
  block(scene, 7.6, 2.2, 0.1, 0x181425, 0, 2.0, -6.32);
  blocks.push({ box: true, x: 0, z: -6.6, hx: 4.5, hz: 0.3 });

  // ไฟประดับ (บล็อกเรืองแสง)
  const bulbGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  for (let i = 0; i <= 22; i += 1) {
    const x = -4.4 + (i / 22) * 8.8;
    const m = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xfeae34 : 0xfee761 }));
    m.position.set(x, 3.75 - Math.sin((i / 22) * Math.PI * 3) ** 2 * 0.2, -6.3);
    scene.add(m);
  }

  // ลำโพง 2 ข้าง (กรวยลำโพงเต้นตามเพลง)
  const speakers = [-1, 1].map((side) => {
    const g = new THREE.Group();
    block(g, 1, 1.8, 0.8, 0x181425, 0, 0.9, 0);
    const cone = block(g, 0.56, 0.56, 0.06, 0x5a6988, 0, 1.15, 0.42);
    block(g, 0.3, 0.3, 0.06, 0x5a6988, 0, 0.45, 0.42);
    g.position.set(side * 5.4, 0, -6);
    scene.add(g);
    blocks.push({ box: true, x: side * 5.4, z: -6, hx: 0.5, hz: 0.4 });
    return cone;
  });

  // โซฟา 2 ตัว (ที่นั่งจริงคือ SEATS — เฟอร์นิเจอร์แค่ให้ดูเป็นที่นั่ง)
  for (const side of [-1, 1]) {
    const sofa = new THREE.Group();
    block(sofa, 1.0, 0.45, 3.8, C.sofa, 0, 0.225, 0.2);
    block(sofa, 0.3, 1.0, 3.8, C.sofaDark, side * 0.5, 0.5, 0.2);
    block(sofa, 1.1, 0.7, 0.3, C.sofaDark, 0, 0.35, -1.75);
    block(sofa, 1.1, 0.7, 0.3, C.sofaDark, 0, 0.35, 2.15);
    for (const z of [-1, 0.2, 1.4]) block(sofa, 0.8, 0.1, 1.1, 0xc66a9c, -side * 0.05, 0.5, z); // เบาะ
    sofa.position.x = side * 6.6;
    scene.add(sofa);
    blocks.push({ box: true, x: side * 6.6, z: 0.2, hx: 0.6, hz: 2.1 });
  }
  // บีนแบ็ก (บล็อกซ้อน)
  for (const side of [-1, 1]) {
    const color = side < 0 ? 0x0099db : 0xb55088;
    const g = new THREE.Group();
    block(g, 1.1, 0.3, 1.1, color, 0, 0.15, 0);
    block(g, 0.8, 0.2, 0.8, color, 0, 0.38, 0);
    g.position.set(side * 1.6, 0, 3.3);
    scene.add(g);
    blocks.push({ box: false, x: side * 1.6, z: 3.3, r: 0.5 });
  }
  // เสาไฟมุมเวที
  for (const [x, z] of [[-7.6, 4.6], [7.6, 4.6]]) {
    block(scene, 0.2, 2.6, 0.2, C.dark, x, 1.3, z);
    block(scene, 0.4, 0.4, 0.4, new THREE.MeshBasicMaterial({ color: 0xfee761 }), x, 2.8, z, { shadow: false });
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

export function buildWorld(scene) {
  const rand = seeded(20261105);
  const blocks = [{ box: true, x: (POND.x0 + POND.x1) / 2, z: (POND.z0 + POND.z1) / 2, hx: (POND.x1 - POND.x0) / 2, hz: (POND.z1 - POND.z0) / 2 }];
  const floor = buildGround(scene, rand);
  buildFence(scene);
  const { speakers, seatHits } = buildStage(scene, blocks);
  buildNature(scene, rand, blocks);
  return { floor, speakers, seatHits, blocks };
}

// ผลักวงกลมของตัวละคร (x, z) ออกจากสิ่งกีดขวาง · คืนตำแหน่งใหม่
export function pushOutOfBlocks(blocks, x, z) {
  let nx = x;
  let nz = z;
  for (const b of blocks) {
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
