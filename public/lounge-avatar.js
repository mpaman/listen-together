// ตัวละครหนึ่งตัว (voxel 8-bit): ประกอบจากกล่อง (หัว ตัว แขน ขา ผม หมวก) + หน้าวาดเป็นพิกเซล 8×8
// ไม่โหลดโมเดลจากไฟล์ → เล็ก เร็ว สุ่มหน้าตาได้ไม่จำกัด
// จำนวนตัวเลือกแต่ละส่วนต้องตรงกับ LOOK_PARTS ใน server/avatar.js
import * as THREE from 'three';
import { animateItem, buildItem } from './lounge-items.js';

export const LOOK_PARTS = { body: 10, skin: 6, hat: 7, face: 4 };
// จานสีแนวเกมเก่า (ENDESGA 32)
const BODY_COLORS = [0xe43b44, 0x0099db, 0x63c74d, 0xfeae34, 0xb55088, 0x2ce8f5, 0xf77622, 0x8b9bb4, 0x3e8948, 0x68386c];
const SKIN_COLORS = ['#f6c79e', '#e4a672', '#c28569', '#b86f50', '#733e39', '#ffe0c2'];
const HAIR_COLORS = [0x3e2731, 0x181425, 0x733e39, 0xbe4a2f, 0xfeae34, 0x262b44];
const HAT_COLORS = [0x262b44, 0xe43b44, 0x0099db, 0xfeae34, 0xb55088];
const PANTS = 0x3a4466;
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

// ท่าทางชั่วคราว: ชื่อท่า → ระยะเวลา (วินาที)
const GESTURE_SEC = { jump: 0.8, punch: 0.4, wave: 1.6, dance: 2.4, clap: 1.4, hit: 0.7, laugh: 1.4, love: 1.4, party: 1.6, cry: 1.6, angry: 1.4 };

const easeOut = (t) => 1 - (1 - t) ** 3;
const pulse = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))); // 0 → 1 → 0

export function createAvatar(look) {
  const root = new THREE.Group(); // ตำแหน่งบนพื้น + ทิศที่หัน
  const body = new THREE.Group(); // ส่วนที่เด้ง/เอียงตามท่า
  root.add(body);
  const parts = {};
  let faceKey = { kind: 0, skin: SKIN_COLORS[0] };
  let heldKind = null;

  function build(l) {
    body.clear();
    const shirt = mat(BODY_COLORS[l.body] ?? BODY_COLORS[0]);
    const skinHex = SKIN_COLORS[l.skin] ?? SKIN_COLORS[0];
    const skin = mat(skinHex);
    const pants = mat(PANTS);
    parts.legL = limb(body, 0.2, 0.45, 0.22, pants, -0.12, SEAT_HIP, mat(SHOES));
    parts.legR = limb(body, 0.2, 0.45, 0.22, pants, 0.12, SEAT_HIP, mat(SHOES));
    parts.torso = block(body, 0.52, 0.58, 0.3, shirt, 0, 0.74, 0);
    block(parts.torso, 0.53, 0.08, 0.31, mat(PANTS), 0, -0.25, 0); // เข็มขัด
    parts.armL = limb(body, 0.16, 0.5, 0.18, shirt, -0.36, 1.0, skin);
    parts.armR = limb(body, 0.16, 0.5, 0.18, shirt, 0.36, 1.0, skin);

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
  }

  // ของในมือขวา: ติดที่ปลายแขน · ของยาว (ดาบ/ไมค์) ชี้ไปข้างหน้า · ของแบน (โล่/กีตาร์) ถือตั้ง
  function setHeld(kind) {
    heldKind = kind ?? null;
    if (parts.held) parts.held.removeFromParent();
    parts.held = null;
    if (!heldKind) return;
    const item = buildItem(heldKind);
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

  function play(type) {
    if (GESTURE_SEC[type]) gesture = { type, t: 0 };
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
  function update(dt, { speed = 0, seated = false } = {}) {
    clock += dt;
    sitK += ((seated ? 1 : 0) - sitK) * (1 - Math.exp(-dt * 9));
    if (Math.abs(sitK - (seated ? 1 : 0)) < 0.002) sitK = seated ? 1 : 0;
    const stand = 1 - sitK;
    const move = Math.min(speed, 1.8);
    const idle = Math.max(0, 1 - move * 2.5) * stand; // นิ่งมาก = 1

    // ก้าวตามความเร็วจริง (เดินช้าก้าวถี่น้อย วิ่งถี่ขึ้น) · แกว่งแขนขากว้างขึ้นตอนวิ่ง
    walkPhase += dt * 10.5 * move;
    const sin = Math.sin(walkPhase);
    const swing = sin * (0.5 + Math.min(move, 1.8) * 0.28) * Math.min(move * 1.6, 1) * stand;

    body.position.set(0, Math.abs(sin) * 0.06 * move * stand, 0);
    body.rotation.set(0.07 * move * stand, -sin * 0.1 * Math.min(move, 1.2) * stand, 0); // โน้มตัว + บิดลำตัวสวนกับแขน
    body.scale.set(1, 1, 1);

    // หายใจ + หันหัวเบาๆ ตอนยืนนิ่ง (นั่งก็หายใจ แต่น้อยกว่า)
    const breathe = Math.sin(clock * 2.3);
    parts.torso.scale.set(1 + breathe * 0.012, 1 + breathe * 0.02, 1 + breathe * 0.012);
    parts.head.rotation.set(0, Math.sin(clock * 0.7) * 0.2 * idle + Math.sin(clock * 0.9) * 0.08 * sitK, Math.sin(clock * 0.5) * 0.03 * idle);

    parts.legL.rotation.set(swing * stand - (Math.PI / 2) * sitK, 0, 0);
    parts.legR.rotation.set(-swing * stand - (Math.PI / 2) * sitK, 0, 0);
    const sway = breathe * 0.025 * stand;
    // ถือของ: แขนขวายกนิดๆ ไม่แกว่งเต็มที่ (ดูเหมือนถือจริง)
    const holding = parts.held ? 1 : 0;
    parts.armL.rotation.set(-swing * 0.9 - 0.3 * sitK, 0, -0.08 - sway);
    parts.armR.rotation.set(swing * 0.9 * (1 - holding * 0.6) - 0.3 * sitK - holding * 0.35, 0, 0.08 + sway);
    if (parts.held) animateItem(parts.held, clock);

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

    if (!gesture) return;
    gesture.t += dt;
    const dur = GESTURE_SEC[gesture.type];
    const p = Math.min(gesture.t / dur, 1);
    const wave = (hz) => Math.sin(gesture.t * hz);
    switch (gesture.type) {
      case 'jump': {
        // ย่อตัวเตรียม (0–15%) → ลอย (15–85%) → ลงพื้นแล้วย่อรับแรง (85–100%)
        const crouch = p < 0.15 ? pulse(p / 0.15) : p > 0.85 ? pulse((p - 0.85) / 0.15) * 0.7 : 0;
        const air = p >= 0.15 && p <= 0.85 ? pulse((p - 0.15) / 0.7) : 0;
        body.position.y += easeOut(air) * 0.85 - crouch * 0.1;
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
    if (p >= 1) gesture = null;
  }

  return {
    root,
    update,
    play,
    setLook: build,
    setHeld,
    held: () => heldKind,
    isBusy: () => gesture !== null,
    sitAmount: () => sitK,
  };
}
