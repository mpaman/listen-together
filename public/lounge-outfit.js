// รายละเอียดชุด + ของบนหลัง ของตัวละคร voxel (แยกจาก lounge-avatar.js ให้ไฟล์ไม่บวม)
// ลำตัว (torso) กว้าง 0.52 สูง 0.58 หนา 0.3 · พิกัดลูกของ torso นับจากกลางลำตัว: หน้า z = +0.15 หลัง z = -0.15 บน y = +0.29
// ของบนหลังติดกับ torso → หายใจ/โน้มตัวแล้วขยับตามเอง · ปีก/ผ้าคลุมมีฟังก์ชันขยับเพิ่มเติม (คืนจาก buildBack)
import * as THREE from 'three';

const geo = new Map();
const box = (w, h, d) => {
  const key = `${w}:${h}:${d}`;
  if (!geo.has(key)) geo.set(key, new THREE.BoxGeometry(w, h, d));
  return geo.get(key);
};
const mat = (color, glow = false) => (glow ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color, flatShading: true }));

function vox(parent, w, h, d, color, x, y, z, glow = false) {
  const m = new THREE.Mesh(box(w, h, d), typeof color === 'number' ? mat(color, glow) : color);
  m.position.set(x, y, z);
  m.castShadow = !glow;
  parent.add(m);
  return m;
}

function group(parent, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  parent.add(g);
  return g;
}

const WHITE = 0xffffff;
const GOLD = 0xfeae34;
const LEATHER = 0x8f563b;
const DARK = 0x262b44;
const STEEL = 0xc0cbdc;
const ACCENTS = [0xe43b44, 0x0099db, 0xfeae34, 0x63c74d, 0xb55088, 0x2ce8f5, 0xf77622];
const PANTS_COLORS = [0x3a4466, 0x262b44, 0x5a6988, 0x733e39, 0x3e8948];

export const BACK_NAMES = ['ไม่มี', 'ปลอกดาบ', 'ธนู + กระบอกลูกธนู', 'ปีกนางฟ้า', 'ปีกค้างคาว', 'ผ้าคลุม', 'กระเป๋าเป้', 'เจ็ตแพ็ก', 'ปีกผีเสื้อ'];
export const OUTFIT_NAMES = ['เสื้อยืด', 'ลายขวาง', 'แจ็กเก็ต', 'เอี๊ยม', 'ฮู้ด', 'เกราะ', 'สูทผูกไท'];

// สีหลักของชุดก่อนสร้างแขนขา: บางชุดเปลี่ยนสีแขนเสื้อ/ลำตัว/กางเกง
export function outfitColors(look, shirt) {
  const pants = PANTS_COLORS[(look.body + look.outfit) % PANTS_COLORS.length];
  switch (look.outfit) {
    case 2: return { torso: WHITE, sleeve: ACCENTS[(look.body + 3) % ACCENTS.length] === shirt ? DARK : ACCENTS[(look.body + 3) % ACCENTS.length], pants };
    case 3: return { torso: shirt, sleeve: shirt, pants: 0x3a6ea5 };
    case 6: return { torso: DARK, sleeve: DARK, pants: DARK };
    default: return { torso: shirt, sleeve: shirt, pants };
  }
}

// ลวดลายบนตัว (ทำหลังสร้างแขนแล้ว เพราะบางชุดมีของบนไหล่)
export function decorateOutfit(torso, arms, look, colors) {
  const accent = ACCENTS[(look.body + look.outfit) % ACCENTS.length];
  switch (look.outfit) {
    case 1: // ลายขวาง 2 เส้น + ปลายแขนเสื้อ
      for (const y of [0.1, -0.06]) vox(torso, 0.535, 0.07, 0.31, WHITE, 0, y, 0);
      for (const arm of arms) vox(arm, 0.17, 0.05, 0.19, WHITE, 0, -0.3, 0);
      break;
    case 2: { // แจ็กเก็ตเปิดหน้า: สาบเสื้อสองข้าง + ปก · ข้างในเสื้อขาว
      const jacket = colors.sleeve;
      for (const side of [-1, 1]) vox(torso, 0.18, 0.58, 0.02, jacket, side * 0.175, 0, 0.152);
      vox(torso, 0.53, 0.58, 0.29, jacket, 0, 0, -0.01); // ด้านข้าง/หลังเป็นสีแจ็กเก็ต
      vox(torso, 0.56, 0.08, 0.33, jacket, 0, 0.27, 0); // ปก
      vox(torso, 0.05, 0.05, 0.02, GOLD, -0.11, -0.05, 0.165); // กระดุม
      break;
    }
    case 3: // เอี๊ยมยีนส์: แผ่นอก + สายสะพาย + กระดุมทอง
      vox(torso, 0.36, 0.3, 0.02, 0x3a6ea5, 0, -0.13, 0.152);
      vox(torso, 0.53, 0.14, 0.31, 0x3a6ea5, 0, -0.22, 0);
      for (const side of [-1, 1]) {
        vox(torso, 0.06, 0.3, 0.02, 0x3a6ea5, side * 0.14, 0.14, 0.152);
        vox(torso, 0.06, 0.58, 0.02, 0x3a6ea5, side * 0.14, 0, -0.152);
        vox(torso, 0.05, 0.05, 0.02, GOLD, side * 0.14, 0.02, 0.166);
      }
      break;
    case 4: // ฮู้ด: ฮู้ดพับหลังคอ + กระเป๋าหน้าท้อง + เชือก
      vox(torso, 0.46, 0.18, 0.14, colors.torso, 0, 0.26, -0.2);
      vox(torso, 0.34, 0.15, 0.02, new THREE.Color(colors.torso).multiplyScalar(0.75).getHex(), 0, -0.13, 0.153);
      for (const side of [-1, 1]) vox(torso, 0.03, 0.14, 0.02, WHITE, side * 0.06, 0.18, 0.156);
      break;
    case 5: // เกราะ: แผ่นอกเหล็ก + เส้นทอง + บ่าเหล็ก
      vox(torso, 0.5, 0.42, 0.04, STEEL, 0, 0.06, 0.16);
      vox(torso, 0.05, 0.42, 0.045, GOLD, 0, 0.06, 0.165);
      vox(torso, 0.5, 0.36, 0.04, STEEL, 0, 0.08, -0.16);
      for (const arm of arms) vox(arm, 0.24, 0.12, 0.24, STEEL, 0, -0.02, 0);
      break;
    case 6: // สูท: เสื้อเชิ้ตขาวช่องกลาง + เนกไทแดง
      vox(torso, 0.15, 0.56, 0.015, WHITE, 0, 0.01, 0.152);
      vox(torso, 0.07, 0.07, 0.02, 0xe43b44, 0, 0.22, 0.162);
      vox(torso, 0.06, 0.32, 0.02, 0xe43b44, 0, 0.02, 0.162);
      break;
    default:
      vox(torso, 0.2, 0.05, 0.02, accent, 0, 0.2, 0.152); // เสื้อยืดมีลายเล็กๆ ที่อก
      break;
  }
}

// ---------- ของบนหลัง ----------
// คืนฟังก์ชันขยับ (dt, { clock, speed, air }) หรือ null ถ้าไม่ต้องขยับ
// speed = เทียบเดิน (วิ่ง ≈ 1.7) · air = null (ยืนพื้น) หรือ -1..1
function wings(torso, look, { feathers, tip, rest, flapHz, flapAmp }) {
  const pivots = [-1, 1].map((side) => {
    const pivot = group(torso, side * 0.07, 0.12, -0.17);
    feathers(pivot, side, tip);
    return { pivot, side };
  });
  return (dt, { clock, speed, air }) => {
    const flying = air !== null;
    const amp = flying ? flapAmp * 2.2 : flapAmp * (0.5 + Math.min(speed, 1.8) * 0.4);
    const hz = flying ? flapHz * 2.4 : flapHz;
    const open = rest + (flying ? 0.5 : 0) + Math.sin(clock * hz) * amp;
    for (const { pivot, side } of pivots) pivot.rotation.y = side * open;
  };
}

function angelFeathers(pivot, side, tip) {
  vox(pivot, 0.4, 0.14, 0.04, WHITE, side * 0.22, 0.08, 0);
  vox(pivot, 0.34, 0.12, 0.04, WHITE, side * 0.25, -0.04, -0.01);
  vox(pivot, 0.24, 0.1, 0.04, tip, side * 0.28, -0.14, -0.02);
  vox(pivot, 0.1, 0.06, 0.04, tip, side * 0.44, 0.15, 0);
}

function batFeathers(pivot, side) {
  vox(pivot, 0.46, 0.05, 0.04, 0x3e2731, side * 0.24, 0.12, 0); // กระดูกปีก
  vox(pivot, 0.42, 0.22, 0.02, 0x68386c, side * 0.24, 0.0, 0);
  for (const [x, w] of [[0.1, 0.1], [0.24, 0.1], [0.38, 0.08]]) vox(pivot, w, 0.08, 0.02, 0x68386c, side * x, -0.14, 0); // ขอบหยัก
}

function butterflyFeathers(pivot, side) {
  vox(pivot, 0.32, 0.3, 0.02, 0xf48fb1, side * 0.19, 0.1, 0);
  vox(pivot, 0.1, 0.1, 0.025, 0xfee761, side * 0.24, 0.14, 0);
  vox(pivot, 0.22, 0.2, 0.02, 0x2ce8f5, side * 0.14, -0.15, 0);
}

export function buildBack(torso, look) {
  const accent = ACCENTS[(look.body + look.back) % ACCENTS.length];
  switch (look.back) {
    case 1: { // ปลอกดาบสะพายเฉียง ด้ามโผล่ไหล่ขวา + สายคาดอก
      const g = group(torso, 0.02, 0.0, -0.2, 0, 0, 0.7);
      vox(g, 0.12, 0.66, 0.07, LEATHER, 0, 0, 0);
      vox(g, 0.13, 0.08, 0.08, GOLD, 0, -0.33, 0);
      vox(g, 0.26, 0.05, 0.09, GOLD, 0, 0.35, 0);
      vox(g, 0.06, 0.18, 0.06, 0x3e2731, 0, 0.46, 0);
      vox(g, 0.08, 0.06, 0.08, GOLD, 0, 0.57, 0);
      vox(group(torso, 0, 0, 0.155, 0, 0, -0.7), 0.06, 0.72, 0.02, LEATHER, 0, 0, 0);
      return null;
    }
    case 2: { // ธนู + กระบอกลูกธนู
      const quiver = group(torso, 0.12, 0.02, -0.23, 0, 0, -0.35);
      vox(quiver, 0.16, 0.44, 0.13, LEATHER, 0, 0, 0);
      vox(quiver, 0.17, 0.05, 0.14, GOLD, 0, 0.18, 0);
      [-0.04, 0.02, 0.06].forEach((x, i) => vox(quiver, 0.04, 0.13, 0.04, i === 1 ? 0xe43b44 : WHITE, x, 0.29, 0));
      const bow = group(torso, -0.06, 0.0, -0.18, 0, 0, 0.55);
      vox(bow, 0.05, 0.34, 0.05, 0x6b3f22, 0, 0, 0);
      vox(group(bow, 0, 0.17, 0, -0.45), 0.05, 0.3, 0.05, 0x6b3f22, 0, 0.14, 0);
      vox(group(bow, 0, -0.17, 0, 0.45), 0.05, 0.3, 0.05, 0x6b3f22, 0, -0.14, 0);
      vox(bow, 0.015, 0.84, 0.015, WHITE, 0, 0, -0.12);
      vox(group(torso, 0, 0, 0.155, 0, 0, 0.6), 0.05, 0.7, 0.02, LEATHER, 0, 0, 0);
      return null;
    }
    case 3:
      return wings(torso, look, { feathers: angelFeathers, tip: 0xc7d6ff, rest: 0.35, flapHz: 2.2, flapAmp: 0.12 });
    case 4:
      return wings(torso, look, { feathers: batFeathers, tip: 0, rest: 0.45, flapHz: 2.6, flapAmp: 0.1 });
    case 5: { // ผ้าคลุม: ห้อยจากบ่า ปลิวไปข้างหลังตามความเร็ว
      const pivot = group(torso, 0, 0.27, -0.165);
      vox(pivot, 0.52, 0.8, 0.03, accent, 0, -0.4, 0);
      vox(pivot, 0.52, 0.1, 0.035, new THREE.Color(accent).multiplyScalar(0.7).getHex(), 0, -0.76, 0);
      vox(torso, 0.56, 0.06, 0.33, GOLD, 0, 0.27, 0); // กลัดคอ
      return (dt, { clock, speed, air }) => {
        const flow = Math.min(speed, 1.8) * 0.32 + (air !== null ? 0.45 : 0);
        pivot.rotation.x = 0.06 + flow + Math.sin(clock * (4 + speed * 4)) * (0.02 + speed * 0.05);
      };
    }
    case 6: // กระเป๋าเป้ + สายสะพายหน้า
      vox(torso, 0.4, 0.42, 0.2, accent, 0, -0.02, -0.25);
      vox(torso, 0.42, 0.08, 0.22, new THREE.Color(accent).multiplyScalar(0.75).getHex(), 0, 0.2, -0.25);
      vox(torso, 0.28, 0.15, 0.05, new THREE.Color(accent).multiplyScalar(0.8).getHex(), 0, -0.12, -0.37);
      for (const side of [-1, 1]) vox(torso, 0.06, 0.52, 0.02, DARK, side * 0.14, 0.02, 0.153);
      return null;
    case 7: { // เจ็ตแพ็ก: ไฟพ่นตอนลอย / วิ่ง
      const flames = [];
      for (const side of [-1, 1]) {
        vox(torso, 0.14, 0.42, 0.14, STEEL, side * 0.1, 0.02, -0.24);
        vox(torso, 0.15, 0.06, 0.15, 0xe43b44, side * 0.1, 0.18, -0.24);
        vox(torso, 0.1, 0.08, 0.1, DARK, side * 0.1, -0.23, -0.24);
        flames.push(vox(torso, 0.08, 0.16, 0.08, 0xf77622, side * 0.1, -0.35, -0.24, true));
      }
      return (dt, { clock, speed, air }) => {
        const power = air !== null ? 1 : Math.max(0, (speed - 1.2) / 0.6);
        for (const [i, flame] of flames.entries()) {
          flame.visible = power > 0.05;
          flame.scale.set(1, power * (0.8 + Math.abs(Math.sin(clock * 30 + i)) * 0.6), 1);
          flame.position.y = -0.27 - 0.08 * flame.scale.y;
        }
      };
    }
    case 8:
      return wings(torso, look, { feathers: butterflyFeathers, tip: 0, rest: 0.3, flapHz: 3.4, flapAmp: 0.22 });
    default:
      return null;
  }
}
