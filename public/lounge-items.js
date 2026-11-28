// ไอเทม/อาวุธ: ใช้ทั้งตอนวางบนพื้นและตอนถือในมือ
// ทุกชิ้นสร้างให้ "ด้ามจับ" อยู่ที่จุด (0,0,0) แล้วยาวขึ้นไปทาง +y · ด้านหน้า (หน้าโล่/หน้ากีตาร์) หันไปทาง +z
// ทรงโค้งจริง (ทรงกระบอก/ทรงกลม/ใบมีดรีดจากเส้นรอบรูปแบบลบคม) แทนกล่อง voxel · เหล็กใช้วัสดุมันวาวให้มีจุดสะท้อนแสง
// รายชื่อ ITEM_KINDS ต้องตรงกับ server/items.js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ITEM_KINDS = ['sword', 'guitar', 'mic', 'torch', 'shield', 'wand'];
export const ITEM_NAMES = { sword: 'ดาบ', guitar: 'กีตาร์', mic: 'ไมค์', torch: 'คบไฟ', shield: 'โล่', wand: 'ไม้กายสิทธิ์' };

// โทนวัสดุ: เหล็ก 3 ระดับ + ไม้ + หนังพันด้าม + ทอง
const STEEL = 0xc0cbdc;
const STEEL_MID = 0x8b9bb4;
const STEEL_DARK = 0x5a6988;
const WOOD = 0x6b3f22;
const WOOD_LIGHT = 0x8f563b;
const LEATHER = 0x3e2731;
const GOLD = 0xfeae34;
const RED = 0xe43b44;
// สีที่เป็นโลหะ → วัสดุมันวาว (Phong) · ที่เหลือเป็นผิวด้าน (Lambert)
const METALS = new Set([STEEL, STEEL_MID, STEEL_DARK, GOLD]);

// วัสดุ/geometry ใช้ร่วมกันทุกชิ้นที่หน้าตาเหมือนกัน (ไอเทมถูกสร้างใหม่บ่อย ตอนเกิด/หยิบ/สลับอาวุธ)
// ⚠️ เพราะใช้ร่วมกัน ห้าม dispose geometry ของไอเทม (ลานประลองเว้นคบไฟไว้ใน disposeArena แล้ว)
const materials = new Map();
function mat(color, glow = false) {
  const key = `${color}:${glow}`;
  if (!materials.has(key)) {
    let m;
    if (glow) m = new THREE.MeshBasicMaterial({ color });
    else if (METALS.has(color)) m = new THREE.MeshPhongMaterial({ color, shininess: 70, specular: 0x777777 });
    else m = new THREE.MeshLambertMaterial({ color });
    materials.set(key, m);
  }
  return materials.get(key);
}
const geos = new Map();
const cached = (key, make) => {
  if (!geos.has(key)) geos.set(key, make());
  return geos.get(key);
};

function put(group, geo, color, x, y, z, glow = false) {
  const m = new THREE.Mesh(geo, mat(color, glow));
  m.position.set(x, y, z);
  m.castShadow = true;
  group.add(m);
  return m;
}
// ทรงกระบอกตั้ง (rTop ≠ rBot = เรียว)
const cyl = (g, rTop, rBot, h, color, x, y, z, seg = 10, glow = false) => put(g, cached(`c${rTop}:${rBot}:${h}:${seg}`, () => new THREE.CylinderGeometry(rTop, rBot, h, seg)), color, x, y, z, glow);
const ball = (g, r, color, x, y, z, glow = false) => put(g, cached(`s${r}`, () => new THREE.SphereGeometry(r, 12, 9)), color, x, y, z, glow);
const rbox = (g, w, h, d, color, x, y, z, r = 0.015) => put(g, cached(`b${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45))), color, x, y, z);
// แหวนรัดรอบแกน y (ปลอก/คาด)
const ring = (g, r, tube, color, y) => {
  const m = put(g, cached(`t${r}:${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 16)), color, 0, y, 0);
  m.rotation.x = Math.PI / 2;
  return m;
};
// รีดรูปเส้นรอบรูป (ระนาบ xy) ให้หนาตามแกน z แบบลบคมขอบ → ใบมีด/หัวหอก/โล่ (กึ่งกลางความหนาอยู่ที่ z = 0)
function slab(key, points, depth, bevel) {
  return cached(key, () => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  });
}

// ด้ามหนังพันเป็นปล้องนูน ดูเป็นด้ามจับจริง ไม่ใช่แท่งเรียบ
function wrappedGrip(g, r, h, y, bands = 3) {
  cyl(g, r, r, h, LEATHER, 0, y, 0);
  for (let i = 0; i < bands; i += 1) ring(g, r, 0.008, WOOD, y - h / 2 + (h * (i + 0.5)) / bands);
}

// เส้นรอบรูปโล่ทรงหยดน้ำกลับหัว (heater) · s = ขยาย (ไว้ทำขอบเหล็กที่ใหญ่กว่าหน้าโล่นิดนึง)
function shieldOutline(s) {
  const side = (t) => [0.25 * s * (1 - t) ** 1.4, 0.17 - 0.44 * s * Math.sin((t * Math.PI) / 2)];
  const pts = [[-0.25 * s, 0.43], [0.25 * s, 0.43], [0.25 * s, 0.17]];
  for (let i = 1; i <= 8; i += 1) pts.push(side(i / 8));
  for (let i = 7; i >= 0; i -= 1) {
    const [x, y] = side(i / 8);
    pts.push([-x, y]);
  }
  return pts;
}

const BUILDERS = {
  // ดาบยาวมือเดียว: ปุ่มท้ายทอง+พลอย · ด้ามพันหนัง · กั่นปลายกลม · ใบเรียวปลายแหลม ลบคม
  sword(g) {
    ball(g, 0.05, GOLD, 0, -0.14, 0);
    ball(g, 0.022, RED, 0, -0.14, 0.04);
    wrappedGrip(g, 0.034, 0.2, 0.0);
    rbox(g, 0.36, 0.04, 0.07, STEEL_DARK, 0, 0.12, 0, 0.018); // กั่น
    for (const s of [-1, 1]) ball(g, 0.032, STEEL_DARK, s * 0.18, 0.13, 0);
    ball(g, 0.045, GOLD, 0, 0.12, 0); // กลางกั่น
    put(g, slab('sword', [[-0.055, 0.15], [0.055, 0.15], [0.048, 0.78], [0, 0.98], [-0.048, 0.78]], 0.012, 0.01), STEEL, 0, 0, 0);
  },
  guitar(g) {
    g.userData.upright = true;
    // ตัวกีตาร์ทรงเลข 8: ส่วนล่างใหญ่ + ส่วนบนเล็กกว่า (ทรงกระบอกแบนวางซ้อนกัน) + ขอบเหลือง
    for (const [r, y] of [[0.2, -0.1], [0.15, 0.13]]) {
      put(g, cached(`gb${r}`, () => new THREE.CylinderGeometry(r, r, 0.1, 28).rotateX(Math.PI / 2)), RED, 0, y, 0);
      put(g, cached(`gr${r}`, () => new THREE.TorusGeometry(r, 0.012, 6, 28)), 0xfee761, 0, y, 0.05);
    }
    put(g, cached('ghole', () => new THREE.CylinderGeometry(0.055, 0.055, 0.01, 20).rotateX(Math.PI / 2)), 0x181425, 0, 0.04, 0.051);
    rbox(g, 0.12, 0.03, 0.02, LEATHER, 0, -0.17, 0.055); // หย่อง
    rbox(g, 0.06, 0.52, 0.04, WOOD_LIGHT, 0, 0.5, 0.01, 0.012); // คอ
    rbox(g, 0.1, 0.14, 0.035, LEATHER, 0, 0.82, 0.01, 0.015); // หัว
    for (const s of [-1, 1]) for (const y of [0.78, 0.84]) ball(g, 0.012, GOLD, s * 0.058, y, 0.01); // ลูกบิด
    for (const x of [-0.015, 0.015]) cyl(g, 0.003, 0.003, 0.95, 0xeaf4ff, x, 0.33, 0.06, 4); // สาย
  },
  mic(g) {
    cyl(g, 0.045, 0.032, 0.3, 0x262b44, 0, 0.05, 0, 14);
    ring(g, 0.05, 0.012, STEEL_DARK, 0.21);
    ball(g, 0.085, STEEL_MID, 0, 0.28, 0); // ตะแกรงหัวไมค์
  },
  torch(g) {
    cyl(g, 0.04, 0.028, 0.42, WOOD, 0, 0.08, 0, 8);
    cyl(g, 0.065, 0.045, 0.08, STEEL_DARK, 0, 0.3, 0, 12); // ถ้วยใส่เชื้อไฟ
    ring(g, 0.04, 0.01, LEATHER, 0.22);
    g.userData.flame = [
      put(g, cached('flameO', () => new THREE.ConeGeometry(0.065, 0.2, 10)), 0xf77622, 0, 0.43, 0, true),
      put(g, cached('flameI', () => new THREE.ConeGeometry(0.038, 0.14, 8)), 0xfee761, 0, 0.42, 0, true),
    ];
  },
  // โล่ heater: ขอบเหล็ก · หน้าโล่สีฟ้า · กางเขนทอง · ปุ่มเหล็กกลางโล่ + หมุด
  shield(g) {
    g.userData.upright = true;
    put(g, slab('shieldRim', shieldOutline(1.08), 0.05, 0.015), STEEL_MID, 0, -0.02, -0.008);
    put(g, slab('shieldFace', shieldOutline(1), 0.05, 0.012), 0x0099db, 0, 0, 0.006);
    rbox(g, 0.05, 0.56, 0.02, GOLD, 0, 0.1, 0.045); // กางเขนแนวตั้ง
    rbox(g, 0.36, 0.05, 0.02, GOLD, 0, 0.27, 0.046); // กางเขนแนวนอน
    const boss = ball(g, 0.07, STEEL, 0, 0.27, 0.045); // ปุ่มกลางโล่
    boss.scale.z = 0.55;
    for (const [x, y] of [[-0.19, 0.38], [0.19, 0.38], [-0.19, 0.1], [0.19, 0.1]]) ball(g, 0.016, STEEL_DARK, x, y, 0.04); // หมุด
  },
  wand(g) {
    cyl(g, 0.014, 0.024, 0.5, LEATHER, 0, 0.12, 0, 8);
    ring(g, 0.02, 0.006, GOLD, 0.34);
    const star = [];
    for (let i = 0; i < 10; i += 1) {
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
      const r = i % 2 ? 0.038 : 0.09;
      star.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    put(g, slab('star', star, 0.02, 0.008), 0xfee761, 0, 0.43, 0, true);
    ball(g, 0.025, 0xffffff, 0, 0.43, 0.025, true);
  },
};

// ---------- อาวุธในลานประลอง (ไม่ได้อยู่ใน ITEM_KINDS → ไม่เกิดในลานฟังเพลง) ----------
Object.assign(BUILDERS, {
  // ค้อนศึก: ด้ามไม้ยาว พันหนังช่วงจับ ปลอกเหล็ก · หัวเหล็กทรงกระบอกนอน หน้าทุบกลมสองฝั่ง คาดทอง · หนามบนหัว
  hammer(g) {
    ball(g, 0.045, STEEL_DARK, 0, -0.17, 0);
    wrappedGrip(g, 0.042, 0.26, -0.01, 4);
    cyl(g, 0.036, 0.04, 0.72, WOOD, 0, 0.48, 0, 10);
    ring(g, 0.042, 0.01, STEEL_DARK, 0.42);
    cyl(g, 0.055, 0.045, 0.1, STEEL_DARK, 0, 0.76, 0, 12); // ปลอกใต้หัว
    put(g, cached('hhead', () => new THREE.CylinderGeometry(0.13, 0.13, 0.42, 20).rotateZ(Math.PI / 2)), STEEL_MID, 0, 0.92, 0);
    put(g, cached('hband', () => new THREE.CylinderGeometry(0.137, 0.137, 0.06, 20).rotateZ(Math.PI / 2)), GOLD, 0, 0.92, 0);
    for (const s of [-1, 1]) put(g, cached('hface', () => new THREE.CylinderGeometry(0.15, 0.15, 0.06, 20).rotateZ(Math.PI / 2)), STEEL_DARK, s * 0.22, 0.92, 0); // หน้าทุบ
    put(g, cached('hspike', () => new THREE.ConeGeometry(0.05, 0.16, 10)), STEEL, 0, 1.12, 0); // หนามบนหัว
  },
  // มีดสั้นคู่: ปุ่มท้ายกลม ด้ามพันหนัง กั่นสั้น ใบเรียวปลายแหลม
  dagger(g) {
    g.userData.dual = true; // ถือสองมือ
    ball(g, 0.035, STEEL_DARK, 0, -0.09, 0);
    wrappedGrip(g, 0.027, 0.13, 0.0, 2);
    rbox(g, 0.17, 0.03, 0.055, STEEL_MID, 0, 0.08, 0, 0.012);
    ball(g, 0.026, GOLD, 0, 0.08, 0);
    put(g, slab('dagger', [[-0.038, 0.09], [0.038, 0.09], [0.032, 0.28], [0, 0.39], [-0.026, 0.28]], 0.01, 0.008), STEEL, 0, 0, 0);
  },
  // หอก: ด้ามยาว ปลายหุ้มเหล็ก · ปลอกต่อหัว + พู่แดงห้อย · หัวทรงใบไม้ลบคม
  spear(g) {
    put(g, cached('sbutt', () => new THREE.ConeGeometry(0.035, 0.1, 10).rotateX(Math.PI)), STEEL_DARK, 0, -0.33, 0);
    wrappedGrip(g, 0.032, 0.24, 0.0, 3);
    cyl(g, 0.026, 0.03, 1.42, WOOD_LIGHT, 0, 0.42, 0, 10);
    ball(g, 0.045, RED, 0, 1.06, 0); // พู่แดง
    for (let k = 0; k < 6; k += 1) {
      const a = (k / 6) * Math.PI * 2;
      const tuft = put(g, cached('tassel', () => new THREE.ConeGeometry(0.02, 0.16, 5).rotateX(Math.PI)), RED, Math.cos(a) * 0.035, 0.98, Math.sin(a) * 0.035);
      tuft.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    }
    cyl(g, 0.03, 0.04, 0.14, STEEL_DARK, 0, 1.16, 0, 12); // ปลอกต่อหัว
    put(g, slab('spear', [[0, 1.22], [0.065, 1.36], [0.045, 1.46], [0, 1.64], [-0.045, 1.46], [-0.065, 1.36]], 0.012, 0.012), STEEL, 0, 0, 0);
  },
  // ธนูโค้งกลับ (recurve): คันเป็นท่อโค้งต่อเนื่อง ปีกงอไปทาง -z แล้วปลายสะบัดออก · ด้ามพันหนัง · สายตึงระหว่างปลาย
  bow(g) {
    g.userData.upright = true;
    const limb = cached('bowLimb', () => {
      const pts = [[-0.48, -0.12], [-0.4, -0.17], [-0.25, -0.14], [-0.08, -0.05], [0.1, 0], [0.28, -0.05], [0.45, -0.14], [0.6, -0.17], [0.68, -0.12]];
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([y, z]) => new THREE.Vector3(0, y, z))), 48, 0.022, 7);
    });
    put(g, limb, WOOD, 0, 0, 0);
    cyl(g, 0.034, 0.034, 0.14, LEATHER, 0, 0.1, 0, 10); // ที่จับ
    ball(g, 0.018, GOLD, 0, 0.18, 0.03); // ที่วางลูกธนู
    cyl(g, 0.004, 0.004, 1.16, 0xffffff, 0, 0.1, -0.12, 4); // สาย (ตรงจากปลายล่างถึงปลายบน)
  },
  // คทาไฟ: ด้ามไม้เข้มคาดทอง · หัวเป็นกรงทองสี่ขาจับลูกไฟ
  staff(g) {
    ball(g, 0.04, GOLD, 0, -0.27, 0);
    wrappedGrip(g, 0.034, 0.2, 0.0, 3);
    cyl(g, 0.028, 0.032, 0.96, LEATHER, 0, 0.5, 0, 10);
    for (const y of [0.18, 0.52]) ring(g, 0.034, 0.009, GOLD, y);
    cyl(g, 0.07, 0.04, 0.07, GOLD, 0, 0.99, 0, 14); // ฐานกรง
    for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const prong = cyl(g, 0.012, 0.016, 0.2, GOLD, x * 0.08, 1.1, z * 0.08, 6); // ขากรงเอียงออก
      prong.rotation.set(z * 0.3, 0, -x * 0.3);
      ball(g, 0.018, GOLD, x * 0.075, 1.21, z * 0.075); // ปลายขางุ้มเข้า
    }
    g.userData.flame = [
      put(g, cached('fireO', () => new THREE.IcosahedronGeometry(0.085, 1)), 0xf77622, 0, 1.12, 0, true),
      put(g, cached('fireI', () => new THREE.IcosahedronGeometry(0.05, 1)), 0xfee761, 0, 1.13, 0, true),
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
