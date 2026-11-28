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

// โทนวัสดุของอาวุธ: เหล็ก 3 ระดับ (สว่าง/กลาง/เข้ม) + ไม้ + หนังพันด้าม + ทอง
const STEEL = 0xc0cbdc;
const STEEL_MID = 0x8b9bb4;
const STEEL_DARK = 0x5a6988;
const IRON = 0x3a4466;
const SHINE = 0xffffff;
const WOOD = 0x6b3f22;
const WOOD_LIGHT = 0x8f563b;
const LEATHER = 0x3e2731;
const GOLD = 0xfeae34;

// ด้ามหนังพันเป็นปล้อง (ดูเป็นด้ามจับจริง ไม่ใช่แท่งเรียบ)
function wrappedGrip(g, w, h, y, bands = 3) {
  vox(g, w, h, w, LEATHER, 0, y, 0);
  for (let i = 0; i < bands; i += 1) vox(g, w + 0.012, 0.022, w + 0.012, WOOD, 0, y - h / 2 + (h * (i + 0.5)) / bands, 0);
}

const BUILDERS = {
  // ดาบยาวมือเดียว: ปุ่มท้ายทอง · ด้ามพันหนัง · กั่นเหล็กปลายงอนขึ้น · ใบเรียวมีร่องเลือดกลางใบ · ปลายแหลมไล่ขั้น
  sword(g) {
    vox(g, 0.1, 0.08, 0.1, GOLD, 0, -0.13, 0); // ปุ่มท้ายด้าม
    vox(g, 0.05, 0.05, 0.11, 0xe43b44, 0, -0.13, 0); // พลอยแดงที่ปุ่ม
    wrappedGrip(g, 0.07, 0.2, 0.0);
    vox(g, 0.12, 0.07, 0.1, GOLD, 0, 0.13, 0); // กลางกั่น
    vox(g, 0.4, 0.045, 0.08, STEEL_DARK, 0, 0.13, 0); // กั่น
    vox(g, 0.05, 0.09, 0.08, STEEL_DARK, -0.2, 0.16, 0); // ปลายกั่นงอนขึ้น
    vox(g, 0.05, 0.09, 0.08, STEEL_DARK, 0.2, 0.16, 0);
    vox(g, 0.1, 0.06, 0.045, STEEL_MID, 0, 0.19, 0); // โคนใบ
    vox(g, 0.12, 0.44, 0.04, STEEL, 0, 0.44, 0); // ใบช่วงล่าง (กว้าง)
    vox(g, 0.1, 0.22, 0.04, STEEL, 0, 0.77, 0); // ใบช่วงบน (เรียวลง)
    vox(g, 0.07, 0.06, 0.04, STEEL, 0, 0.91, 0); // ปลายไล่ขั้น
    vox(g, 0.035, 0.05, 0.04, STEEL, 0, 0.965, 0);
    vox(g, 0.026, 0.56, 0.046, STEEL_MID, 0, 0.5, 0); // ร่องกลางใบ
    vox(g, 0.018, 0.62, 0.044, SHINE, -0.047, 0.52, 0); // คมใบสะท้อนแสง
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
  // โล่ทรงหยดน้ำกลับหัว (heater): ขอบเหล็ก · แบ่งสองสีแบบตราประจำตระกูล · ไม้กางเขนทอง · ปุ่มเหล็กกลางโล่ + หมุด
  shield(g) {
    g.userData.upright = true;
    const BLUE = 0x0099db;
    const BLUE_DARK = 0x124e89;
    vox(g, 0.46, 0.36, 0.07, BLUE, 0, 0.24, 0); // ตัวโล่ช่วงบน
    vox(g, 0.22, 0.36, 0.074, BLUE_DARK, -0.12, 0.24, 0); // ซีกซ้ายสีเข้ม
    vox(g, 0.38, 0.12, 0.07, BLUE, 0, 0.0, 0); // ไล่แคบลงเป็นปลายแหลม
    vox(g, 0.18, 0.12, 0.074, BLUE_DARK, -0.1, 0.0, 0);
    vox(g, 0.26, 0.1, 0.07, BLUE, 0, -0.11, 0);
    vox(g, 0.14, 0.08, 0.07, BLUE, 0, -0.2, 0);
    vox(g, 0.06, 0.06, 0.07, STEEL_MID, 0, -0.26, 0); // ปลายแหลมหุ้มเหล็ก
    vox(g, 0.52, 0.05, 0.09, STEEL_MID, 0, 0.43, 0); // ขอบบน
    vox(g, 0.04, 0.38, 0.09, STEEL_MID, -0.25, 0.24, 0); // ขอบข้าง
    vox(g, 0.04, 0.38, 0.09, STEEL_MID, 0.25, 0.24, 0);
    vox(g, 0.06, 0.52, 0.085, GOLD, 0, 0.12, 0.003); // กางเขนแนวตั้ง
    vox(g, 0.36, 0.06, 0.085, GOLD, 0, 0.27, 0.003); // กางเขนแนวนอน
    vox(g, 0.13, 0.13, 0.1, STEEL, 0, 0.27, 0.01); // ปุ่มกลางโล่
    vox(g, 0.05, 0.05, 0.11, SHINE, -0.03, 0.3, 0.01);
    for (const [x, y] of [[-0.19, 0.38], [0.19, 0.38], [-0.19, 0.1], [0.19, 0.1]]) vox(g, 0.035, 0.035, 0.09, STEEL_DARK, x, y, 0.004); // หมุด
  },
  wand(g) {
    vox(g, 0.045, 0.5, 0.045, 0x3e2731, 0, 0.12, 0);
    vox(g, 0.16, 0.06, 0.06, 0xfee761, 0, 0.42, 0, true);
    vox(g, 0.06, 0.16, 0.06, 0xfee761, 0, 0.42, 0, true);
    vox(g, 0.05, 0.05, 0.05, 0xffffff, 0, 0.42, 0.04, true);
  },
};

// ---------- อาวุธในลานประลอง (ไม่ได้อยู่ใน ITEM_KINDS → ไม่เกิดในลานฟังเพลง) ----------
Object.assign(BUILDERS, {
  // ค้อนศึก: ด้ามยาวไม้ พันหนังช่วงจับ ปลอกเหล็กสองข้อ · หัวเหล็กหน้าทุบแบนกว้างสองฝั่ง ขอบเข้ม · หนามบนหัว
  hammer(g) {
    vox(g, 0.07, 0.08, 0.07, STEEL_DARK, 0, -0.17, 0); // ปลายด้าม
    wrappedGrip(g, 0.085, 0.26, -0.01, 4);
    vox(g, 0.075, 0.72, 0.075, WOOD, 0, 0.48, 0); // ด้าม
    vox(g, 0.095, 0.04, 0.095, STEEL_DARK, 0, 0.42, 0); // ปลอกเหล็ก
    vox(g, 0.1, 0.1, 0.1, STEEL_DARK, 0, 0.76, 0); // ปลอกใต้หัว
    vox(g, 0.24, 0.24, 0.24, STEEL_DARK, 0, 0.9, 0); // แกนหัวค้อน
    vox(g, 0.26, 0.05, 0.26, GOLD, 0, 0.9, 0); // คาดทอง
    for (const side of [-1, 1]) {
      vox(g, 0.13, 0.3, 0.3, STEEL_MID, side * 0.18, 0.9, 0); // หน้าทุบ
      vox(g, 0.03, 0.32, 0.32, IRON, side * 0.26, 0.9, 0); // ขอบหน้าทุบ
      vox(g, 0.02, 0.18, 0.06, SHINE, side * 0.25, 0.95, 0.09); // แสงสะท้อน
    }
    vox(g, 0.08, 0.12, 0.08, STEEL_MID, 0, 1.08, 0); // หนามบนหัว
    vox(g, 0.04, 0.06, 0.04, STEEL, 0, 1.16, 0);
  },
  // มีดสั้นคู่: ปุ่มท้ายเหล็ก ด้ามพันหนัง กั่นสั้น ใบเรียวปลายแหลม คมหนึ่งด้านสะท้อนแสง
  dagger(g) {
    g.userData.dual = true; // ถือสองมือ
    vox(g, 0.07, 0.06, 0.07, STEEL_DARK, 0, -0.09, 0);
    wrappedGrip(g, 0.055, 0.13, 0.0, 2);
    vox(g, 0.18, 0.035, 0.065, STEEL_MID, 0, 0.08, 0);
    vox(g, 0.04, 0.05, 0.065, GOLD, 0, 0.08, 0);
    vox(g, 0.08, 0.17, 0.03, STEEL, 0, 0.18, 0);
    vox(g, 0.06, 0.08, 0.03, STEEL, 0, 0.3, 0);
    vox(g, 0.03, 0.05, 0.03, STEEL, -0.01, 0.365, 0);
    vox(g, 0.016, 0.24, 0.034, SHINE, -0.034, 0.22, 0);
    vox(g, 0.02, 0.18, 0.034, STEEL_MID, 0.012, 0.2, 0); // สันมีด
  },
  // หอก: ด้ามยาว ปลายหุ้มเหล็ก · ปลอกต่อหัว + พู่แดงห้อย · หัวทรงใบไม้มีสันกลาง
  spear(g) {
    vox(g, 0.07, 0.07, 0.07, STEEL_DARK, 0, -0.32, 0); // ปลายด้ามหุ้มเหล็ก
    wrappedGrip(g, 0.065, 0.24, 0.0, 3);
    vox(g, 0.055, 1.42, 0.055, WOOD_LIGHT, 0, 0.42, 0); // ด้าม
    vox(g, 0.09, 0.07, 0.09, 0xe43b44, 0, 1.06, 0); // พู่แดง
    for (const [x, z] of [[-0.04, 0], [0.04, 0], [0, -0.04], [0, 0.04]]) vox(g, 0.03, 0.12, 0.03, 0xe43b44, x, 0.98, z); // พู่ห้อย
    vox(g, 0.08, 0.14, 0.08, STEEL_DARK, 0, 1.16, 0); // ปลอกต่อหัว
    vox(g, 0.05, 0.05, 0.035, STEEL, 0, 1.25, 0); // คอหัวหอก
    vox(g, 0.13, 0.13, 0.035, STEEL, 0, 1.34, 0); // หัวหอกช่วงกว้าง
    vox(g, 0.09, 0.1, 0.035, STEEL, 0, 1.455, 0);
    vox(g, 0.05, 0.08, 0.035, STEEL, 0, 1.545, 0);
    vox(g, 0.022, 0.05, 0.035, STEEL, 0, 1.61, 0); // ปลายแหลม
    vox(g, 0.024, 0.32, 0.045, STEEL_MID, 0, 1.42, 0); // สันกลาง
    vox(g, 0.014, 0.18, 0.04, SHINE, -0.045, 1.36, 0);
  },
  // ธนูโค้งกลับ (recurve): คันไม้ ด้ามพันหนัง · ปีกสองท่อนงอเข้าหาคนยิงแล้วปลายสะบัดออก · สายตึงระหว่างปลายสองข้าง
  bow(g) {
    g.userData.upright = true;
    vox(g, 0.07, 0.34, 0.07, WOOD, 0, 0.1, 0); // ตัวคัน
    vox(g, 0.08, 0.13, 0.08, LEATHER, 0, 0.1, 0); // ที่จับ
    vox(g, 0.03, 0.03, 0.09, GOLD, 0, 0.18, 0); // ที่วางลูกธนู
    const tips = [];
    for (const dir of [1, -1]) {
      // ปีกบน (dir 1) / ล่าง (dir -1): ท่อนใน → ท่อนนอก → ปลายสะบัด ซ้อนกลุ่มกันให้โค้งต่อเนื่อง
      const inner = new THREE.Group();
      inner.position.set(0, 0.1 + dir * 0.17, 0);
      inner.rotation.x = -dir * 0.32;
      vox(inner, 0.055, 0.24, 0.055, WOOD, 0, dir * 0.12, 0);
      const outer = new THREE.Group();
      outer.position.set(0, dir * 0.24, 0);
      outer.rotation.x = -dir * 0.42;
      vox(outer, 0.045, 0.2, 0.045, WOOD_LIGHT, 0, dir * 0.1, 0);
      const flick = new THREE.Group();
      flick.position.set(0, dir * 0.2, 0);
      flick.rotation.x = dir * 0.9;
      vox(flick, 0.04, 0.07, 0.04, LEATHER, 0, dir * 0.035, 0);
      const tip = new THREE.Object3D();
      tip.position.set(0, dir * 0.03, 0);
      flick.add(tip);
      outer.add(flick);
      inner.add(outer);
      g.add(inner);
      tips.push(tip);
    }
    // สาย: วัดตำแหน่งปลายจริงหลังประกอบเสร็จ แล้ววางกล่องบางๆ เชื่อมสองจุด
    g.updateMatrixWorld(true);
    const [a, b] = tips.map((t) => g.worldToLocal(t.getWorldPosition(new THREE.Vector3())));
    const string = vox(g, 0.012, a.distanceTo(b), 0.012, SHINE, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    string.lookAt(g.localToWorld(b.clone()));
    string.rotateX(Math.PI / 2);
  },
  // คทาไฟ: ด้ามไม้เข้มคาดทอง · หัวเป็นกรงทองสี่ขาจับลูกไฟ
  staff(g) {
    vox(g, 0.075, 0.06, 0.075, GOLD, 0, -0.27, 0); // ปลายด้าม
    wrappedGrip(g, 0.07, 0.2, 0.0, 3);
    vox(g, 0.06, 0.96, 0.06, LEATHER, 0, 0.5, 0); // ด้าม
    for (const y of [0.18, 0.52]) vox(g, 0.075, 0.03, 0.075, GOLD, 0, y, 0); // คาดทอง
    vox(g, 0.13, 0.06, 0.13, GOLD, 0, 0.99, 0); // ฐานกรง
    for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const prong = vox(g, 0.035, 0.2, 0.035, GOLD, x * 0.08, 1.1, z * 0.08); // ขากรงเอียงออก
      prong.rotation.set(z * 0.3, 0, -x * 0.3);
      vox(g, 0.03, 0.05, 0.03, GOLD, x * 0.075, 1.21, z * 0.075); // ปลายขางุ้มเข้า
    }
    g.userData.flame = [
      vox(g, 0.16, 0.16, 0.16, 0xf77622, 0, 1.12, 0, true),
      vox(g, 0.09, 0.09, 0.09, 0xfee761, 0, 1.13, 0, true),
    ];
  },
});

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
