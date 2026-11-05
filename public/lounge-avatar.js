// ตัวละครหนึ่งตัว: ประกอบจากรูปทรงพื้นฐาน (ตัว หัว แขน ขา หมวก) + เล่นท่าทาง
// ไม่โหลดโมเดลจากไฟล์ → เล็ก เร็ว สุ่มหน้าตาได้ไม่จำกัด
// จำนวนตัวเลือกแต่ละส่วนต้องตรงกับ LOOK_PARTS ใน server/avatar.js
import * as THREE from 'three';

export const LOOK_PARTS = { body: 10, skin: 6, hat: 7, face: 4 };
const BODY_COLORS = [0xf2a541, 0x5fd4a6, 0xf07a6a, 0xb6a8f7, 0x6cb4ee, 0xf5d76e, 0xe58fc4, 0x8bd17c, 0xf4ede4, 0x4a4a5a];
const SKIN_COLORS = [0xffe0c2, 0xf6c79e, 0xdba27a, 0xb57a52, 0x8a5636, 0xfff1e6];
const HAT_COLORS = [0x2e292a, 0xf07a6a, 0x6cb4ee, 0xf2a541, 0xb6a8f7];

export const SEAT_HIP = 0.45; // ความสูงสะโพกตอนยืน (ใช้คำนวณตอนนั่ง)
export const HEAD_TOP = 1.95;

export function randomLook() {
  return Object.fromEntries(Object.entries(LOOK_PARTS).map(([key, n]) => [key, Math.floor(Math.random() * n)]));
}

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// แขน/ขา = จุดหมุน (pivot) ที่ไหล่/สะโพก แล้วห้อยชิ้นส่วนลงมา → หมุน pivot = แกว่งทั้งแขน
function limb(radius, length, material, x, y) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  pivot.add(mesh(new THREE.CapsuleGeometry(radius, length, 4, 8), material, 0, -length / 2 - radius * 0.5, 0));
  return pivot;
}

function buildHat(kind, color) {
  const g = new THREE.Group();
  const m = mat(color);
  switch (kind) {
    case 1: { // หมวกไหมพรม + ปอมปอม
      g.add(mesh(new THREE.SphereGeometry(0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.05, 0));
      g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(0xf4ede4), 0, 0.42, 0));
      break;
    }
    case 2: { // แก๊ปมีปีก
      g.add(mesh(new THREE.SphereGeometry(0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), m, 0, 0.06, 0));
      const brim = mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 16, 1, false, -Math.PI / 2, Math.PI), m, 0, 0.1, 0.18);
      brim.scale.z = 1.4;
      g.add(brim);
      break;
    }
    case 3: { // หมวกปาร์ตี้
      g.add(mesh(new THREE.ConeGeometry(0.18, 0.5, 14), m, 0.06, 0.45, 0));
      g.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(0xf5d76e), 0.06, 0.72, 0));
      g.rotation.z = -0.25;
      break;
    }
    case 4: { // หูแมว
      for (const side of [-1, 1]) {
        const ear = mesh(new THREE.ConeGeometry(0.11, 0.24, 4), m, side * 0.2, 0.32, 0);
        ear.rotation.z = -side * 0.35;
        g.add(ear);
      }
      break;
    }
    case 5: { // หูฟัง
      const band = mesh(new THREE.TorusGeometry(0.36, 0.035, 8, 20, Math.PI), m, 0, 0, 0);
      g.add(band);
      for (const side of [-1, 1]) {
        const cup = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14), mat(0x2e292a), side * 0.35, -0.02, 0);
        cup.rotation.z = Math.PI / 2;
        g.add(cup);
      }
      break;
    }
    case 6: { // มงกุฎ
      const gold = mat(0xf5c542, { emissive: 0x3a2a00 });
      g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 12, 1, true), gold, 0, 0.3, 0));
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.05, 0.14, 4), gold, Math.sin(a) * 0.2, 0.42, Math.cos(a) * 0.2));
      }
      break;
    }
    default:
      break;
  }
  return g;
}

function buildFace(kind, head) {
  const dark = mat(0x1d191a);
  const eyes = []; // เก็บไว้ให้กะพริบตา
  for (const side of [-1, 1]) {
    const eye = kind === 2
      ? mesh(new THREE.BoxGeometry(0.1, 0.025, 0.02), dark, side * 0.12, 0.03, 0.31) // ตาหยี
      : mesh(new THREE.SphereGeometry(0.045, 8, 6), dark, side * 0.12, 0.03, 0.3);
    head.add(eye);
    eyes.push(eye);
  }
  if (kind === 1 || kind === 2) {
    for (const side of [-1, 1]) {
      const blush = mesh(new THREE.CircleGeometry(0.05, 10), mat(0xf28b9b, { transparent: true, opacity: 0.7 }), side * 0.2, -0.06, 0.29);
      blush.rotation.y = side * 0.5;
      head.add(blush);
    }
  }
  if (kind === 3) { // แว่น
    for (const side of [-1, 1]) head.add(mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 14), dark, side * 0.12, 0.03, 0.31));
  }
  const mouth = mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10, Math.PI), dark, 0, -0.09, 0.31);
  mouth.rotation.z = Math.PI;
  head.add(mouth);
  return eyes;
}

const easeOut = (t) => 1 - (1 - t) ** 3;
const pulse = (t) => Math.sin(Math.PI * Math.min(1, Math.max(0, t))); // 0 → 1 → 0

// ท่าทางชั่วคราว: ชื่อท่า → ระยะเวลา (วินาที)
const GESTURE_SEC = { jump: 0.8, punch: 0.4, wave: 1.6, dance: 2.4, clap: 1.4, hit: 0.7, laugh: 1.4, love: 1.4, party: 1.6, cry: 1.6, angry: 1.4 };

export function createAvatar(look) {
  const root = new THREE.Group(); // ตำแหน่งบนพื้น + ทิศที่หัน
  const body = new THREE.Group(); // ส่วนที่เด้ง/เอียงตามท่า
  root.add(body);
  const parts = {};

  function build(l) {
    body.clear();
    const shirt = mat(BODY_COLORS[l.body] ?? BODY_COLORS[0]);
    const skin = mat(SKIN_COLORS[l.skin] ?? SKIN_COLORS[0]);
    const pants = mat(0x2a2426);
    parts.legL = limb(0.09, 0.26, pants, -0.12, SEAT_HIP);
    parts.legR = limb(0.09, 0.26, pants, 0.12, SEAT_HIP);
    parts.torso = mesh(new THREE.CapsuleGeometry(0.26, 0.3, 4, 12), shirt, 0, 0.82, 0);
    parts.armL = limb(0.075, 0.3, shirt, -0.34, 1.02);
    parts.armR = limb(0.075, 0.3, shirt, 0.34, 1.02);
    parts.head = mesh(new THREE.SphereGeometry(0.34, 20, 16), skin, 0, 1.42, 0);
    parts.eyes = buildFace(l.face, parts.head);
    parts.head.add(buildHat(l.hat, HAT_COLORS[(l.body + l.hat) % HAT_COLORS.length]));
    body.add(parts.legL, parts.legR, parts.torso, parts.armL, parts.armR, parts.head);
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

    body.position.set(0, Math.abs(sin) * 0.05 * move * stand, 0);
    body.rotation.set(0.07 * move * stand, -sin * 0.1 * Math.min(move, 1.2) * stand, 0); // โน้มตัว + บิดลำตัวสวนกับแขน
    body.scale.set(1, 1, 1);

    // หายใจ + หันหัวเบาๆ ตอนยืนนิ่ง (นั่งก็หายใจ แต่น้อยกว่า)
    const breathe = Math.sin(clock * 2.3);
    parts.torso.scale.set(1 + breathe * 0.012, 1 + breathe * 0.02, 1 + breathe * 0.012);
    parts.head.rotation.set(0, Math.sin(clock * 0.7) * 0.2 * idle + Math.sin(clock * 0.9) * 0.08 * sitK, Math.sin(clock * 0.5) * 0.03 * idle);

    parts.legL.rotation.set(swing * stand - (Math.PI / 2) * sitK, 0, 0);
    parts.legR.rotation.set(-swing * stand - (Math.PI / 2) * sitK, 0, 0);
    const sway = breathe * 0.025 * stand;
    parts.armL.rotation.set(-swing * 0.9 - 0.3 * sitK, 0, -0.08 - sway);
    parts.armR.rotation.set(swing * 0.9 - 0.3 * sitK, 0, 0.08 + sway);

    // กะพริบตา
    blinkIn -= dt;
    if (blinkIn <= 0 && blinkT < 0) blinkT = 0;
    let eyeOpen = 1;
    if (blinkT >= 0) {
      blinkT += dt;
      eyeOpen = 1 - pulse(blinkT / 0.14) * 0.92;
      if (blinkT >= 0.14) {
        blinkT = -1;
        blinkIn = 2 + Math.random() * 4;
      }
    }
    for (const eye of parts.eyes) eye.scale.y = eyeOpen;

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
        const k = Math.sin(Math.PI * p);
        parts.armR.rotation.set(-Math.PI / 2 * Math.min(1, k * 1.6), 0, 0);
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

  return { root, update, play, setLook: build, isBusy: () => gesture !== null, sitAmount: () => sitK };
}
