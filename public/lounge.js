// ห้องนั่งเล่น 3D: ทุกคนในห้องมีตัวละคร เดิน/กระโดด/นั่ง/ต่อย/ทำท่าได้ + แชทขึ้นบนหัว
// แต่ละเครื่องคุมตัวละครของตัวเอง → ส่งตำแหน่งให้ server กระจาย (ตัวคนอื่นค่อยๆ เลื่อนตามให้ลื่น)
// ต่อย: เครื่องของ "คนที่โดน" เป็นคนเช็คว่าโดนไหม แล้วกระเด็นเอง (ไม่ต้องให้ server คำนวณ)
import * as THREE from 'three';
import { createAvatar, HEAD_TOP, SEAT_HIP } from './lounge-avatar.js';

const HALF_X = 7.5; // = ROOM_HALF_X ใน server/avatar.js
const HALF_Z = 4.5;
const WALK_SPEED = 3;
const RUN_SPEED = 5.2; // กด Shift ค้าง
const BODY_RADIUS = 0.28; // ตัวละครกว้างประมาณนี้ (ใช้ชนของ)
const PERSONAL_SPACE = 0.55; // ใกล้กันกว่านี้จะถูกผลักออกเบาๆ ไม่ให้ซ้อนกัน
const POSE_SEND_MS = 100;
const PUNCH_RANGE = 1.6;
const PUNCH_CONE = Math.cos((55 * Math.PI) / 180);
const KNOCKBACK = 2.2;
const BUBBLE_MS = 5000;
const EMOTE_MS = 2200;
const BUBBLE_LEN = 70;
const SNAP_DIST = 4;

export const EMOTES = { wave: '👋', dance: '💃', laugh: '😂', love: '❤️', party: '🎉', cry: '😢', clap: '👏', angry: '😡', hit: '💫' };

// ที่นั่ง 8 ที่ (= SEAT_COUNT ใน server): โซฟาซ้าย 3 · โซฟาขวา 3 · บีนแบ็ก 2
// ry = ทิศที่หันหน้าเมื่อนั่ง (0 = หันหาจอ/กล้อง +z)
const SEATS = [
  ...[-1, 0.2, 1.4].map((z) => ({ x: -6.3, z, ry: Math.PI / 2, h: 0.5 })),
  ...[-1, 0.2, 1.4].map((z) => ({ x: 6.3, z, ry: -Math.PI / 2, h: 0.5 })),
  { x: -1.6, z: 3.3, ry: Math.PI, h: 0.35 },
  { x: 1.6, z: 3.3, ry: Math.PI, h: 0.35 },
];

// ของที่เดินทะลุไม่ได้ (ตอนเดินไปนั่ง จะข้ามเฉพาะตอนมีเป้าหมายเป็นที่นั่ง)
const SOFA_HALF = { x: 0.6, z: 2.1 }; // โซฟา (รวมที่พักแขน/พนักพิง) กึ่งกลางที่ x = ±6.6, z = 0.2
const BLOCKS = [
  ...[-1, 1].map((side) => ({ box: true, x: side * 6.6, z: 0.2, hx: SOFA_HALF.x, hz: SOFA_HALF.z })),
  ...[-1, 1].map((side) => ({ box: false, x: side * 1.6, z: 3.3, r: 0.5 })), // บีนแบ็ก
];

// ผลักวงกลมของตัวละคร (x, z) ออกจากสิ่งกีดขวาง · คืนตำแหน่งใหม่
function pushOutOfBlocks(x, z) {
  let nx = x;
  let nz = z;
  for (const b of BLOCKS) {
    if (b.box) {
      const cx = Math.max(b.x - b.hx, Math.min(b.x + b.hx, nx));
      const cz = Math.max(b.z - b.hz, Math.min(b.z + b.hz, nz));
      let dx = nx - cx;
      let dz = nz - cz;
      let d = Math.hypot(dx, dz);
      if (d >= BODY_RADIUS) continue;
      if (d < 1e-4) { // จุดศูนย์กลางอยู่ในกล่อง → ดันออกทางด้านที่ใกล้สุด
        const toX = b.hx - Math.abs(nx - b.x);
        const toZ = b.hz - Math.abs(nz - b.z);
        if (toX < toZ) { dx = Math.sign(nx - b.x) || 1; dz = 0; d = 1; nx = b.x + dx * (b.hx + BODY_RADIUS); }
        else { dz = Math.sign(nz - b.z) || 1; dx = 0; d = 1; nz = b.z + dz * (b.hz + BODY_RADIUS); }
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

const clampX = (x) => Math.max(-HALF_X, Math.min(HALF_X, x));
const clampZ = (z) => Math.max(-HALF_Z, Math.min(HALF_Z, z));
const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const graphemes = (text) => Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text), (s) => s.segment);
const clip = (text) => {
  const g = graphemes(text);
  return g.length > BUBBLE_LEN ? `${g.slice(0, BUBBLE_LEN).join('')}…` : text;
};

function lambert(color, extra) {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- ฉาก ----------
function buildRoom(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_X * 2 + 2, HALF_Z * 2 + 2), lambert(0x3a2c25));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(3, 40), lambert(0x6b3b3b));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.01, 0.6);
  rug.receiveShadow = true;
  scene.add(rug);

  // ผนังหลัง + ผนังข้าง (เตี้ยๆ ให้มองเห็นในห้อง)
  scene.add(box(HALF_X * 2 + 2, 3.2, 0.3, 0x2a2223, 0, 1.6, -HALF_Z - 1));
  scene.add(box(0.3, 1.2, HALF_Z * 2 + 2, 0x2a2223, -HALF_X - 1, 0.6, 0));
  scene.add(box(0.3, 1.2, HALF_Z * 2 + 2, 0x2a2223, HALF_X + 1, 0.6, 0));

  // ไฟประดับตามผนังหลัง
  const bulb = new THREE.SphereGeometry(0.06, 8, 6);
  for (let i = 0; i <= 24; i += 1) {
    const x = -HALF_X + (i / 24) * HALF_X * 2;
    const m = new THREE.Mesh(bulb, new THREE.MeshBasicMaterial({ color: i % 3 ? 0xf2a541 : 0xf5d76e }));
    m.position.set(x, 2.7 - Math.sin((i / 24) * Math.PI * 4) ** 2 * 0.25, -HALF_Z - 0.8);
    scene.add(m);
  }

  // ลำโพง 2 ข้าง
  const speakers = [-1, 1].map((side) => {
    const g = new THREE.Group();
    g.add(box(0.8, 1.6, 0.6, 0x1d191a, 0, 0.8, 0));
    const cone = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), lambert(0x4a4040));
    cone.position.set(0, 1.0, 0.31);
    g.add(cone);
    g.position.set(side * 5.2, 0, -HALF_Z - 0.3);
    scene.add(g);
    return cone;
  });

  // ต้นไม้มุมห้อง
  for (const [x, z] of [[-HALF_X + 0.2, -HALF_Z + 0.2], [HALF_X - 0.2, -HALF_Z + 0.2]]) {
    scene.add(box(0.5, 0.5, 0.5, 0x7a4a33, x, 0.25, z));
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8), lambert(0x4f8a5b));
    leaf.position.set(x, 1.2, z);
    leaf.castShadow = true;
    scene.add(leaf);
  }

  // โซฟา 2 ตัว + บีนแบ็ก 2 ใบ (ที่นั่งจริงคือ SEATS — เฟอร์นิเจอร์แค่ให้ดูเป็นที่นั่ง)
  const seatHits = [];
  for (const side of [-1, 1]) {
    const x = side * 6.6;
    const sofa = new THREE.Group();
    sofa.add(box(1.0, 0.45, 3.8, 0x8c4a3c, 0, 0.225, 0.2));
    sofa.add(box(0.3, 1.0, 3.8, 0x7a3f33, side * 0.5, 0.5, 0.2));
    sofa.add(box(1.0, 0.7, 0.3, 0x7a3f33, 0, 0.35, -1.75));
    sofa.add(box(1.0, 0.7, 0.3, 0x7a3f33, 0, 0.35, 2.15));
    sofa.position.x = x;
    scene.add(sofa);
  }
  for (const side of [-1, 1]) {
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), lambert(side < 0 ? 0x5a7fa8 : 0x8a6fb8));
    bag.scale.y = 0.55;
    bag.position.set(side * 1.6, 0.28, 3.3);
    bag.castShadow = true;
    scene.add(bag);
  }
  // จุดกดนั่ง (มองไม่เห็น แต่ raycast โดน)
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });
  SEATS.forEach((seat, index) => {
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1, 10), hitMat);
    hit.position.set(seat.x, 0.5, seat.z);
    hit.userData.seat = index;
    scene.add(hit);
    seatHits.push(hit);
  });

  return { floor, seatHits, speakers };
}

// จอบนผนัง: เขียนชื่อเพลงลง canvas แล้วใช้เป็น texture (ไม่ต้องโหลดรูปข้ามโดเมน)
function buildScreen(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshBasicMaterial({ map: texture }));
  screen.position.set(0, 1.9, -HALF_Z - 0.84);
  scene.add(screen);

  function draw(title, isPlaying) {
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#2a1f1a');
    grad.addColorStop(1, isPlaying ? '#4a2e14' : '#241e1f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = isPlaying ? '#f2a541' : '#a39a92';
    ctx.font = '600 40px "IBM Plex Sans Thai", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPlaying ? '♪ กำลังเล่น' : title ? '❚❚ พักเพลง' : 'ยังไม่มีเพลง', 48, 70);
    ctx.fillStyle = '#f4ede4';
    ctx.font = '600 64px "IBM Plex Sans Thai", sans-serif';
    let text = title ?? 'ค้นเพลงแล้วกด + เพื่อเริ่ม';
    while (ctx.measureText(text).width > canvas.width - 96 && text.length > 1) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, 48, 160);
    texture.needsUpdate = true;
  }
  draw(null, false);
  return draw;
}

// ---------- ป้ายชื่อ / bubble / emoji บนหัว (HTML ทับ canvas จะได้ใช้ฟอนต์ไทยสวยๆ) ----------
function createTag(layer, name, isMe) {
  const tag = document.createElement('div');
  tag.className = `lounge-tag${isMe ? ' is-me' : ''}`;
  const bubble = document.createElement('div');
  bubble.className = 'lounge-bubble';
  bubble.hidden = true;
  const emote = document.createElement('div');
  emote.className = 'lounge-emote';
  emote.hidden = true;
  const label = document.createElement('div');
  label.className = 'lounge-name';
  label.textContent = isMe ? `${name} (คุณ)` : name;
  tag.append(bubble, emote, label);
  layer.append(tag);
  const timers = {};
  const flash = (node, key, text, ms) => {
    node.textContent = text;
    node.hidden = false;
    node.classList.remove('is-pop');
    void node.offsetWidth; // รีสตาร์ทแอนิเมชันเด้ง
    node.classList.add('is-pop');
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => (node.hidden = true), ms);
  };
  return {
    node: tag,
    say: (text) => flash(bubble, 'bubble', clip(text), BUBBLE_MS),
    emote: (emoji) => flash(emote, 'emote', emoji, EMOTE_MS),
    remove: () => {
      Object.values(timers).forEach(clearTimeout);
      tag.remove();
    },
  };
}

export function createLounge(container, { onPose, onGesture, onNotice }) {
  const canvas = container.querySelector('canvas');
  const layer = container.querySelector('.lounge-layer');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161213);
  scene.fog = new THREE.Fog(0x161213, 18, 32);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 60);

  scene.add(new THREE.HemisphereLight(0xffe8cc, 0x2a1f1a, 1.1));
  const sun = new THREE.DirectionalLight(0xffd29a, 1.6);
  sun.position.set(4, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8 });
  scene.add(sun);

  const { floor, seatHits, speakers } = buildRoom(scene);
  const drawScreen = buildScreen(scene);
  let music = false;

  const avatars = new Map(); // id → { av, tag, pos, ry, target, sit, speed }
  let myId = null;

  // ---------- จัดการตัวละคร ----------
  function add({ id, name, look, pose }) {
    remove(id);
    const av = createAvatar(look);
    const isMe = id === myId;
    const entry = {
      av,
      tag: createTag(layer, name, isMe),
      pos: new THREE.Vector3(pose.x, 0, pose.z),
      ry: pose.ry,
      target: { x: pose.x, z: pose.z, ry: pose.ry },
      sit: pose.sit ?? null,
      speed: 0,
      vel: { x: 0, z: 0 }, // ความเร็วจริง (m/s) ของเรา — ค่อยๆ เร่ง/ชะลอ ไม่ได้เริ่ม-หยุดทันที
    };
    av.root.position.copy(entry.pos);
    scene.add(av.root);
    avatars.set(id, entry);
  }

  function remove(id) {
    const entry = avatars.get(id);
    if (!entry) return;
    scene.remove(entry.av.root);
    entry.tag.remove();
    avatars.delete(id);
  }

  const me = () => avatars.get(myId);

  // ---------- คุมตัวเอง ----------
  const keys = new Set();
  let running = false; // กด Shift ค้าง
  let walkTo = null; // { x, z, seat? }
  let lastSent = '';
  let lastSendAt = 0;
  let hitCooldownUntil = 0;

  function poseOf(entry) {
    return { x: entry.pos.x, z: entry.pos.z, ry: entry.ry, sit: entry.sit };
  }

  function sendPose(now, force = false) {
    const entry = me();
    if (!entry || (!force && now - lastSendAt < POSE_SEND_MS)) return;
    const pose = poseOf(entry);
    const key = `${pose.x.toFixed(2)},${pose.z.toFixed(2)},${pose.ry.toFixed(2)},${pose.sit}`;
    if (key === lastSent) return;
    lastSent = key;
    lastSendAt = now;
    onPose(pose);
  }

  const seatTaken = (index) => [...avatars.entries()].some(([id, e]) => id !== myId && e.sit === index);

  function sitOn(index) {
    const entry = me();
    if (!entry) return;
    if (seatTaken(index)) return onNotice('ที่นั่งนี้มีคนนั่งแล้ว');
    const seat = SEATS[index];
    entry.sit = index;
    entry.pos.set(seat.x, 0, seat.z);
    entry.ry = seat.ry;
    entry.vel.x = entry.vel.z = 0;
    walkTo = null;
    sendPose(performance.now(), true);
  }

  function standUp() {
    const entry = me();
    if (!entry || entry.sit === null) return;
    const seat = SEATS[entry.sit];
    entry.sit = null;
    entry.pos.set(clampX(seat.x + Math.sin(seat.ry) * 0.9), 0, clampZ(seat.z + Math.cos(seat.ry) * 0.9));
    sendPose(performance.now(), true);
  }

  function nearestFreeSeat() {
    const entry = me();
    let best = null;
    SEATS.forEach((seat, index) => {
      if (seatTaken(index)) return;
      const d = Math.hypot(seat.x - entry.pos.x, seat.z - entry.pos.z);
      if (!best || d < best.d) best = { index, d };
    });
    return best;
  }

  function toggleSit() {
    const entry = me();
    if (!entry) return;
    if (entry.sit !== null) return standUp();
    const best = nearestFreeSeat();
    if (!best) return onNotice('ที่นั่งเต็มหมดแล้ว');
    const seat = SEATS[best.index];
    walkTo = { x: seat.x, z: seat.z, seat: best.index };
  }

  // ท่าของตัวเอง: เล่นทันทีที่เครื่องเรา แล้วบอกคนอื่น
  function gesture(type) {
    const entry = me();
    if (!entry) return;
    if (type === 'jump' && entry.sit !== null) standUp();
    entry.av.play(type);
    if (EMOTES[type]) entry.tag.emote(EMOTES[type]);
    onGesture(type);
  }

  // คนอื่นต่อย → เช็คว่าเราอยู่ข้างหน้าเขาในระยะไหม → โดนก็กระเด็น
  function checkPunched(attacker) {
    const entry = me();
    if (!entry || performance.now() < hitCooldownUntil) return;
    const dx = entry.pos.x - attacker.pos.x;
    const dz = entry.pos.z - attacker.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > PUNCH_RANGE || dist < 0.01) return;
    const facing = (Math.sin(attacker.ry) * dx + Math.cos(attacker.ry) * dz) / dist;
    if (facing < PUNCH_CONE) return;
    hitCooldownUntil = performance.now() + 800;
    entry.sit = null;
    walkTo = null;
    entry.vel.x = entry.vel.z = 0;
    entry.pos.set(clampX(entry.pos.x + (dx / dist) * KNOCKBACK), 0, clampZ(entry.pos.z + (dz / dist) * KNOCKBACK));
    entry.ry = Math.atan2(-dx, -dz); // หันกลับไปมองคนต่อย
    gesture('hit');
    entry.tag.say('โอ๊ย!');
    sendPose(performance.now(), true);
  }

  // วงกลมเรืองๆ บนพื้นตรงจุดที่แตะ
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.3, 28),
    new THREE.MeshBasicMaterial({ color: 0xf2a541, transparent: true, opacity: 0.8, depthWrite: false }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);

  function updateMe(dt) {
    const entry = me();
    if (!entry) return;
    const prevX = entry.pos.x;
    const prevZ = entry.pos.z;
    // ทิศที่อยากไป (จากคีย์บอร์ด หรือจุดที่แตะ) + ความเร็วสูงสุดที่อยากได้
    let dx = 0;
    let dz = 0;
    let want = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dz -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dz += 1;
    if (dx || dz) {
      walkTo = null;
      if (entry.sit !== null) standUp();
      want = running ? RUN_SPEED : WALK_SPEED;
    } else if (walkTo) {
      if (entry.sit !== null) standUp();
      dx = walkTo.x - entry.pos.x;
      dz = walkTo.z - entry.pos.z;
      const left = Math.hypot(dx, dz);
      if (left < 0.14) {
        const seat = walkTo.seat;
        walkTo = null;
        dx = dz = 0;
        if (seat !== undefined) sitOn(seat);
      } else {
        // ใกล้ถึงแล้วค่อยๆ ชะลอ (ไม่หยุดกึก) แต่ไม่ช้าจนคลาน
        want = WALK_SPEED * Math.min(1, Math.max(0.3, left / 0.9));
      }
    }
    const len = Math.hypot(dx, dz);
    const vel = entry.vel;
    const goalX = len > 0 ? (dx / len) * want : 0;
    const goalZ = len > 0 ? (dz / len) * want : 0;
    // เร่งเร็วกว่าชะลอนิดหน่อย → ออกตัวฉับไวแต่หยุดนุ่ม
    const k = 1 - Math.exp(-dt * (len > 0 ? 10 : 7));
    vel.x += (goalX - vel.x) * k;
    vel.z += (goalZ - vel.z) * k;
    const sp = Math.hypot(vel.x, vel.z);
    if (sp < 0.05 && len === 0) vel.x = vel.z = 0;

    if (sp > 0.01) {
      let nx = clampX(entry.pos.x + vel.x * dt);
      let nz = clampZ(entry.pos.z + vel.z * dt);
      if (walkTo?.seat === undefined) [nx, nz] = pushOutOfBlocks(nx, nz); // เดินไปนั่ง = ผ่านโซฟาได้
      for (const [id, other] of avatars) { // ไม่เดินซ้อนตัวคนอื่น (ผลักออกนิ่มๆ)
        if (id === myId || other.sit !== null) continue;
        const ox = nx - other.pos.x;
        const oz = nz - other.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < PERSONAL_SPACE && od > 1e-4) {
          nx += (ox / od) * (PERSONAL_SPACE - od) * 0.5;
          nz += (oz / od) * (PERSONAL_SPACE - od) * 0.5;
        }
      }
      entry.pos.x = clampX(nx);
      entry.pos.z = clampZ(nz);
    }
    // ถ้าชนจนขยับไม่ได้จริง ให้ความเร็วที่โชว์ลดลงตาม (ไม่ก้าวขาอยู่กับที่)
    const moved = Math.hypot(entry.pos.x - prevX, entry.pos.z - prevZ) / Math.max(dt, 0.001);
    const shown = Math.min(sp, moved + 0.4);
    entry.speed = shown / WALK_SPEED;
    // หันหน้าไปทางที่เดิน (นุ่มๆ ไม่สะบัด)
    if (sp > 0.25) entry.ry = angleLerp(entry.ry, Math.atan2(vel.x, vel.z), 1 - Math.exp(-dt * 12));

    // วงกลมบอกจุดที่แตะ (เฉพาะเดินไปพื้น ไม่ใช่ที่นั่ง)
    marker.visible = Boolean(walkTo) && walkTo.seat === undefined;
    if (marker.visible) {
      marker.position.set(walkTo.x, 0.03, walkTo.z);
      marker.scale.setScalar(1 + Math.sin(performance.now() / 180) * 0.08);
    }
  }

  // ตัวคนอื่น: เลื่อนเข้าหาตำแหน่งล่าสุดแบบนุ่มๆ · ห่างมาก (เพิ่งต่อใหม่/โดนต่อย) → วาร์ปเลย
  function updateOthers(dt) {
    const k = 1 - Math.exp(-dt * 10);
    for (const [id, entry] of avatars) {
      if (id === myId) continue;
      const { x, z, ry } = entry.target;
      const dist = Math.hypot(x - entry.pos.x, z - entry.pos.z);
      if (dist > SNAP_DIST) entry.pos.set(x, 0, z);
      else {
        entry.pos.x += (x - entry.pos.x) * k;
        entry.pos.z += (z - entry.pos.z) * k;
      }
      entry.ry = angleLerp(entry.ry, ry, k);
      // ความเร็วที่เห็นจากการเลื่อนตามแพ็กเก็ต (มาทุก ~100 ms) กระตุกง่าย → เฉลี่ยให้เนียน ท่าเดินจะไม่สั่น
      const raw = Math.min(1.8, (dist / Math.max(dt, 0.001)) / WALK_SPEED) * (dist > 0.05 ? 1 : 0);
      entry.speed += (raw - entry.speed) * (1 - Math.exp(-dt * 7));
    }
  }

  // ---------- วาดทุกเฟรม ----------
  const headPoint = new THREE.Vector3();
  function placeTags(width, height) {
    for (const entry of avatars.values()) {
      headPoint.set(entry.pos.x, HEAD_TOP + (entry.lastDrop ?? 0) * entry.av.sitAmount(), entry.pos.z).project(camera);
      const visible = headPoint.z < 1;
      entry.tag.node.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) continue;
      const x = ((headPoint.x + 1) / 2) * width;
      const y = ((1 - headPoint.y) / 2) * height;
      entry.tag.node.style.transform = `translate(${x}px, ${y}px)`;
      entry.tag.node.style.zIndex = String(Math.round((1 - headPoint.z) * 1e5));
    }
  }

  function fitCamera() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // จอแคบ (มือถือ) → ถอยกล้องให้เห็นห้องทั้งกว้าง
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fitWidth = (HALF_X + 0.4) / Math.tan(hFov / 2);
    const dist = Math.max(10.5, fitWidth * 0.9);
    camera.position.set(0, dist * 0.55, dist * 0.84);
    camera.lookAt(0, 0.2, 0.2);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(fitCamera).observe(container);

  let visible = true;
  let onScreen = true; // เห็นห้องเกินครึ่งเมื่อไหร่ ปุ่มลูกศร/Space ถึงเป็นของตัวละคร (ไม่งั้นปล่อยให้เลื่อนหน้าได้ตามปกติ)
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    onScreen = e.intersectionRatio >= 0.5;
    if (!onScreen) keys.clear();
  }, { threshold: [0, 0.5] }).observe(container);

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    updateMe(dt);
    sendPose(now);
    if (!visible) return;
    updateOthers(dt);
    for (const entry of avatars.values()) {
      const seated = entry.sit !== null;
      if (seated) entry.lastDrop = SEATS[entry.sit].h - SEAT_HIP; // จำไว้ให้ตอนลุก ตัวค่อยๆ ยืดขึ้น ไม่กระโดดวูบ
      // ลงนั่ง/ลุก = ค่อยๆ เปลี่ยน (sitAmount 0→1) แทนการวาร์ปไปที่นั่ง
      entry.av.root.position.set(entry.pos.x, (entry.lastDrop ?? 0) * entry.av.sitAmount(), entry.pos.z);
      entry.av.root.rotation.y = entry.ry;
      entry.av.update(dt, { speed: entry.speed, seated });
    }
    const beat = music ? 1 + Math.abs(Math.sin(now / 160)) * 0.12 : 1;
    for (const cone of speakers) cone.scale.setScalar(beat);
    renderer.render(scene, camera);
    placeTags(container.clientWidth, container.clientHeight);
  }
  requestAnimationFrame(frame);

  // ---------- input ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }));
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8 || !me()) return;
    downAt = null;
    container.focus({ preventScroll: true });
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const seatHit = raycaster.intersectObjects(seatHits)[0];
    if (seatHit) {
      const index = seatHit.object.userData.seat;
      if (seatTaken(index)) return onNotice('ที่นั่งนี้มีคนนั่งแล้ว');
      walkTo = { x: SEATS[index].x, z: SEATS[index].z, seat: index };
      return;
    }
    const floorHit = raycaster.intersectObject(floor)[0];
    if (floorHit) walkTo = { x: clampX(floorHit.point.x), z: clampZ(floorHit.point.z) };
  });

  const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
  // รับปุ่มทั้งหน้าเว็บ ไม่ต้องคลิกที่ห้องก่อน · ยกเว้น: กำลังพิมพ์ / โฟกัสอยู่ที่ตัวควบคุมที่ใช้ปุ่มเหล่านี้เอง
  const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const ownsArrows = (t) => t instanceof HTMLElement && Boolean(t.closest('[role="tablist"], [role="radiogroup"]'));
  const isButton = (t) => t instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(t.tagName);
  const canControl = (e) => me() && onScreen && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target);

  window.addEventListener('keydown', (e) => {
    running = e.shiftKey;
    if (!canControl(e)) return;
    if (MOVE_KEYS.has(e.code)) {
      if (ownsArrows(e.target)) return;
      if (!keys.has(e.code)) pressedAt.set(e.code, performance.now());
      keys.add(e.code);
    } else if (e.code === 'Space') {
      if (isButton(e.target)) return; // Space บนปุ่ม = กดปุ่มตามปกติ
      if (!e.repeat) gesture('jump');
    } else if (e.code === 'KeyF') {
      if (!e.repeat) gesture('punch');
    } else if (e.code === 'KeyE') {
      if (!e.repeat) toggleSit();
    } else return;
    e.preventDefault();
  });
  // แตะปุ่มสั้นมาก (กด-ปล่อยจบก่อนเฟรมถัดไป) ต้องยังเดินได้ ≥ 1 ก้าว → ค้างปุ่มไว้อย่างน้อย MIN_HOLD_MS
  const MIN_HOLD_MS = 110;
  const pressedAt = new Map();
  window.addEventListener('keyup', (e) => {
    running = e.shiftKey;
    const held = performance.now() - (pressedAt.get(e.code) ?? 0);
    if (held >= MIN_HOLD_MS) keys.delete(e.code);
    else setTimeout(() => keys.delete(e.code), MIN_HOLD_MS - held);
  });
  const releaseKeys = () => {
    keys.clear();
    running = false;
  };
  window.addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', releaseKeys);

  return {
    // ใช้ตอน ?debug=1: ดูตำแหน่งตัวละครทุกตัว
    debug: () => [...avatars.entries()].map(([id, e]) => ({ id, me: id === myId, x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2), ry: +e.ry.toFixed(2), sit: e.sit })),
    // รายชื่อทั้งห้อง (ตอนเข้าห้อง/ต่อใหม่) — ล้างของเก่าทิ้งแล้ววาดใหม่หมด
    reset(list, you) {
      for (const id of [...avatars.keys()]) remove(id);
      myId = you;
      lastSent = '';
      list.forEach(add);
    },
    add,
    remove,
    pose({ id, x, z, ry, sit }) {
      const entry = avatars.get(id);
      if (!entry || id === myId) return;
      entry.target = { x, z, ry };
      entry.sit = sit ?? null;
    },
    look(id, look) {
      avatars.get(id)?.av.setLook(look);
    },
    remoteGesture(id, type) {
      const entry = avatars.get(id);
      if (!entry || id === myId) return;
      entry.av.play(type);
      if (EMOTES[type]) entry.tag.emote(EMOTES[type]);
      if (type === 'punch') checkPunched(entry);
    },
    say(id, text) {
      avatars.get(id)?.tag.say(text);
    },
    gesture,
    toggleSit,
    setMyLook(look) {
      me()?.av.setLook(look);
    },
    setScreen(title, isPlaying) {
      music = isPlaying;
      drawScreen(title, isPlaying);
    },
  };
}
