// ไอเทมแต่งตัว (voxel): ใช้ทั้งตอนวางบนพื้นและตอนถือในมือ
// ทุกชิ้นสร้างให้ "ด้ามจับ" อยู่ที่จุด (0,0,0) แล้วยาวขึ้นไปทาง +y
// รายชื่อต้องตรงกับ ITEM_KINDS ใน server/items.js
import * as THREE from 'three';

export const ITEM_KINDS = ['sword', 'guitar', 'mic', 'torch', 'shield', 'wand'];
export const ITEM_NAMES = { sword: 'ดาบ', guitar: 'กีตาร์', mic: 'ไมค์', torch: 'คบไฟ', shield: 'โล่', wand: 'ไม้กายสิทธิ์' };

const materials = new Map();
function mat(color, glow = false) {
  const key = `${color}:${glow}`;
  if (!materials.has(key)) {
    materials.set(key, glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color, flatShading: true }));
  }
  return materials.get(key);
}

const boxes = new Map();
function vox(group, w, h, d, color, x, y, z, glow = false) {
  const key = `${w}:${h}:${d}`;
  if (!boxes.has(key)) boxes.set(key, new THREE.BoxGeometry(w, h, d));
  const m = new THREE.Mesh(boxes.get(key), mat(color, glow));
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}

const BUILDERS = {
  sword(g) {
    vox(g, 0.08, 0.22, 0.08, 0x6b3f22, 0, 0.02, 0); // ด้าม
    vox(g, 0.1, 0.06, 0.1, 0xfeae34, 0, -0.12, 0); // ปุ่มท้ายด้าม
    vox(g, 0.34, 0.06, 0.1, 0xfeae34, 0, 0.16, 0); // กั่น
    vox(g, 0.12, 0.62, 0.05, 0xc0cbdc, 0, 0.5, 0); // ใบดาบ
    vox(g, 0.04, 0.62, 0.055, 0xffffff, -0.03, 0.5, 0); // เงาแวว
    vox(g, 0.07, 0.08, 0.05, 0xc0cbdc, 0, 0.85, 0); // ปลาย
  },
  guitar(g) {
    g.userData.upright = true;
    vox(g, 0.07, 0.55, 0.05, 0x8f563b, 0, 0.32, 0); // คอ
    vox(g, 0.12, 0.1, 0.06, 0x3e2731, 0, 0.62, 0); // หัว
    vox(g, 0.4, 0.28, 0.12, 0xe43b44, 0, -0.1, 0); // ตัวล่าง
    vox(g, 0.3, 0.2, 0.12, 0xe43b44, 0, 0.12, 0); // ตัวบน
    vox(g, 0.1, 0.1, 0.13, 0x181425, 0, 0.0, 0); // รู
  },
  mic(g) {
    vox(g, 0.07, 0.3, 0.07, 0x3a4466, 0, 0.05, 0);
    vox(g, 0.16, 0.16, 0.16, 0x8b9bb4, 0, 0.28, 0);
    vox(g, 0.17, 0.04, 0.17, 0x5a6988, 0, 0.22, 0);
  },
  torch(g) {
    vox(g, 0.07, 0.42, 0.07, 0x6b3f22, 0, 0.08, 0);
    vox(g, 0.12, 0.06, 0.12, 0x3a4466, 0, 0.3, 0);
    g.userData.flame = [
      vox(g, 0.12, 0.14, 0.12, 0xf77622, 0, 0.4, 0, true),
      vox(g, 0.07, 0.1, 0.07, 0xfee761, 0, 0.5, 0, true),
    ];
  },
  shield(g) {
    g.userData.upright = true;
    vox(g, 0.44, 0.52, 0.07, 0x0099db, 0, 0.15, 0);
    vox(g, 0.5, 0.06, 0.08, 0xfeae34, 0, 0.42, 0);
    vox(g, 0.36, 0.06, 0.08, 0xfeae34, 0, -0.12, 0);
    vox(g, 0.08, 0.4, 0.08, 0xfeae34, 0, 0.15, 0.01);
    vox(g, 0.26, 0.08, 0.08, 0xfeae34, 0, 0.2, 0.01);
  },
  wand(g) {
    vox(g, 0.045, 0.5, 0.045, 0x3e2731, 0, 0.12, 0);
    vox(g, 0.16, 0.06, 0.06, 0xfee761, 0, 0.42, 0, true);
    vox(g, 0.06, 0.16, 0.06, 0xfee761, 0, 0.42, 0, true);
    vox(g, 0.05, 0.05, 0.05, 0xffffff, 0, 0.42, 0.04, true);
  },
};

export function buildItem(kind) {
  const group = new THREE.Group();
  (BUILDERS[kind] ?? BUILDERS.sword)(group);
  group.userData.kind = kind;
  return group;
}

// เปลวไฟ/ดาวกระพริบ (เรียกทุกเฟรมกับของที่มี userData.flame)
export function animateItem(group, t) {
  for (const [i, flame] of (group.userData.flame ?? []).entries()) {
    flame.scale.setScalar(0.85 + Math.abs(Math.sin(t * 9 + i * 2)) * 0.3);
  }
}
