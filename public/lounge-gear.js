// ชุดแต่งของตัวละครโมเดล (KayKit): หมวก + ของบนหลัง ปั้นจากรูปทรงโค้ง (ทรงกลม/กรวย/วงแหวน/แคปซูล/เส้นโค้งอัดหนา)
// เหตุผล (Man 11-28 "ไม่ให้เหลี่ยม"): ของกล่องจากตัวเก่าดูแปลกบนโมเดลที่ผิวเนียน · ไม่โหลดไฟล์เพิ่ม · ใส่ท่าขยับได้เหมือนเดิม
// ลำดับตัวเลขตรงกับของเดิม (look.hat 1..6 · look.back 1..8) → คนในห้องที่ยังใช้ตัวกล่องเห็นชิ้นเดียวกันแบบเหลี่ยม
// พิกัดเป็นหน่วยของโมเดลก่อนย่อ (วัดจากโมเดลจริง 11-28):
//   หัว (นับจากกระดูก head): ยอดหัว y ~0.93 · กลางหัว y ~0.43 · รัศมี x ~0.55 z ~0.5
//   ลำตัว (นับจากกระดูก chest): หลัง z ~-0.33 · ไหล่ y ~0.2 · เอว y ~-0.55 · กว้าง x ±0.43
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const GOLD = 0xfeae34;
const LEATHER = 0x8f563b;
const DARK = 0x262b44;
const STEEL = 0xc0cbdc;
const WHITE = 0xffffff;
const ACCENTS = [0xe43b44, 0x0099db, 0xfeae34, 0x63c74d, 0xb55088, 0x2ce8f5, 0xf77622];

const HEAD_TOP = 0.93;
const HEAD_MID = 0.43;
const BACK_Z = -0.34;
// ปีกขยายจากขนาดที่ปั้น: หัวโมเดลใหญ่ ปีกขนาดเท่าลำตัวถูกหัวบังจนแทบไม่เห็น (ดูใน Chrome 11-28)
const WING_SCALE = 1.4;

const lam = (color, side = THREE.FrontSide) => new THREE.MeshLambertMaterial({ color, side });
// วางชิ้นส่วน: เงาตก + ไม่ cull (ชิ้นที่ติดกระดูกขยับตามท่า กล่องขอบไม่ตาม)
function put(parent, geometry, material, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = [], scale = null) {
  const mesh = new THREE.Mesh(geometry, typeof material === 'number' ? lam(material) : material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}
function group(parent, [x = 0, y = 0, z = 0] = [], [rx = 0, ry = 0, rz = 0] = []) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  parent.add(g);
  return g;
}
const dome = (r) => new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); // ครึ่งลูกบน
const ball = (r) => new THREE.SphereGeometry(r, 14, 10);
const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();
// แผ่นบางจากเส้นโค้ง (ขนนก/ปีก) · bevel เล็กๆ ให้ขอบมน ไม่เป็นแผ่นกระดาษ
const slab = (shape, depth = 0.02, bevel = 0.012) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });

// ---------- หมวก (ลูกของกระดูก head) ----------
export function buildGearHat(kind, color) {
  const g = new THREE.Group();
  switch (kind) {
    case 1: { // หมวกไหมพรม: โดมครอบหัว + ขอบพับหนา + ปอมปอม
      put(g, dome(0.6), color, [0, 0.52, 0], [], [1, 0.9, 0.95]);
      put(g, new THREE.TorusGeometry(0.58, 0.1, 10, 32), shade(color, 0.8), [0, 0.54, 0], [Math.PI / 2, 0, 0], [1, 0.93, 1]);
      put(g, ball(0.15), WHITE, [0, 1.1, 0]);
      break;
    }
    case 2: { // หมวกแก๊ป: โดม + ปีกหมวกครึ่งวงยื่นไปข้างหน้า + กระดุมบนยอด
      put(g, dome(0.6), color, [0, 0.5, 0], [], [1, 0.82, 0.96]);
      // ทรงกระบอก theta -π/2..π/2 = ครึ่งหน้า (+z) → ปีกหมวก
      const brim = new THREE.CylinderGeometry(0.46, 0.46, 0.05, 24, 1, false, -Math.PI / 2, Math.PI);
      put(g, brim, shade(color, 0.85), [0, 0.52, 0.32], [0.12, 0, 0]);
      put(g, ball(0.07), shade(color, 0.7), [0, 0.99, 0]);
      break;
    }
    case 3: { // หมวกปาร์ตี้: กรวย + แถบลาย 2 วง + ปอมปอม (เอียงนิดๆ)
      const cone = group(g, [0.05, HEAD_TOP - 0.05, 0], [0, 0, -0.18]);
      put(cone, new THREE.ConeGeometry(0.3, 0.8, 24), color, [0, 0.4, 0]);
      for (const [y, r] of [[0.16, 0.25], [0.42, 0.16]]) put(cone, new THREE.TorusGeometry(r, 0.03, 6, 24), 0xfee761, [0, y, 0], [Math.PI / 2, 0, 0]);
      put(cone, ball(0.1), 0xfee761, [0, 0.82, 0]);
      break;
    }
    case 4: { // หูแมว: ที่คาดผมโค้งตามหัว + หูกรวยมน + ในหูสีชมพู
      put(g, new THREE.TorusGeometry(0.57, 0.035, 8, 32, Math.PI), color, [0, HEAD_MID, 0.05], [], [1, 0.93, 1]);
      for (const side of [-1, 1]) {
        const ear = group(g, [side * 0.33, 0.82, 0.04], [0, 0, -side * 0.35]);
        put(ear, new THREE.ConeGeometry(0.18, 0.36, 16), color, [0, 0.14, 0], [], [1, 1, 0.55]);
        put(ear, new THREE.ConeGeometry(0.1, 0.22, 12), 0xf48fb1, [0, 0.1, 0.05], [], [1, 1, 0.4]);
      }
      break;
    }
    case 5: { // หูฟัง: คาดโค้งเหนือหัว + ครอบหูกลม + ฟองน้ำ
      put(g, new THREE.TorusGeometry(0.62, 0.055, 10, 32, Math.PI), DARK, [0, HEAD_MID, 0], [], [1, 0.95, 1]);
      for (const side of [-1, 1]) {
        put(g, new THREE.CylinderGeometry(0.2, 0.2, 0.14, 24), color, [side * 0.62, HEAD_MID, 0], [0, 0, Math.PI / 2]);
        put(g, new THREE.TorusGeometry(0.15, 0.05, 8, 20), DARK, [side * 0.56, HEAD_MID, 0], [0, Math.PI / 2, 0]);
        put(g, new THREE.CylinderGeometry(0.11, 0.11, 0.02, 16), shade(color, 0.7), [side * 0.7, HEAD_MID, 0], [0, 0, Math.PI / 2]);
      }
      break;
    }
    case 6: { // มงกุฎ: วงทองเปิดหัว + ยอดแหลม 6 อัน + พลอยบนยอด + ทับทิมหน้า
      const crown = group(g, [0, HEAD_TOP - 0.06, 0]);
      put(crown, new THREE.CylinderGeometry(0.4, 0.36, 0.2, 28, 1, true), lam(GOLD, THREE.DoubleSide));
      put(crown, new THREE.TorusGeometry(0.37, 0.03, 6, 28), GOLD, [0, -0.1, 0], [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.sin(a) * 0.39;
        const z = Math.cos(a) * 0.39;
        put(crown, new THREE.ConeGeometry(0.07, 0.2, 10), GOLD, [x, 0.19, z]);
        put(crown, ball(0.04), i % 2 ? 0x2ce8f5 : WHITE, [x, 0.3, z]);
      }
      put(crown, ball(0.07), 0xe43b44, [0, 0, 0.4], [], [1, 1, 0.6]);
      break;
    }
    default:
      break;
  }
  return g;
}

// ---------- ขนนก/ปีก (เส้นโค้ง) ----------
function featherShape(len, width) { // ใบขนนกปลายมน
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width, len * 0.45, width * 0.25, len);
  s.quadraticCurveTo(-width * 0.6, len * 0.6, 0, 0);
  return s;
}
function batShape() { // ปีกพังผืด: ขอบบนเป็นกระดูกตรง ขอบล่างหยักโค้ง 3 ช่วง
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.35, 0.42);
  s.lineTo(0.95, 0.5);
  s.quadraticCurveTo(0.8, 0.2, 0.86, -0.05);
  s.quadraticCurveTo(0.65, 0.05, 0.58, -0.22);
  s.quadraticCurveTo(0.4, -0.05, 0.28, -0.3);
  s.quadraticCurveTo(0.15, -0.08, 0, 0);
  return s;
}
function lobeShape(w, h, tilt) { // ปีกผีเสื้อ 1 กลีบ (วงรีเบี้ยว)
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(w * 0.2, h * tilt, w, h, w * 0.9, h * 0.35);
  s.bezierCurveTo(w * 0.85, -h * 0.1, w * 0.4, -h * 0.05, 0, 0);
  return s;
}

// ปีกสองข้าง: แต่ละข้างมี pivot ที่ไหล่ หมุนรอบแกน y = กระพือ (ข้างซ้ายสะท้อนด้วย scale.x = -1)
function wings(parent, build, { rest, hz, amp }) {
  const pivots = [-1, 1].map((side) => {
    const pivot = group(parent, [side * 0.1, 0.18, BACK_Z - 0.04]);
    const inner = group(pivot);
    inner.scale.set(side * WING_SCALE, WING_SCALE, WING_SCALE); // ข้างซ้ายใช้รูปเดียวกันกลับด้าน
    build(inner);
    return { pivot, side };
  });
  return (dt, { clock, speed, air }) => {
    const boost = air !== null ? 1.8 : 1 + Math.min(speed, 1.8) * 0.3;
    const flap = Math.sin(clock * hz * boost) * amp * boost;
    for (const { pivot, side } of pivots) pivot.rotation.y = side * (rest + flap); // มุมบวก = ปลายปีกไปทางหลัง (-z)
  };
}

// ---------- ของบนหลัง (ลูกของกระดูก chest) · คืน { group, anim } ----------
export function buildGearBack(kind, accentIndex = 0) {
  const g = new THREE.Group();
  const accent = ACCENTS[accentIndex % ACCENTS.length];
  let anim = null;
  switch (kind) {
    case 1: { // ปลอกดาบสะพายเฉียง ด้ามโผล่ไหล่ขวา + สายคาดอก
      const sheath = group(g, [0, -0.08, BACK_Z - 0.08], [0, 0, 0.65]);
      put(sheath, new THREE.CylinderGeometry(0.075, 0.095, 0.95, 14), LEATHER, [], [], [1, 1, 0.6]);
      put(sheath, ball(0.09), GOLD, [0, -0.48, 0], [], [1, 1, 0.65]);
      put(sheath, new THREE.TorusGeometry(0.095, 0.025, 6, 16), GOLD, [0, 0.46, 0], [Math.PI / 2, 0, 0], [1, 0.65, 1]);
      put(sheath, new THREE.CapsuleGeometry(0.035, 0.32, 4, 10), GOLD, [0, 0.5, 0], [0, 0, Math.PI / 2]);
      put(sheath, new THREE.CylinderGeometry(0.04, 0.045, 0.26, 10), 0x3e2731, [0, 0.66, 0]);
      put(sheath, ball(0.065), GOLD, [0, 0.81, 0]);
      const strap = group(g, [0, -0.1, -0.02], [0, 0, -0.65]);
      put(strap, new THREE.TorusGeometry(0.5, 0.03, 6, 36), LEATHER, [], [Math.PI / 2, 0, 0], [0.95, 0.78, 1]);
      break;
    }
    case 2: { // ธนู + กระบอกลูกธนู
      const quiver = group(g, [0.2, -0.05, BACK_Z - 0.1], [0, 0, -0.35]);
      put(quiver, new THREE.CylinderGeometry(0.13, 0.11, 0.62, 16), LEATHER);
      put(quiver, new THREE.TorusGeometry(0.13, 0.025, 6, 18), GOLD, [0, 0.31, 0], [Math.PI / 2, 0, 0]);
      [-0.05, 0.02, 0.07].forEach((x, i) => {
        put(quiver, new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6), 0x6b3f22, [x, 0.42, (i - 1) * 0.04]);
        put(quiver, new THREE.ConeGeometry(0.04, 0.12, 4), i === 1 ? 0xe43b44 : WHITE, [x, 0.56, (i - 1) * 0.04], [], [1, 1, 0.3]);
      });
      // คันธนู: ส่วนโค้งของวงแหวน (ปลายสองข้างอยู่ที่มุม ±1.1 rad) + สายตรงระหว่างปลาย
      const bow = group(g, [-0.12, -0.02, BACK_Z - 0.05], [0, 0, 0.5]);
      put(bow, new THREE.TorusGeometry(0.5, 0.03, 8, 28, 2.2), 0x6b3f22, [-0.3, 0, 0], [0, 0, -1.1]);
      put(bow, new THREE.CylinderGeometry(0.008, 0.008, 0.89, 4), WHITE, [-0.3 + 0.5 * Math.cos(1.1), 0, 0]);
      const strap = group(g, [0, -0.1, -0.02], [0, 0, 0.6]);
      put(strap, new THREE.TorusGeometry(0.5, 0.025, 6, 36), LEATHER, [], [Math.PI / 2, 0, 0], [0.95, 0.78, 1]);
      break;
    }
    case 3: { // ปีกนางฟ้า: ขนนก 2 ชั้น พัดออกด้านข้าง ปลายฟ้าอ่อน
      const white = lam(WHITE, THREE.DoubleSide);
      const tipC = lam(0xc7d6ff, THREE.DoubleSide);
      anim = wings(g, (side) => {
        for (let i = 0; i < 5; i += 1) {
          const len = 0.95 - i * 0.12;
          put(side, slab(featherShape(len, 0.16)), i < 2 ? tipC : white, [0.02 * i, -0.02 * i, -0.01 * i], [0, 0, -(0.35 + i * 0.27)]);
        }
        for (let i = 0; i < 4; i += 1) { // ขนชั้นในสั้นกว่า คลุมโคนปีก
          put(side, slab(featherShape(0.45, 0.14)), white, [0.02, 0.04, 0.03], [0, 0, -(0.5 + i * 0.3)]);
        }
      }, { rest: 0.35, hz: 2.2, amp: 0.12 });
      break;
    }
    case 4: { // ปีกค้างคาว: พังผืดขอบหยัก + กระดูกปีกตามขอบบน
      const skin = lam(0x3b1f4a, THREE.DoubleSide);
      const bone = lam(0x1d1029);
      anim = wings(g, (side) => {
        put(side, slab(batShape(), 0.012, 0.006), skin);
        put(side, new THREE.CylinderGeometry(0.025, 0.02, 0.56, 6), bone, [0.18, 0.21, 0.01], [0, 0, -0.69]);
        put(side, new THREE.CylinderGeometry(0.02, 0.012, 0.6, 6), bone, [0.65, 0.46, 0.01], [0, 0, -1.44]);
        put(side, ball(0.035), bone, [0.35, 0.42, 0.01]);
      }, { rest: 0.45, hz: 2.6, amp: 0.1 });
      break;
    }
    case 5: { // ผ้าคลุม: ผืนโค้งตามหลัง (ส่วนของทรงกระบอก) ห้อยจากบ่า + ขอบคอทองโค้งหลังคอ · ปลิวตามความเร็ว
      const pivot = group(g, [0, 0.2, 0]);
      // theta รอบ π = ฝั่ง -z (ด้านหลัง) · กว้าง 2 rad · บนแคบล่างบานเหมือนผ้าตก
      const cloth = new THREE.CylinderGeometry(0.46, 0.62, 1.05, 18, 6, true, Math.PI - 1, 2);
      put(pivot, cloth, lam(accent, THREE.DoubleSide), [0, -0.53, 0.05]);
      put(pivot, new THREE.CylinderGeometry(0.62, 0.63, 0.06, 18, 1, true, Math.PI - 1, 2), lam(shade(accent, 0.7), THREE.DoubleSide), [0, -1.06, 0.05]);
      put(g, new THREE.TorusGeometry(0.42, 0.04, 8, 28, Math.PI), GOLD, [0, 0.2, 0.02], [Math.PI / 2, 0, Math.PI], [1, 0.85, 1]);
      for (const side of [-1, 1]) put(g, ball(0.07), GOLD, [side * 0.42, 0.2, 0.02]); // กลัดสองข้างบ่า (ปลายวงโค้ง)
      anim = (dt, { clock, speed, air }) => {
        const flow = Math.min(speed, 1.8) * 0.3 + (air !== null ? 0.4 : 0);
        pivot.rotation.x = (0.04 + flow + Math.sin(clock * (3 + speed * 4)) * (0.02 + speed * 0.04));
      };
      break;
    }
    case 6: { // กระเป๋าเป้มุมมน + ฝาพับ + กระเป๋าหน้า + สายสะพาย
      const dark = shade(accent, 0.75);
      put(g, new RoundedBoxGeometry(0.62, 0.66, 0.32, 4, 0.1), accent, [0, -0.15, BACK_Z - 0.17]);
      put(g, new RoundedBoxGeometry(0.64, 0.24, 0.35, 4, 0.08), dark, [0, 0.12, BACK_Z - 0.17]);
      put(g, new RoundedBoxGeometry(0.4, 0.22, 0.1, 3, 0.05), dark, [0, -0.3, BACK_Z - 0.35]);
      put(g, ball(0.035), GOLD, [0, 0.03, BACK_Z - 0.35]);
      for (const side of [-1, 1]) {
        put(g, new THREE.TorusGeometry(0.3, 0.03, 6, 24), 0x3a3a4a, [side * 0.2, -0.05, -0.02], [0, Math.PI / 2, 0], [1.25, 1.1, 1]);
      }
      break;
    }
    case 7: { // เจ็ตแพ็ก: ถังแคปซูล 2 อัน + หัวฉีด + ไฟเรืองแสงตอนลอย/วิ่ง
      put(g, new RoundedBoxGeometry(0.3, 0.5, 0.16, 3, 0.05), DARK, [0, -0.12, BACK_Z - 0.06]);
      const flames = [];
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xf77622, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
      for (const side of [-1, 1]) {
        const x = side * 0.19;
        put(g, new THREE.CapsuleGeometry(0.13, 0.36, 6, 16), STEEL, [x, -0.1, BACK_Z - 0.17]);
        put(g, new THREE.TorusGeometry(0.135, 0.025, 6, 18), 0xe43b44, [x, 0.08, BACK_Z - 0.17], [Math.PI / 2, 0, 0]);
        put(g, new THREE.ConeGeometry(0.1, 0.14, 14, 1, true), lam(DARK, THREE.DoubleSide), [x, -0.42, BACK_Z - 0.17]);
        const flame = put(g, new THREE.ConeGeometry(0.08, 0.3, 12), flameMat, [x, -0.6, BACK_Z - 0.17], [Math.PI, 0, 0]);
        flame.castShadow = false;
        flames.push(flame);
      }
      anim = (dt, { clock, speed, air }) => {
        const power = air !== null ? 1 : Math.max(0, (speed - 1.2) / 0.6);
        flames.forEach((flame, i) => {
          flame.visible = power > 0.05;
          const k = power * (0.8 + Math.abs(Math.sin(clock * 30 + i)) * 0.5);
          flame.scale.set(1, k, 1);
          flame.position.y = -0.49 - 0.15 * k;
        });
      };
      break;
    }
    case 8: { // ปีกผีเสื้อ: กลีบบนใหญ่ + กลีบล่างเล็ก สีสด + จุดสีอ่อนกลางปีก
      const main = lam(accent, THREE.DoubleSide);
      const spot = lam(new THREE.Color(accent).lerp(new THREE.Color(WHITE), 0.6).getHex(), THREE.DoubleSide);
      anim = wings(g, (side) => {
        put(side, slab(lobeShape(0.75, 0.7, 0.9), 0.01, 0.006), main, [0, 0.02, 0]);
        put(side, slab(lobeShape(0.5, -0.5, 0.9), 0.01, 0.006), main, [0, -0.02, 0]);
        put(side, new THREE.CircleGeometry(0.1, 16), spot, [0.45, 0.35, 0.025]);
        put(side, new THREE.CircleGeometry(0.06, 12), spot, [0.3, -0.22, 0.025]);
      }, { rest: 0.3, hz: 3.4, amp: 0.22 });
      break;
    }
    default:
      break;
  }
  return { group: g, anim };
}
