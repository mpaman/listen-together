// ตัวละครหนึ่งตัว (voxel 8-bit): ประกอบจากกล่อง (หัว ตัว แขน ขา ผม หมวก) + หน้าวาดเป็นพิกเซล 8×8
// ไม่โหลดโมเดลจากไฟล์ → เล็ก เร็ว สุ่มหน้าตาได้ไม่จำกัด
// จำนวนตัวเลือกแต่ละส่วนต้องตรงกับ LOOK_PARTS ใน server/avatar.js
import * as THREE from 'three';
import { animateItem, buildItem } from './lounge-items.js';
import { buildBack, decorateOutfit, outfitColors } from './lounge-outfit.js';

// back = ของบนหลัง · outfit = ลายชุด (รายละเอียดอยู่ใน lounge-outfit.js)
// cls = คลาสตัวละครโมเดล 3D (lounge-model.js CLASSES) · ส่วนอื่นใช้กับตัวกล่องที่โชว์ระหว่างโหลดโมเดล
export const LOOK_PARTS = { body: 11, skin: 6, hat: 8, face: 4, back: 9, outfit: 11, cls: 5 };
// จานสีแนวเกมเก่า (ENDESGA 32)
export const BODY_COLORS = [0xe43b44, 0x0099db, 0x63c74d, 0xfeae34, 0xb55088, 0x2ce8f5, 0xf77622, 0x8b9bb4, 0x3e8948, 0x68386c];
export const SKIN_COLORS = ['#f6c79e', '#e4a672', '#c28569', '#b86f50', '#733e39', '#ffe0c2'];
const HAIR_COLORS = [0x3e2731, 0x181425, 0x733e39, 0xbe4a2f, 0xfeae34, 0x262b44];
export const HAT_COLORS = [0x262b44, 0xe43b44, 0x0099db, 0xfeae34, 0xb55088];
const SHOES = 0x181425;

export const SEAT_HIP = 0.45; // ความสูงสะโพกตอนยืน (ใช้คำนวณตอนนั่ง)
export const HEAD_TOP = 2.15; // ระดับป้ายชื่อ (เหนือหมวก)

export function randomLook() {
  return Object.fromEntries(Object.entries(LOOK_PARTS).map(([key, n]) => [key, Math.floor(Math.random() * n)]));
}

// ---------- ชิ้นส่วน ----------
const geoCache = new Map();
const box = (w, h, d) => {
  const key = `${w}:${h}:${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
};
const mat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

function block(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(box(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

// แขน/ขา = จุดหมุน (pivot) ที่ไหล่/สะโพก แล้วห้อยกล่องลงมา → หมุน pivot = แกว่งทั้งแขน
function limb(parent, w, h, d, material, x, y, tip) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  block(pivot, w, h, d, material, 0, -h / 2, 0);
  if (tip) block(pivot, w + 0.02, 0.1, d + 0.04, tip, 0, -h + 0.04, 0.02); // รองเท้า/มือ
  parent.add(pivot);
  return pivot;
}

// ---------- หน้า: วาดพิกเซล 8×8 ลง canvas แล้วใช้เป็น texture ด้านหน้าของหัว ----------
// . = ผิว · e = ตา · m = ปาก · b = แก้มแดง · g = แว่น · w = ขาวในตา
const FACES = [
  ['........', '........', '........', '.ee..ee.', '.ee..ee.', '........', '...mm...', '........'], // ปกติ
  ['........', '........', '........', '.ee..ee.', '.ee..ee.', 'b......b', '..m..m..', '...mm...'], // ยิ้มแก้มแดง
  ['........', '........', '........', '........', '.ee..ee.', 'b......b', '...mm...', '........'], // ตาหยี
  ['........', '........', 'gggggggg', 'gwegweg.', 'gggggggg', '........', '...mm...', '........'], // แว่น
];
const BLINK_ROW = '........';
const PIXEL = { e: '#181425', m: '#3e2731', b: '#f48fb1', g: '#262b44', w: '#ffffff' };
const faceCache = new Map();

function faceTexture(kind, skin, blink) {
  const key = `${kind}:${skin}:${blink}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, 8, 8);
  (FACES[kind] ?? FACES[0]).forEach((row, y) => {
    // กะพริบ: แถวตาเหลือเส้นเดียว (แถวล่างของตา)
    const isEyeRow = /e/.test(row) && kind !== 3;
    const nextHasEye = /e/.test((FACES[kind] ?? FACES[0])[y + 1] ?? '');
    const line = blink && isEyeRow && nextHasEye ? BLINK_ROW : row;
    [...line].forEach((c, x) => {
      if (!PIXEL[c]) return;
      ctx.fillStyle = PIXEL[c];
      ctx.fillRect(x, y, 1, 1);
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  faceCache.set(key, texture);
  return texture;
}

// ---------- หมวก (ติดกับหัว: ด้านบนของหัวอยู่ที่ y = 0.28) ----------
function buildHat(head, kind, color) {
  const m = mat(color);
  switch (kind) {
    case 1: // หมวกไหมพรม + ปอมปอม
      block(head, 0.6, 0.2, 0.6, m, 0, 0.36, 0);
      block(head, 0.14, 0.14, 0.14, mat(0xffffff), 0, 0.52, 0);
      break;
    case 2: // แก๊ปมีปีก
      block(head, 0.6, 0.16, 0.6, m, 0, 0.34, 0);
      block(head, 0.5, 0.05, 0.28, m, 0, 0.28, 0.4);
      break;
    case 3: // หมวกปาร์ตี้ (บล็อกซ้อนเป็นกรวย)
      block(head, 0.3, 0.14, 0.3, m, 0, 0.36, 0);
      block(head, 0.2, 0.14, 0.2, mat(0xfee761), 0, 0.5, 0);
      block(head, 0.1, 0.14, 0.1, m, 0, 0.64, 0);
      break;
    case 4: // หูแมว
      for (const side of [-1, 1]) {
        block(head, 0.16, 0.16, 0.08, m, side * 0.18, 0.36, 0);
        block(head, 0.08, 0.08, 0.09, mat(0xf48fb1), side * 0.18, 0.34, 0.01);
      }
      break;
    case 5: // หูฟัง
      block(head, 0.66, 0.08, 0.12, m, 0, 0.33, 0);
      for (const side of [-1, 1]) block(head, 0.1, 0.24, 0.24, mat(0x181425), side * 0.33, 0.02, 0);
      break;
    case 6: { // มงกุฎ
      const gold = mat(0xfeae34);
      block(head, 0.5, 0.1, 0.5, gold, 0, 0.33, 0);
      for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0.2]]) block(head, 0.08, 0.12, 0.08, gold, x, 0.44, z);
      block(head, 0.08, 0.08, 0.06, mat(0xe43b44), 0, 0.33, 0.26);
      break;
    }
    default:
      break;
  }
}

// ---------- มงกุฎผู้ชนะ (ลอยเหนือหัว เหนือหมวกทุกแบบ) ----------
// ชนะมาก มงกุฎยิ่งหรู: ทองแดง → เงิน → ทอง → ทองเพชร (min = จำนวนชนะขั้นต่ำ)
export const CROWN_TIERS = [
  { min: 10, name: 'ทองเพชร', color: 0xfeae34, gem: 0x2ce8f5, gems: 3, tall: 0.2 },
  { min: 5, name: 'ทอง', color: 0xfeae34, gem: 0xe43b44, gems: 1, tall: 0.16 },
  { min: 3, name: 'เงิน', color: 0xc0cbdc, gem: 0x0099db, gems: 1, tall: 0.13 },
  { min: 1, name: 'ทองแดง', color: 0xb86f50, gem: null, gems: 0, tall: 0.1 },
];
export const crownTier = (wins) => CROWN_TIERS.find((t) => wins >= t.min) ?? null;
const CROWN_Y = 0.85; // เหนือหัว (หมวกสูงสุดถึง ~0.71)
export function buildCrown(tier) {
  const g = new THREE.Group();
  const gold = mat(tier.color);
  block(g, 0.46, 0.1, 0.46, gold, 0, 0, 0);
  const spikes = [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19], [0, 0.19], [0, -0.19], [0.19, 0], [-0.19, 0]];
  for (const [x, z] of spikes) block(g, 0.08, tier.tall, 0.08, gold, x, 0.05 + tier.tall / 2, z);
  if (tier.gem) {
    const gem = new THREE.MeshBasicMaterial({ color: tier.gem }); // ไม่มีแสง → อัญมณีสว่างเสมอ
    const faces = [[0, 0.24], [0, -0.24], [0.24, 0], [-0.24, 0]].slice(0, tier.gems === 1 ? 1 : 4);
    for (const [x, z] of faces) block(g, 0.08, 0.07, 0.08, gem, x, 0, z);
    if (tier.gems >= 3) block(g, 0.1, 0.1, 0.1, gem, 0, 0.05 + tier.tall + 0.05, 0); // ยอดบนสุด
  }
  return g;
}

// ท่าทางชั่วคราว: ชื่อท่า → ระยะเวลา (วินาที)
const GESTURE_SEC = { jump: 0.8, punch: 0.4, wave: 1.6, dance: 2.4, clap: 1.4, hit: 0.7, laugh: 1.4, love: 1.4, party: 1.6, cry: 1.6, angry: 1.4 };
// ท่าอาวุธในลานประลอง: ความยาวท่าตั้งตาม windup ของอาวุธ (play(type, sec)) ค่านี้เป็นค่าเริ่มต้น
// ท่าแบ่งเป็น ง้าง (ช่วง windup) → ปล่อย → คืนท่า · ตัวเลข hit = สัดส่วนเวลาที่ "โดนจริง" ในท่า
Object.assign(GESTURE_SEC, { jab: 0.3, slash: 0.45, stab: 0.5, slam: 1, shoot: 0.6, cast: 0.75, flinch: 0.3 });
// ท่าหลบในลาน: กลิ้ง (แดชปิดไว้ แต่เก็บท่าไว้เผื่อเปิดกลับ)
Object.assign(GESTURE_SEC, { roll: 0.48, dash: 0.25 });
// ดื่มยา (ยาวตาม POTION.ms ที่ส่งมา) · ท่าปิดเกมของผู้ชนะ · ล้มน็อกของผู้แพ้ (ค้างท่าจนปิดลาน)
Object.assign(GESTURE_SEC, { drink: 1.6, finisher: 1.5, ko: 0.9 });
// ท่าที่ค่อยๆ ผสมเข้า/ออกจากท่าเดิน (ไม่งั้นแขนวาร์ปจากท่าเดินไปท่าตีในเฟรมเดียว ดูแข็ง)
// ท่าหมุนรอบตัว (เต้น) ไม่ผสม เพราะผสมตอนจบจะหมุนย้อนกลับ
const BLEND_IN = new Set(['jab', 'slash', 'stab', 'slam', 'shoot', 'cast', 'punch', 'flinch', 'wave', 'clap', 'drink']);
const BLEND_IN_SEC = 0.07;
const BLEND_OUT_SEC = 0.14;
const ease = (t) => t * t * (3 - 2 * t); // smoothstep: ออกตัวช้า เร่ง แล้วค่อยหยุด

const pulse = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))); // 0 → 1 → 0

// ขวดยาเติมเลือดแบบ voxel (ขวดแก้วใส น้ำยาเขียว จุกไม้) · ติดที่ปลายแขนซ้ายตอนดื่ม
const BOTTLE_GLASS = new THREE.MeshLambertMaterial({ color: 0xc0e8f0, transparent: true, opacity: 0.55 });
const BOTTLE_LIQUID = new THREE.MeshLambertMaterial({ color: 0x4ade80, emissive: 0x14532d });
const BOTTLE_CORK = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
export function buildBottle() {
  const g = new THREE.Group();
  const part = (w, h, d, mat, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = y;
    g.add(m);
  };
  part(0.14, 0.16, 0.14, BOTTLE_GLASS, 0);
  part(0.11, 0.12, 0.11, BOTTLE_LIQUID, -0.015);
  part(0.06, 0.07, 0.06, BOTTLE_GLASS, 0.11);
  part(0.07, 0.04, 0.07, BOTTLE_CORK, 0.16);
  g.position.set(0, -0.5, 0.08);
  g.rotation.x = Math.PI; // ปากขวดชี้ลงตามแขน → ยกแขนขึ้นแล้วปากขวดหันเข้าปาก
  return g;
}

export function createAvatar(look) {
  const root = new THREE.Group(); // ตำแหน่งบนพื้น + ทิศที่หัน
  const body = new THREE.Group(); // ส่วนที่เด้ง/เอียงตามท่า
  root.add(body);
  const parts = {};
  let faceKey = { kind: 0, skin: SKIN_COLORS[0] };
  let heldKind = null;
  let crownWins = 0; // จำนวนชนะ → มงกุฎ (สร้างใหม่ทุกครั้งที่ build เปลี่ยนหัว)
  let crownT = 0;

  function build(raw) {
    body.clear();
    const l = { back: 0, outfit: 0, ...raw }; // look จาก client รุ่นเก่าไม่มีสองส่วนนี้
    const shirtHex = BODY_COLORS[l.body] ?? BODY_COLORS[0];
    const colors = outfitColors(l, shirtHex);
    const skinHex = SKIN_COLORS[l.skin] ?? SKIN_COLORS[0];
    const skin = mat(skinHex);
    const pants = mat(colors.pants);
    const sleeve = mat(colors.sleeve);
    parts.legL = limb(body, 0.2, 0.45, 0.22, pants, -0.12, SEAT_HIP, mat(SHOES));
    parts.legR = limb(body, 0.2, 0.45, 0.22, pants, 0.12, SEAT_HIP, mat(SHOES));
    parts.torso = block(body, 0.52, 0.58, 0.3, mat(colors.torso), 0, 0.74, 0);
    block(parts.torso, 0.53, 0.08, 0.31, pants, 0, -0.25, 0); // เข็มขัด
    parts.armL = limb(body, 0.16, 0.5, 0.18, sleeve, -0.36, 1.0, skin);
    parts.armR = limb(body, 0.16, 0.5, 0.18, sleeve, 0.36, 1.0, skin);
    decorateOutfit(parts.torso, [parts.armL, parts.armR], l, colors);
    parts.backAnim = buildBack(parts.torso, l);

    // หัว: ด้านหน้า (+z) เป็นหน้าพิกเซล ด้านอื่นเป็นสีผิว
    faceKey = { kind: l.face, skin: skinHex };
    parts.faceMat = new THREE.MeshLambertMaterial({ map: faceTexture(l.face, skinHex, false) });
    parts.head = new THREE.Mesh(box(0.56, 0.56, 0.56), [skin, skin, skin, skin, parts.faceMat, skin]);
    parts.head.position.set(0, 1.33, 0);
    parts.head.castShadow = true;
    body.add(parts.head);
    const hair = mat(HAIR_COLORS[(l.body + l.skin) % HAIR_COLORS.length]);
    block(parts.head, 0.6, 0.1, 0.6, hair, 0, 0.3, 0); // ผมด้านบน
    block(parts.head, 0.6, 0.34, 0.08, hair, 0, 0.12, -0.28); // ผมด้านหลัง
    buildHat(parts.head, l.hat, HAT_COLORS[(l.body + l.hat) % HAT_COLORS.length]);
    setHeld(heldKind); // แขนถูกสร้างใหม่ → ใส่ของกลับเข้ามือ
    setCrown(crownWins); // หัวถูกสร้างใหม่ → ใส่มงกุฎกลับ
  }

  function setCrown(wins) {
    crownWins = Math.max(0, Math.floor(wins) || 0);
    if (parts.crown) parts.crown.removeFromParent();
    parts.crown = null;
    const tier = crownTier(crownWins);
    if (!tier || !parts.head) return;
    parts.crown = buildCrown(tier);
    parts.crown.position.y = CROWN_Y;
    parts.head.add(parts.crown);
  }

  // ของในมือขวา: ติดที่ปลายแขน · ของยาว (ดาบ/ไมค์) ชี้ไปข้างหน้า · ของแบน (โล่/กีตาร์) ถือตั้ง
  function setHeld(kind) {
    heldKind = kind ?? null;
    if (parts.held) parts.held.removeFromParent();
    if (parts.heldL) parts.heldL.removeFromParent();
    parts.held = null;
    parts.heldL = null;
    if (!heldKind) return;
    const item = buildItem(heldKind);
    if (item.userData.dual) { // มีดคู่: อีกเล่มอยู่มือซ้าย
      const left = buildItem(heldKind);
      left.position.set(0, -0.47, 0.06);
      left.rotation.set(Math.PI / 2, 0, 0);
      parts.armL.add(left);
      parts.heldL = left;
    }
    if (item.userData.upright) {
      item.position.set(0.14, -0.42, 0.05);
      item.rotation.set(0, Math.PI / 2, 0);
    } else {
      item.position.set(0, -0.47, 0.06);
      item.rotation.set(Math.PI / 2, 0, 0);
    }
    parts.armR.add(item);
    parts.held = item;
  }

  build(look);

  let gesture = null; // { type, t }
  let walkPhase = 0;
  let clock = Math.random() * 10; // เวลาของท่านิ่ง (หายใจ/หันหัว) · สุ่มเริ่มให้แต่ละตัวไม่ขยับพร้อมกัน
  let sitK = 0; // 0 = ยืน · 1 = นั่งเต็มที่ (ค่อยๆ เปลี่ยน ไม่วาร์ป)
  let blinkIn = 1 + Math.random() * 3; // อีกกี่วินาทีจะกะพริบ
  let blinkT = -1; // >=0 = กำลังกะพริบ
  let squash = 0; // ย่อรับแรงตอนลงพื้น 0..1 แล้วค่อยๆ คืน
  let airK = 0; // 0 = ยืนพื้น · 1 = ลอยเต็มที่ (ไล่ค่าให้ท่าไม่วูบ)
  let airV = 0; // +1 พุ่งขึ้น · -1 ร่วงลง (เฉลี่ยแล้ว)
  let headLag = 0; // หัวเด้งตามตัวช้ากว่านิดนึง (secondary motion)
  let guardOn = false; // ยกการ์ด (ในลานประลอง) · ค้างไว้จนสั่งลด ไม่ใช่ท่าชั่วคราว
  let guardK = 0;

  function land(strength) {
    squash = Math.max(squash, 0.35 + strength * 0.65);
  }

  // ขวดยาในมือซ้าย: โผล่เฉพาะตอนดื่ม (สร้างครั้งแรกที่ใช้ · มีดคู่มือซ้ายซ่อนไว้ก่อนระหว่างดื่ม)
  let bottle = null;
  function setBottle(on) {
    if (on && !bottle) bottle = buildBottle();
    if (bottle) {
      if (on) parts.armL.add(bottle);
      else bottle.removeFromParent();
    }
    if (parts.heldL) parts.heldL.visible = !on;
  }

  // sec = ความยาวท่า · hitAt = วินาทีที่อาวุธโดนจริง (ท่าง้างยาวเท่านี้แล้วค่อยปล่อย)
  // hold = เล่นจบแล้วค้างท่าสุดท้ายไว้ (ล้มน็อก) จนกว่าจะเล่นท่าอื่นหรือเรียก stop()
  function play(type, { sec, hitAt, hold = false } = {}) {
    if (!GESTURE_SEC[type]) return;
    const dur = sec ?? GESTURE_SEC[type];
    gesture = { type, t: 0, dur, hold, hit: hitAt !== undefined ? Math.min(0.85, hitAt / dur) : 0.35 };
    setBottle(type === 'drink');
  }
  function stop() {
    gesture = null;
    setBottle(false);
  }

  // โดนตี: ตัวกะพริบขาวแป๊บนึง (เฉพาะตัว ไม่รวมของในมือ เพราะวัสดุของในมือใช้ร่วมกันทุกตัว)
  let flashT = 0;
  const flashMats = () => {
    const list = [];
    const inHeld = (o) => {
      for (let n = o; n; n = n.parent) if (n === parts.held || n === parts.heldL) return true;
      return false;
    };
    body.traverse((o) => {
      if (!o.isMesh || inHeld(o)) return;
      for (const m of [o.material].flat()) if (m.emissive) list.push(m);
    });
    return list;
  };
  function flash() {
    flashT = 0.12;
    for (const m of flashMats()) m.emissive.setHex(0xffffff);
  }
  function tickFlash(dt) {
    if (flashT <= 0) return;
    flashT -= dt;
    if (flashT <= 0) for (const m of flashMats()) m.emissive.setHex(0x000000);
  }

  // ยกการ์ด: แขนซ้ายยกโล่/แขนบังหน้า แขนขวาถืออาวุธขวางตัว · ค่อยๆ ยก/ลด (ไม่วาร์ป)
  function applyGuard(dt) {
    guardK += ((guardOn ? 1 : 0) - guardK) * (1 - Math.exp(-dt * 16));
    const g = guardK;
    if (g < 0.01) return;
    const mix = (a, b) => a + (b - a) * g;
    parts.armL.rotation.set(mix(parts.armL.rotation.x, -1.25), 0, mix(parts.armL.rotation.z, 0.55));
    parts.armR.rotation.set(mix(parts.armR.rotation.x, -1), 0, mix(parts.armR.rotation.z, -0.45));
    body.rotation.x += 0.08 * g; // ย่อตัวตั้งรับ
  }
  // ท่าค้าง: ค่อยๆ เข้าท่า/ออกท่า (ไม่วาร์ป) · จำท่าล่าสุดไว้ตอนกำลังออกท่า
  let restKind = null;
  let restK = 0;
  function applyRest(dt, rest) {
    const want = rest === 'lie' || rest === 'hello';
    if (want) restKind = rest;
    restK += ((want ? 1 : 0) - restK) * (1 - Math.exp(-dt * 8));
    if (!want && restK < 0.01) restKind = null;
    if (!restKind) return;
    const k = restK;
    const mix = (a, b) => a + (b - a) * k;
    if (restKind === 'lie') { // นอนหงาย เอามือหนุนหัว
      body.rotation.x = mix(body.rotation.x, -Math.PI / 2);
      body.position.y += 0.16 * k;
      parts.legL.rotation.x = mix(parts.legL.rotation.x, 0);
      parts.legR.rotation.x = mix(parts.legR.rotation.x, 0);
      parts.armL.rotation.set(mix(parts.armL.rotation.x, -2.8), 0, mix(parts.armL.rotation.z, -0.45));
      parts.armR.rotation.set(mix(parts.armR.rotation.x, -2.8), 0, mix(parts.armR.rotation.z, 0.45));
      parts.head.rotation.x = mix(parts.head.rotation.x, 0.2);
    } else { // โบกมือทักทายค้างไว้: ยกแขนขวาเหนือหัวแล้วโบกไปมา
      parts.armR.rotation.set(mix(parts.armR.rotation.x, 0), 0, mix(parts.armR.rotation.z, 2.6 + Math.sin(clock * 9) * 0.35));
    }
  }

  function setGuard(on) {
    guardOn = Boolean(on);
  }

  function setBlink(closed) {
    const map = faceTexture(faceKey.kind, faceKey.skin, closed);
    if (parts.faceMat.map !== map) {
      parts.faceMat.map = map;
      parts.faceMat.needsUpdate = true;
    }
  }

  // speed = ความเร็วเทียบกับเดินปกติ (1 = เดิน, ~1.7 = วิ่ง) · seated = นั่งอยู่ไหม
  // ทุกเฟรมคืนท่าเริ่มต้นก่อน แล้วค่อยใส่ท่า
  // groove = ตำแหน่งในจังหวะเพลง 0..1 (ทุกคนในฟลอร์ใช้ค่าเดียวกันจากนาฬิกาเครื่อง → โยกพร้อมกัน) · null = ไม่โยก
  // air = null (ยืนพื้น) หรือ -1..1 (ลอย: + พุ่งขึ้น / − ร่วงลง) · lean = -1..1 เลี้ยวซ้าย(+)/ขวา(−) → เอียงเข้าโค้ง
  // rest = ท่าค้าง 'lie' (นอนหงาย) / 'hello' (โบกมือทักทาย) · 'sit' นั่งพื้นมากับ seated แล้ว
  function update(dt, { speed = 0, seated = false, groove = null, air = null, lean = 0, rest = null } = {}) {
    if (parts.crown) { // มงกุฎหมุนช้าๆ ลอยขึ้นลงนิดๆ ให้รู้ว่าเป็นของพิเศษ
      crownT += dt;
      parts.crown.rotation.y = crownT * 0.9;
      parts.crown.position.y = CROWN_Y + Math.sin(crownT * 2.4) * 0.03;
    }
    clock += dt;
    sitK += ((seated ? 1 : 0) - sitK) * (1 - Math.exp(-dt * 9));
    if (Math.abs(sitK - (seated ? 1 : 0)) < 0.002) sitK = seated ? 1 : 0;
    airK += ((air === null ? 0 : 1) - airK) * (1 - Math.exp(-dt * 18));
    if (air !== null) airV += (air - airV) * (1 - Math.exp(-dt * 10));
    squash *= Math.exp(-dt * 7);
    const stand = 1 - sitK;
    const ground = 1 - airK; // ท่าเดินจางลงตอนลอย
    const move = Math.min(speed, 1.8);
    const run = Math.max(0, Math.min(1, (move - 1) / 0.6)); // 0 = เดิน · 1 = วิ่งเต็มที่
    const idle = Math.max(0, 1 - move * 2.5) * stand * ground; // นิ่งมาก = 1

    // ก้าวตามความเร็วจริง (เดินช้าก้าวถี่น้อย วิ่งถี่ขึ้น) · แกว่งแขนขากว้างขึ้นตอนวิ่ง
    walkPhase += dt * (10.5 + run * 2) * move;
    const sin = Math.sin(walkPhase);
    const step = Math.min(move * 1.6, 1) * stand * ground;
    const swing = sin * (0.5 + move * 0.28 + run * 0.15) * step;
    // ตัวเด้ง 2 ครั้งต่อรอบก้าว · วิ่งเด้งสูงกว่า (มีช่วงลอยสั้นๆ) · ลดลงไปตอนเท้าแตะพื้น
    const bob = Math.abs(sin) ** (1 + run) * (0.06 + run * 0.06) * move * stand * ground;
    headLag += (bob - headLag) * (1 - Math.exp(-dt * 14));

    body.position.set(sin * 0.025 * step, bob - squash * 0.12, 0); // สะโพกถ่ายน้ำหนักซ้ายขวา
    body.rotation.set(
      (0.07 * move + run * 0.14) * stand * ground, // โน้มตัวไปหน้า วิ่งยิ่งโน้ม
      -sin * (0.1 + run * 0.06) * Math.min(move, 1.2) * stand * ground, // บิดลำตัวสวนกับแขน
      sin * 0.035 * step - lean * 0.22 * Math.min(1, move) * stand, // ถ่ายน้ำหนัก + เอียงเข้าโค้ง
    );
    body.scale.set(1 + squash * 0.1, 1 - squash * 0.16, 1 + squash * 0.1);

    // หายใจ + หันหัวเบาๆ ตอนยืนนิ่ง (นั่งก็หายใจ แต่น้อยกว่า) · หัวเด้งตามตัวช้ากว่านิด + ก้มเงยสวนแรงโน้ม
    const breathe = Math.sin(clock * 2.3) * (1 + run * 1.5);
    parts.torso.scale.set(1 + breathe * 0.012, 1 + breathe * 0.02, 1 + breathe * 0.012);
    parts.head.position.y = 1.33 + (headLag - bob) * 0.6;
    parts.head.rotation.set(
      -run * 0.1 * stand + squash * 0.15,
      Math.sin(clock * 0.7) * 0.2 * idle + Math.sin(clock * 0.9) * 0.08 * sitK,
      Math.sin(clock * 0.5) * 0.03 * idle + lean * 0.1 * stand,
    );

    // ท่าลอย: พุ่งขึ้น = พับขาข้างนึง แขนเหวี่ยงขึ้น · ร่วงลง = ขายืดลงเตรียมรับพื้น แขนกางทรงตัว
    const up = (airV + 1) / 2;
    const flap = Math.sin(clock * 18) * 0.12 * (1 - up);
    const airLegL = -0.9 * up - 0.25 * (1 - up);
    const airLegR = -0.35 * up + 0.15 * (1 - up);
    const airArmX = -1.1 * up - 0.3 * (1 - up);
    const airArmZ = 0.35 * up + (1.2 + flap) * (1 - up);

    const legBend = squash * 0.55; // ลงพื้น = ย่อเข่า (ขาทั้งท่อนพับไปหน้า)
    parts.legL.rotation.set((swing - legBend) * stand - (Math.PI / 2) * sitK + airLegL * airK * stand, 0, 0);
    parts.legR.rotation.set((-swing - legBend) * stand - (Math.PI / 2) * sitK + airLegR * airK * stand, 0, 0);
    const sway = breathe * 0.025 * stand;
    // ถือของ: แขนขวายกนิดๆ ไม่แกว่งเต็มที่ (ดูเหมือนถือจริง) · วิ่ง = แขนยกไปหน้านิดๆ แบบเหวี่ยงแขนวิ่ง
    const holding = parts.held ? 1 : 0;
    const pump = -run * 0.35 * step;
    parts.armL.rotation.set(-swing * 0.95 + pump - 0.3 * sitK + airArmX * airK, 0, -0.08 - sway - airArmZ * airK - squash * 0.3);
    parts.armR.rotation.set(swing * 0.95 * (1 - holding * 0.6) + pump - 0.3 * sitK - holding * 0.35 + airArmX * airK * (1 - holding * 0.5), 0, 0.08 + sway + airArmZ * airK + squash * 0.3);
    if (parts.held) animateItem(parts.held, clock);
    parts.backAnim?.(dt, { clock, speed: move, air }); // ปีกกระพือ / ผ้าคลุมปลิว / ไฟเจ็ตแพ็ก
    applyGuard(dt);
    applyRest(dt, rest);

    // กะพริบตา
    blinkIn -= dt;
    if (blinkIn <= 0 && blinkT < 0) blinkT = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      setBlink(blinkT < 0.12);
      if (blinkT >= 0.12) {
        blinkT = -1;
        blinkIn = 2 + Math.random() * 4;
      }
    }

    // โยกบนฟลอร์: ย่อเข่าลงตามบีต + ไหล่เอียงสลับซ้ายขวาทุก 2 บีต + แขนแกว่ง · กดท่าอื่นเมื่อไหร่ ท่านั้นทับ
    if (groove !== null && !gesture && idle > 0.5) {
      const bounce = Math.abs(Math.sin(groove * Math.PI));
      const side = Math.sin(groove * Math.PI); // บวก/ลบสลับทุกบีต (groove นับต่อเนื่องเกิน 1 ได้)
      body.position.y += bounce * 0.09 * idle;
      body.rotation.z = side * 0.09 * idle;
      body.rotation.y += side * 0.18 * idle;
      parts.legL.rotation.x = parts.legR.rotation.x = -bounce * 0.18 * idle;
      parts.armL.rotation.set(-0.5 - bounce * 0.4, 0, -0.25 - side * 0.15);
      parts.armR.rotation.set(-0.5 - bounce * 0.4, 0, 0.25 - side * 0.15);
      parts.head.rotation.x = bounce * 0.12;
    }

    tickFlash(dt);
    if (!gesture) return;
    gesture.t += dt;
    const dur = gesture.dur ?? GESTURE_SEC[gesture.type];
    const p = Math.min(gesture.t / dur, 1);
    const wave = (hz) => Math.sin(gesture.t * hz);
    // ท่าเดิน/ยืนของเฟรมนี้ (คำนวณไว้ข้างบนแล้ว) → ไว้ผสมกับท่าตีตอนเริ่มและตอนจบท่า
    const blend = BLEND_IN.has(gesture.type);
    const base = blend ? posed().map((v) => [v.x, v.y, v.z]) : null;
    // ง้าง (wind 0→1) จนถึงจังหวะโดน → ปล่อย: ท่าง้างคลายออก (pre 1→0) พร้อมกับท่าฟัน (strike) พุ่งขึ้นเร็วแล้วค่อยคืน
    // ทั้งสามค่าต่อเนื่องกันตลอด ไม่มีเฟรมไหนกระโดด → ดูมีน้ำหนัก ไม่แข็ง
    const hp = gesture.hit ?? 0.35;
    const rel = p <= hp ? 0 : (p - hp) / (1 - hp);
    const wind = ease(Math.min(1, p / hp));
    // ปล่อยท่าช้าลงกว่าเดิม (เดิม rel*4 / rel*5 → ดาบกระตุก 1 rad ในเฟรมเดียว ดูวาร์ป)
    const pre = p <= hp ? wind : 1 - ease(Math.min(1, rel * 2.6));
    const strike = p <= hp ? 0 : ease(Math.min(1, rel * 3)) * (1 - ease(Math.min(1, Math.max(0, rel - 0.35) / 0.6)));
    // โน้มตัวไปข้างหน้าตอนฟัน: ขยับแค่ "ตัวในโมเดล" ตัวจริงไม่เลื่อน (Man ขอ 11-28: ไม่พุ่งไปหาเป้า จะได้หลบต่อได้)
    const lunge = (back, fwd) => {
      body.position.z += -back * pre + fwd * strike;
      body.rotation.x += -0.4 * back * pre + 0.6 * fwd * strike;
    };
    switch (gesture.type) {
      case 'jab': // ต่อย/มีด/กระแทกโล่: ดึงแขนกลับ บิดไหล่ แล้วยื่นสุดแขนตรงไปข้างหน้า
        parts.armR.rotation.set(0.45 * pre - 1.62 * strike, 0, 0.1 * pre);
        parts.armL.rotation.set(-0.7 * pre + 0.35 * strike, 0, -0.15);
        body.rotation.y = 0.3 * pre - 0.4 * strike;
        lunge(0.06, 0.2);
        break;
      case 'slash': // ดาบ: ง้างขึ้นเฉียงด้านขวาเหนือไหล่ → ฟันเฉียงตัดผ่านหน้าตัวไปซ้ายล่าง (ไม่ฟันลงไปหลังสะโพกแบบเดิม)
        parts.armR.rotation.set(-2.3 * pre - 1.25 * strike, 0, 0.75 * pre - 0.85 * strike);
        parts.armL.rotation.set(-0.3 * pre, 0, -0.25 - 0.25 * strike);
        body.rotation.y = 0.5 * pre - 0.55 * strike;
        lunge(0.05, 0.22);
        break;
      case 'stab': // หอก: ดึงด้ามกลับ แล้วแทงสุดแขนตรงไปข้างหน้า
        parts.armR.rotation.set(-1.45 - 0.1 * strike, 0, 0);
        parts.armL.rotation.set(-1.3, 0, 0.3);
        if (parts.held) parts.held.position.y = -0.47 + 0.35 * pre - 0.55 * strike;
        body.rotation.y = 0.2 * pre - 0.15 * strike;
        lunge(0.12, 0.32);
        if (p >= 1 && parts.held) parts.held.position.y = -0.47;
        break;
      case 'slam': { // ค้อน: สองมือยกสูง ตัวแอ่นไปหลัง → ทุบพื้นเต็มแรง
        const up = pre;
        const down = p <= hp ? 0 : ease(Math.min(1, rel * 4)) * (1 - ease(Math.max(0, rel - 0.6) / 0.4));
        parts.armR.rotation.set(-3 * up - 1.2 * down, 0, 0.1);
        parts.armL.rotation.set(-3 * up - 1.2 * down, 0, -0.1);
        body.rotation.x = -0.25 * up + 0.4 * down;
        body.position.y -= 0.12 * down;
        break;
      }
      case 'shoot': { // ธนู: ยกคันธนูขึ้นเล็ง ง้างสายค่อยๆ ตึง → ปล่อย มือดึงสะบัดไปหลัง ตัวเด้งถอยนิดๆ
        const aim = Math.max(wind, p <= hp ? 0 : 1 - ease(Math.max(0, rel - 0.5) / 0.5));
        parts.armR.rotation.set(-1.55 * aim, 0, 0);
        parts.armL.rotation.set(-1.45 * aim + 0.25 * strike, 0, -0.15 - 0.55 * pre - 0.6 * strike);
        body.rotation.y = 0.35 * aim;
        body.rotation.x += -0.1 * strike;
        body.position.z += -0.06 * strike;
        break;
      }
      case 'cast': // คทา: ชูคทาขึ้นรวมพลัง แล้วพุ่งชี้ไปข้างหน้า มือซ้ายผลักตาม
        parts.armR.rotation.set(-2.7 * pre - 1.5 * strike, 0, 0.15 * pre);
        parts.armL.rotation.set(-0.4 * pre - 1.3 * strike, 0, -0.4 + 0.2 * strike);
        body.position.y += 0.06 * pre;
        lunge(0.08, 0.2);
        break;
      case 'roll': { // กลิ้ง: ม้วนตัวรอบสะโพก 1 รอบ (ตัวจริงเลื่อนไปข้างหน้าจาก lounge.js)
        const a = Math.PI * 2 * (0.5 - 0.5 * Math.cos(Math.PI * p));
        const c = 0.6; // หมุนรอบจุดสูงจากพื้นเท่านี้ ไม่ใช่รอบเท้า (หัวจะได้ไม่มุดพื้น)
        const tuck = pulse(p);
        body.rotation.x = a;
        body.position.y += c - c * Math.cos(a) - 0.25 * tuck;
        body.position.z += -c * Math.sin(a);
        body.scale.setScalar(1 - 0.15 * tuck);
        parts.legL.rotation.x = parts.legR.rotation.x = -1.6 * tuck;
        parts.armL.rotation.set(-1.8 * tuck, 0, 0.2);
        parts.armR.rotation.set(-1.8 * tuck, 0, -0.2);
        break;
      }
      case 'dash': { // แดช: โน้มตัวพุ่ง แขนเหวี่ยงไปหลัง
        const k = pulse(p);
        body.rotation.x = 0.45 * k;
        parts.armL.rotation.set(0.9 * k, 0, -0.2);
        parts.armR.rotation.set(0.9 * k, 0, 0.2);
        parts.legL.rotation.x = -0.6 * k;
        parts.legR.rotation.x = 0.5 * k;
        break;
      }
      case 'drink': { // ดื่มยา: ยกขวดมือซ้ายขึ้นปาก เงยหน้า อึกๆ แล้วลดแขนลง (ขาเดินต่อได้ ช้าลง)
        const k = ease(Math.min(1, p / 0.2)) * (1 - ease(Math.max(0, (p - 0.85) / 0.15)));
        parts.armL.rotation.set(-2.5 * k, 0, 0.55 * k);
        parts.head.rotation.x = -0.35 * k + 0.05 * Math.sin(gesture.t * 14) * k;
        body.rotation.x += -0.08 * k;
        break;
      }
      case 'finisher': { // ท่าปิดเกม: ย่อ → กระโดดหมุนตัว ยกอาวุธเหนือหัว → ทุบลงเต็มแรง → ค่อยๆ ยืดตัว
        const s = Math.min(1, Math.max(0, (p - 0.2) / 0.45));
        const air = p >= 0.2 && p <= 0.65 ? Math.sin(Math.PI * s) : 0;
        const crouch = p < 0.2 ? pulse(p / 0.2) : p > 0.65 ? 1 - ease(Math.min(1, (p - 0.65) / 0.35)) : 0;
        const raise = ease(Math.min(1, Math.max(0, (p - 0.1) / 0.3)));
        const smash = ease(Math.min(1, Math.max(0, (p - 0.58) / 0.1)));
        const recover = ease(Math.max(0, (p - 0.85) / 0.15));
        const armX = (-3 * raise * (1 - smash) - 1.3 * smash) * (1 - recover);
        parts.armR.rotation.set(armX, 0, 0.1);
        parts.armL.rotation.set(armX, 0, -0.1);
        body.position.y += 0.9 * air - 0.18 * crouch;
        body.rotation.y += Math.PI * 2 * ease(s);
        body.rotation.x = 0.45 * smash * (1 - recover) - 0.15 * air;
        parts.legL.rotation.x = parts.legR.rotation.x = -0.8 * air - 0.4 * crouch;
        break;
      }
      case 'ko': { // ล้มน็อก: เซไปหลัง ล้มหงายนอนราบ แขนกาง (ค้างไว้ · hold)
        const k = ease(Math.min(1, p / 0.75));
        const bounce = p > 0.75 ? Math.sin(Math.PI * Math.min(1, (p - 0.75) / 0.25)) * 0.06 : 0;
        body.rotation.x = -1.45 * k;
        body.position.y += 0.15 * k + bounce;
        parts.armL.rotation.set(-0.3 * k, 0, -1.2 * k);
        parts.armR.rotation.set(-0.3 * k, 0, 1.2 * k);
        parts.head.rotation.x = 0.2 * k;
        parts.legL.rotation.x = parts.legR.rotation.x = 0;
        break;
      }
      case 'flinch': // โดนตี: สะดุ้งไปหลัง
        body.rotation.x = -0.35 * Math.sin(Math.PI * p);
        parts.head.rotation.x = -0.3 * Math.sin(Math.PI * p);
        break;
      case 'jump': {
        // ท่าทางตอนกระโดด: ตัวลอยจริงมาจากฟิสิกส์ใน lounge.js (root ทั้งตัวขยับ) ตรงนี้แค่พับขา/กางแขน
        // ย่อตัวเตรียม (0–15%) → ลอย (15–85%) → ลงพื้นแล้วย่อรับแรง (85–100%)
        const crouch = p < 0.15 ? pulse(p / 0.15) : p > 0.85 ? pulse((p - 0.85) / 0.15) * 0.7 : 0;
        const air = p >= 0.15 && p <= 0.85 ? pulse((p - 0.15) / 0.7) : 0;
        body.position.y -= crouch * 0.1;
        body.scale.y = 1 - crouch * 0.06 + air * 0.04;
        parts.legL.rotation.x = parts.legR.rotation.x = -0.55 * crouch - 0.35 * air;
        parts.armL.rotation.set(0.7 * crouch - 0.5 * air, 0, -0.9 * air);
        parts.armR.rotation.set(0.7 * crouch - 0.5 * air, 0, 0.9 * air);
        break;
      }
      case 'punch': {
        // ถือดาบ = ฟันจากบนลงล่าง · มือเปล่า = ต่อยตรง
        const k = Math.sin(Math.PI * p);
        if (heldKind === 'sword') parts.armR.rotation.set(-3 + p * 3.4, 0, 0.2);
        else parts.armR.rotation.set((-Math.PI / 2) * Math.min(1, k * 1.6), 0, 0);
        body.rotation.y = -0.4 * k;
        body.position.z = 0.15 * k;
        break;
      }
      case 'wave':
        parts.armR.rotation.set(0, 0, 2.6 + wave(14) * 0.35);
        break;
      case 'dance':
        body.position.y += Math.abs(wave(10)) * 0.12;
        body.rotation.y = p * Math.PI * 2;
        parts.armL.rotation.set(0, 0, -2.2 + wave(10) * 0.5);
        parts.armR.rotation.set(0, 0, 2.2 + wave(10) * 0.5);
        break;
      case 'clap': {
        const c = Math.abs(wave(14));
        parts.armL.rotation.set(-1.3, 0, -0.5 + c * 0.6);
        parts.armR.rotation.set(-1.3, 0, 0.5 - c * 0.6);
        break;
      }
      case 'hit':
        body.rotation.x = -0.6 * Math.sin(Math.PI * p);
        body.rotation.y = p * Math.PI * 2;
        break;
      case 'laugh':
        body.rotation.x = -0.15;
        body.position.y += Math.abs(wave(20)) * 0.06;
        break;
      case 'cry':
        parts.head.rotation.x = 0.35;
        parts.armL.rotation.set(-2.2, 0, 0.3);
        parts.armR.rotation.set(-2.2, 0, -0.3);
        break;
      case 'angry':
        body.rotation.z = wave(30) * 0.06;
        parts.armL.rotation.z = -0.5;
        parts.armR.rotation.z = 0.5;
        break;
      default: // love / party: เด้งดีใจ
        body.position.y += Math.abs(wave(9)) * 0.25;
        parts.armL.rotation.z = -2.4;
        parts.armR.rotation.z = 2.4;
        break;
    }
    // ผสมท่า: ต้นท่าค่อยๆ ยกจากท่าเดิน · ท้ายท่าค่อยๆ คืนท่าเดิน (ขาที่ท่าตีไม่ได้แตะ = เดินต่อเหมือนเดิม)
    if (base) {
      const w = ease(Math.min(1, gesture.t / BLEND_IN_SEC, Math.max(0, dur - gesture.t) / BLEND_OUT_SEC));
      if (w < 1) {
        posed().forEach((v, i) => {
          const [x, y, z] = base[i];
          v.set(x + (v.x - x) * w, y + (v.y - y) * w, z + (v.z - z) * w);
        });
      }
    }
    if (p >= 1) {
      if (gesture.hold) gesture.t = dur; // ค้างท่าสุดท้าย
      else stop();
    }
  }
  // ส่วนของตัวที่ท่าต่างๆ ขยับ (ไว้จำ/ผสมท่า)
  const posed = () => [parts.armL.rotation, parts.armR.rotation, parts.head.rotation, body.rotation, body.position];

  return {
    root,
    update,
    play,
    stop,
    setLook: build,
    setHeld,
    setGuard,
    setCrown,
    held: () => heldKind,
    isBusy: () => gesture !== null,
    gesture: () => gesture?.type ?? null, // ท่าที่เล่นอยู่ (ไว้กันท่าสะดุ้งทับท่าตี)
    sitAmount: () => sitK,
    land,
    flash,
  };
}
