// ลาน 3D (voxel 8-bit): ทุกคนในห้องมีตัวละคร เดิน/วิ่ง/กระโดด/นั่ง/ต่อย/ทำท่า + แชทขึ้นบนหัว + เก็บของแต่งตัว
// แต่ละเครื่องคุมตัวละครของตัวเอง → ส่งตำแหน่งให้ server กระจาย (ตัวคนอื่นค่อยๆ เลื่อนตามให้ลื่น)
// ต่อย: เครื่องของ "คนที่โดน" เป็นคนเช็คว่าโดนไหม แล้วกระเด็นเอง (ไม่ต้องให้ server คำนวณ)
// ของในลาน: server เป็นคนวาง/ตัดสินว่าใครเก็บได้ เครื่องเราแค่บอกว่า "เดินทับชิ้นนี้แล้ว"
import * as THREE from 'three';
import { createAvatar, HEAD_TOP, SEAT_HIP } from './lounge-avatar.js';
import { animateItem, buildItem, ITEM_NAMES } from './lounge-items.js';
import { buildWorld, HALF_X, HALF_Z, onDanceFloor, pushOutOfBlocks, SEATS } from './lounge-world.js';

const WALK_SPEED = 3;
const RUN_SPEED = 5.2; // กด Shift ค้าง
const PERSONAL_SPACE = 0.55; // ใกล้กันกว่านี้จะถูกผลักออกเบาๆ ไม่ให้ซ้อนกัน
const POSE_SEND_MS = 100;
const PUNCH_RANGE = 1.6;
const PUNCH_CONE = Math.cos((55 * Math.PI) / 180);
const KNOCKBACK = 2.2;
const BUBBLE_MS = 5000;
const EMOTE_MS = 2200;
const BUBBLE_LEN = 70;
const SNAP_DIST = 4;
const PICK_DIST = 1; // เดินเข้าใกล้ของเท่านี้ = เก็บ
const PICK_RETRY_MS = 800; // server ปฏิเสธ (อีกคนเก็บไปก่อน) → ไม่ส่งซ้ำรัวๆ
const PIXEL_HEIGHT = 300; // เรนเดอร์สูงแค่นี้พิกเซลแล้วขยาย = ภาพแตกเป็นพิกเซลแบบเกม 8-bit
const SKY = 0x2b2747;
// จังหวะไฟ/ลำโพง/โยกตัว: YouTube ไม่ให้อ่านเสียงจริง → ใช้จังหวะคงที่ 120 BPM (เพลงป็อปส่วนใหญ่อยู่แถวนี้)
// นับจากนาฬิกาเครื่อง ทุกตัวในฟลอร์จึงโยกพร้อมกัน แต่ไม่ได้ตรงบีตเพลงเป๊ะ
const BEAT_MS = 500;
// ซูมกล้อง: 1 = ระยะเดิม · น้อย = ใกล้ · มาก = ถอยเห็นทั้งลาน
const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2;
const ZOOM_STEP = 1.15;
const LOOK_AHEAD = 1.5;
// จอ MV บนเวที (16:9 กลางจอตัวหนังสือ) — ต้องอยู่ในกรอบ PlaneGeometry ของ buildScreen (7.2 × 1.8)
const MV = { halfW: 1.6, y0: 1.1, y1: 2.9, z: -6.24 };

export const EMOTES = { wave: '👋', dance: '💃', laugh: '😂', love: '❤️', party: '🎉', cry: '😢', clap: '👏', angry: '😡', hit: '💫' };

const clampX = (x) => Math.max(-HALF_X, Math.min(HALF_X, x));
const clampZ = (z) => Math.max(-HALF_Z, Math.min(HALF_Z, z));
const angleLerp = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
const graphemes = (text) => Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text), (s) => s.segment);
const clip = (text) => {
  const g = graphemes(text);
  return g.length > BUBBLE_LEN ? `${g.slice(0, BUBBLE_LEN).join('')}…` : text;
};

// จอบนเวที: เขียนชื่อเพลงลง canvas ความละเอียดต่ำ แล้วใช้เป็น texture แบบพิกเซล
function buildScreen(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.8), new THREE.MeshBasicMaterial({ map: texture }));
  screen.position.set(0, 2.0, -6.26);
  scene.add(screen);

  // mv = มีวิดีโอวางทับกลางจออยู่ → ตัวหนังสือจะโดนบัง เลยวาดแถบ EQ สองข้างแทน (beat = ตำแหน่งจังหวะ)
  function draw(title, isPlaying, mv = false, beat = 0) {
    const ctx = canvas.getContext('2d');
    if (mv) return drawEq(ctx, isPlaying, beat);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = isPlaying ? '#262b44' : '#181425';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y += 4) { // เส้นสแกนแบบจอ CRT
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y, canvas.width, 1);
    }
    ctx.fillStyle = isPlaying ? '#feae34' : '#8b9bb4';
    ctx.font = '600 16px "Prompt", "IBM Plex Sans Thai", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(isPlaying ? '▶ กำลังเล่น' : title ? '❚❚ พักเพลง' : 'ยังไม่มีเพลง', 16, 26);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 26px "Prompt", "IBM Plex Sans Thai", sans-serif';
    let text = title ?? 'ค้นเพลงแล้วกด + เพื่อเริ่ม';
    while (ctx.measureText(text).width > canvas.width - 32 && text.length > 1) text = `${text.slice(0, -2)}…`;
    ctx.fillText(text, 16, 62);
    texture.needsUpdate = true;
  }
  // แท่ง EQ แบบพิกเซล ซ้าย 1 ชุด ขวา 1 ชุด (กลางจอ = ที่ของวิดีโอ ปล่อยมืดไว้)
  function drawEq(ctx, isPlaying, beat) {
    ctx.fillStyle = '#181425';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const side = Math.floor((canvas.width * (1 - (MV.halfW * 2) / 7.2)) / 2) - 8;
    const bar = Math.floor(side / 8);
    for (const x0 of [6, canvas.width - side - 2]) {
      for (let i = 0; i < 8; i += 1) {
        const level = isPlaying ? 0.35 + 0.65 * Math.abs(Math.sin(beat * Math.PI * (0.5 + i * 0.13) + i)) : 0.08;
        const h = Math.max(4, Math.round(((canvas.height - 16) * level) / 4) * 4);
        ctx.fillStyle = i % 3 === 0 ? '#2ce8f5' : '#22c55e';
        ctx.fillRect(x0 + i * bar, canvas.height - 8 - h, bar - 3, h);
      }
    }
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

export function createLounge(container, { onPose, onGesture, onNotice, onPick, onDrop, onScreenQuad }) {
  const canvas = container.querySelector('canvas');
  const layer = container.querySelector('.lounge-layer');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap; // เงาขอบแข็ง เข้ากับภาพพิกเซล
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 26, 46);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 120);

  scene.add(new THREE.HemisphereLight(0xc7d6ff, 0x3e2731, 1.5));
  const sun = new THREE.DirectionalLight(0xffe2b0, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
  scene.add(sun, sun.target);

  const { floor, seatHits, speakers, blocks, floorLights } = buildWorld(scene);
  const drawScreen = buildScreen(scene);
  let music = false;
  let screenTitle = null;
  let mvOn = false; // ตัวเล่น YouTube วางทับจอเวทีอยู่ไหม (app.js บอกผ่าน setMv)
  let lastEqAt = 0;
  let zoom = 1;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  const avatars = new Map(); // id → { av, tag, pos, ry, target, sit, speed, vel, lastDrop }
  let myId = null;

  // ---------- จัดการตัวละคร ----------
  function add({ id, name, look, pose, held }) {
    remove(id);
    const av = createAvatar(look);
    av.setHeld(held ?? null);
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
    if (isMe) snapCamera();
  }

  function remove(id) {
    const entry = avatars.get(id);
    if (!entry) return;
    scene.remove(entry.av.root);
    entry.tag.remove();
    avatars.delete(id);
  }

  const me = () => avatars.get(myId);

  // ---------- ของบนพื้น ----------
  const ground = new Map(); // id → { group, kind, x, z }
  const pickTriedAt = new Map();
  // ของที่เพิ่งหล่นตรงเท้าเรา (กดวาง/สลับของ) → ไม่เก็บจนกว่าจะเดินออกห่าง ไม่งั้นเก็บกลับทันที/สลับวนไม่จบ
  const ignoreUntilAway = new Set();
  const AWAY_DIST = PICK_DIST + 0.6;

  function setItems(list) {
    const entry = me();
    for (const item of list) {
      if (ground.has(item.id) || !entry) continue;
      if (Math.hypot(item.x - entry.pos.x, item.z - entry.pos.z) < AWAY_DIST) ignoreUntilAway.add(item.id);
    }
    const keep = new Set(list.map((item) => item.id));
    for (const [id, item] of ground) {
      if (keep.has(id)) continue;
      scene.remove(item.group);
      ground.delete(id);
      ignoreUntilAway.delete(id);
      pickTriedAt.delete(id);
    }
    for (const { id, kind, x, z } of list) {
      if (ground.has(id)) continue;
      const group = new THREE.Group();
      const model = buildItem(kind);
      model.rotation.z = model.userData.upright ? 0 : 0.6; // ของยาวเอียงนิดๆ ให้ดูเป็นของดรอป
      group.add(model);
      const glow = new THREE.Mesh(
        new THREE.RingGeometry(0.32, 0.46, 4, 1),
        new THREE.MeshBasicMaterial({ color: 0xfee761, transparent: true, opacity: 0.7, depthWrite: false }),
      );
      glow.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      glow.position.y = -0.33;
      group.add(glow);
      group.position.set(x, 0.35, z);
      group.userData.seed = id;
      scene.add(group);
      ground.set(id, { group, kind, x, z });
    }
  }

  function animateGround(now) {
    const t = now / 1000;
    for (const item of ground.values()) {
      const s = item.group.userData.seed;
      item.group.position.y = 0.4 + Math.sin(t * 2.4 + s) * 0.08;
      item.group.rotation.y = t * 1.4 + s;
      animateItem(item.group.children[0], t);
    }
  }

  // เดินทับของ → บอก server (server เช็คระยะเองอีกที)
  function checkPickup(now) {
    const entry = me();
    if (!entry || entry.sit !== null) return;
    for (const [id, item] of ground) {
      const dist = Math.hypot(item.x - entry.pos.x, item.z - entry.pos.z);
      if (ignoreUntilAway.has(id)) {
        if (dist > AWAY_DIST) ignoreUntilAway.delete(id); // เดินออกไปแล้ว → กลับมาเก็บได้
        continue;
      }
      if (dist > PICK_DIST) continue;
      if (now - (pickTriedAt.get(id) ?? -Infinity) < PICK_RETRY_MS) continue;
      pickTriedAt.set(id, now);
      onPick?.(id);
    }
  }

  function setHeld(id, kind) {
    const entry = avatars.get(id);
    if (!entry) return;
    entry.av.setHeld(kind);
    if (id === myId && kind) onNotice(`ได้${ITEM_NAMES[kind] ?? 'ของ'}แล้ว! กด G เพื่อวาง`);
  }

  function dropHeld() {
    if (me()?.av.held()) onDrop?.();
  }

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

  // วงกลมบนพื้นตรงจุดที่แตะ
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.32, 4, 1),
    new THREE.MeshBasicMaterial({ color: 0xfeae34, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  marker.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  marker.visible = false;
  scene.add(marker);

  function keyDirection() {
    let dx = 0;
    let dz = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) dz -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) dz += 1;
    return [dx, dz];
  }

  // ทิศที่อยากไป (จากคีย์บอร์ด หรือจุดที่แตะ) + ความเร็วสูงสุดที่อยากได้
  function desiredMove(entry) {
    const [kx, kz] = keyDirection();
    if (kx || kz) {
      walkTo = null;
      if (entry.sit !== null) standUp();
      return { dx: kx, dz: kz, want: running ? RUN_SPEED : WALK_SPEED };
    }
    if (!walkTo) return { dx: 0, dz: 0, want: 0 };
    if (entry.sit !== null) standUp();
    const dx = walkTo.x - entry.pos.x;
    const dz = walkTo.z - entry.pos.z;
    const left = Math.hypot(dx, dz);
    if (left < 0.14) {
      const seat = walkTo.seat;
      walkTo = null;
      if (seat !== undefined) sitOn(seat);
      return { dx: 0, dz: 0, want: 0 };
    }
    // ใกล้ถึงแล้วค่อยๆ ชะลอ (ไม่หยุดกึก) แต่ไม่ช้าจนคลาน
    return { dx, dz, want: WALK_SPEED * Math.min(1, Math.max(0.3, left / 0.9)) };
  }

  // ขยับไปตามความเร็ว แล้วดันออกจากของแข็ง/ตัวคนอื่น
  function moveBy(entry, vx, vz, dt) {
    let nx = clampX(entry.pos.x + vx * dt);
    let nz = clampZ(entry.pos.z + vz * dt);
    if (walkTo?.seat === undefined) [nx, nz] = pushOutOfBlocks(blocks, nx, nz); // เดินไปนั่ง = ผ่านโซฟาได้
    for (const [id, other] of avatars) {
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

  function updateMe(dt) {
    const entry = me();
    if (!entry) return;
    const prevX = entry.pos.x;
    const prevZ = entry.pos.z;
    const { dx, dz, want } = desiredMove(entry);
    const len = Math.hypot(dx, dz);
    const vel = entry.vel;
    // เร่งเร็วกว่าชะลอนิดหน่อย → ออกตัวฉับไวแต่หยุดนุ่ม
    const k = 1 - Math.exp(-dt * (len > 0 ? 10 : 7));
    vel.x += ((len > 0 ? (dx / len) * want : 0) - vel.x) * k;
    vel.z += ((len > 0 ? (dz / len) * want : 0) - vel.z) * k;
    const sp = Math.hypot(vel.x, vel.z);
    if (sp < 0.05 && len === 0) vel.x = vel.z = 0;
    if (sp > 0.01) moveBy(entry, vel.x, vel.z, dt);

    // ชนจนขยับไม่ได้จริง → ความเร็วที่โชว์ลดลงตาม (ไม่ก้าวขาอยู่กับที่)
    const moved = Math.hypot(entry.pos.x - prevX, entry.pos.z - prevZ) / Math.max(dt, 0.001);
    entry.speed = Math.min(sp, moved + 0.4) / WALK_SPEED;
    if (sp > 0.25) entry.ry = angleLerp(entry.ry, Math.atan2(vel.x, vel.z), 1 - Math.exp(-dt * 12));

    marker.visible = Boolean(walkTo) && walkTo.seat === undefined;
    if (marker.visible) {
      marker.position.set(walkTo.x, 0.03, walkTo.z);
      marker.scale.setScalar(1 + Math.sin(performance.now() / 180) * 0.1);
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
      // ความเร็วจากแพ็กเก็ต (มาทุก ~100 ms) กระตุกง่าย → เฉลี่ยให้เนียน ท่าเดินจะไม่สั่น
      const raw = Math.min(1.8, (dist / Math.max(dt, 0.001)) / WALK_SPEED) * (dist > 0.05 ? 1 : 0);
      entry.speed += (raw - entry.speed) * (1 - Math.exp(-dt * 7));
    }
  }

  // ---------- กล้องตามตัวเรา ----------
  const focus = new THREE.Vector3(0, 0, 1);
  const camOffset = new THREE.Vector3();
  function cameraGoal() {
    const entry = me();
    return entry ? [entry.pos.x, entry.pos.z] : [0, 1];
  }
  function placeCamera() {
    // จอแคบ (มือถือ) → ถอยกล้องให้เห็นรอบตัวกว้างขึ้น
    const far = (camera.aspect < 1 ? 1.45 : 1) * zoom;
    camOffset.set(0, 12 * far, 8.5 * far); // มุมก้มชัน (~55°) → ต้นไม้บังตัวละครน้อย
    // มองเลยตัวละครไปทางเวทีนิดนึง (ตัวละครอยู่ต่ำกว่ากลางจอ) → จอ MV ไม่หลุดขอบบนง่ายตอนยืนบนฟลอร์/ซูมเข้า
    camera.position.copy(focus).add(camOffset);
    camera.position.z -= LOOK_AHEAD;
    camera.lookAt(focus.x, 0.6, focus.z - LOOK_AHEAD);
    sun.position.set(focus.x + 8, 18, focus.z + 10);
    sun.target.position.set(focus.x, 0, focus.z);
  }
  function snapCamera() {
    const [x, z] = cameraGoal();
    focus.set(x, 0, z);
    placeCamera();
  }
  function followCamera(dt) {
    const [x, z] = cameraGoal();
    const k = 1 - Math.exp(-dt * 4);
    focus.x += (x - focus.x) * k;
    focus.z += (z - focus.z) * k;
    placeCamera();
  }

  // ---------- วาดทุกเฟรม ----------
  const headPoint = new THREE.Vector3();
  function placeTags(width, height) {
    for (const entry of avatars.values()) {
      headPoint.set(entry.pos.x, HEAD_TOP + (entry.lastDrop ?? 0) * entry.av.sitAmount(), entry.pos.z).project(camera);
      const visible = headPoint.z < 1 && Math.abs(headPoint.x) < 1.1 && Math.abs(headPoint.y) < 1.1;
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
    // ความละเอียดต่ำแล้วให้ CSS ขยายแบบ pixelated (ดู .lounge-view canvas)
    renderer.setPixelRatio(Math.min(1, PIXEL_HEIGHT / h));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  new ResizeObserver(fitCamera).observe(container);

  let visible = true;
  let onScreen = true; // เห็นลานเกินครึ่งเมื่อไหร่ ปุ่มลูกศร/Space ถึงเป็นของตัวละคร (ไม่งั้นปล่อยให้เลื่อนหน้าได้ตามปกติ)
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    onScreen = e.intersectionRatio >= 0.5;
    if (!onScreen) keys.clear();
  }, { threshold: [0, 0.5] }).observe(container);

  // ---------- เพลงเล่น → ฟลอร์ ลำโพง จอ ขยับตามจังหวะ ----------
  let beats = 0; // จำนวนบีตนับต่อเนื่อง (ทศนิยม = ระหว่างบีต)
  let moving = false; // เพลงเล่นอยู่ และผู้ใช้ไม่ได้ขอลดการเคลื่อนไหว
  function animateMusic(now) {
    // เครื่องที่ตั้ง "ลดการเคลื่อนไหว" (Windows ปิด animation effects ก็นับ) → ตัวละครยังโยกได้ (Man ขอฟีเจอร์นี้ตรงๆ)
    // แต่ไฟฟลอร์เป็นคลื่นช้าๆ ไม่เปลี่ยนสีทุกบีต และลำโพงไม่เด้ง = ไม่มีอะไรกะพริบ
    const calm = reducedMotion.matches;
    moving = music && !calm;
    beats = now / BEAT_MS;
    const phase = beats % 1;
    if (!music) floorLights(0, 0, 0);
    else if (calm) floorLights(0.8, 0, (beats / 8) % 1);
    else floorLights(1, Math.floor(beats), phase);
    const kick = moving ? Math.max(0, 1 - phase * 3) : 0; // กระแทกต้นบีตแล้วค่อยคืน
    for (const { cone, box } of speakers) {
      cone.scale.set(1 + kick * 0.3, 1 + kick * 0.3, 1);
      box.scale.set(1 + kick * 0.03, 1 - kick * 0.04, 1 + kick * 0.03);
    }
    if (mvOn && now - lastEqAt > 100) { // EQ บนจอวาดใหม่ ~10 ครั้ง/วิ พอ (วาด canvas ทุกเฟรมเปลือง)
      lastEqAt = now;
      drawScreen(screenTitle, moving, true, beats);
    }
  }

  // ---------- มุมจอ MV บนหน้าจอ (px ในกรอบลาน) → app.js วางตัวเล่น YouTube ทับ ----------
  // ลำดับมุม: ซ้ายบน ขวาบน ขวาล่าง ซ้ายล่าง (ตรงกับมุมของ element วิดีโอ)
  const mvCorners = [
    new THREE.Vector3(-MV.halfW, MV.y1, MV.z),
    new THREE.Vector3(MV.halfW, MV.y1, MV.z),
    new THREE.Vector3(MV.halfW, MV.y0, MV.z),
    new THREE.Vector3(-MV.halfW, MV.y0, MV.z),
  ];
  const projected = new THREE.Vector3();
  let lastQuadKey = null;
  function emitQuad(quad) {
    const key = quad ? quad.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ') : '';
    if (key === lastQuadKey) return; // กล้องนิ่ง = ไม่ต้องแตะ DOM
    lastQuadKey = key;
    onScreenQuad(quad, container.clientWidth, container.clientHeight);
  }
  function reportScreen() {
    if (!onScreenQuad) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const quad = [];
    for (const c of mvCorners) {
      projected.copy(c).project(camera);
      if (projected.z >= 1) return emitQuad(null); // อยู่หลังกล้อง
      quad.push([((projected.x + 1) / 2) * w, ((1 - projected.y) / 2) * h]);
    }
    emitQuad(quad);
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    animateMusic(now);
    updateMe(dt);
    sendPose(now);
    checkPickup(now);
    if (!visible) return;
    updateOthers(dt);
    for (const entry of avatars.values()) {
      const seated = entry.sit !== null;
      if (seated) entry.lastDrop = SEATS[entry.sit].h - SEAT_HIP; // จำไว้ให้ตอนลุก ตัวค่อยๆ ยืดขึ้น ไม่วูบ
      entry.av.root.position.set(entry.pos.x, (entry.lastDrop ?? 0) * entry.av.sitAmount(), entry.pos.z);
      entry.av.root.rotation.y = entry.ry;
      // ยืนนิ่งบนฟลอร์ตอนเพลงเล่น → โยกตามจังหวะ (ทุกเครื่องคิดเองจากตำแหน่ง ไม่ต้องส่งผ่าน server)
      const groove = music && !seated && entry.speed < 0.15 && onDanceFloor(entry.pos.x, entry.pos.z) ? beats : null;
      entry.dancing = groove !== null;
      entry.av.update(dt, { speed: entry.speed, seated, groove });
    }
    animateGround(now);
    followCamera(dt);
    renderer.render(scene, camera);
    placeTags(container.clientWidth, container.clientHeight);
    reportScreen();
  }
  requestAnimationFrame(frame);

  // ---------- ซูม: ล้อเมาส์ / ถ่างสองนิ้ว / ปุ่ม + − ----------
  function setZoom(next) {
    zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    placeCamera();
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); // ไม่งั้นหน้าเว็บเลื่อนไปด้วย
    setZoom(zoom * Math.exp(e.deltaY * 0.0012));
  }, { passive: false });
  const touches = new Map(); // pointerId → {x, y}
  let pinchFrom = null; // { dist, zoom } ตอนเริ่มถ่างนิ้ว
  const pinchDist = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) pinchFrom = { dist: pinchDist(), zoom };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchFrom && touches.size === 2) {
      downAt = null; // กำลังถ่างนิ้ว → ปล่อยนิ้วแล้วอย่านับเป็นแตะเพื่อเดิน
      setZoom(pinchFrom.zoom * (pinchFrom.dist / Math.max(1, pinchDist())));
    }
  });
  const endTouch = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinchFrom = null;
  };
  canvas.addEventListener('pointerup', endTouch);
  canvas.addEventListener('pointercancel', endTouch);

  // ---------- input: แตะพื้น = เดิน · แตะที่นั่ง = ไปนั่ง ----------
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

  // ---------- คีย์บอร์ด: รับทั้งหน้าเว็บ ไม่ต้องคลิกที่ลานก่อน ----------
  // ยกเว้น: กำลังพิมพ์ / โฟกัสอยู่ที่ตัวควบคุมที่ใช้ปุ่มเหล่านี้เอง
  const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS']);
  const zoomIn = () => setZoom(zoom / ZOOM_STEP);
  const zoomOut = () => setZoom(zoom * ZOOM_STEP);
  const ACTION_KEYS = {
    Space: () => gesture('jump'),
    KeyF: () => gesture('punch'),
    KeyE: toggleSit,
    KeyG: dropHeld,
    Equal: zoomIn, // ปุ่ม = / + ข้าง backspace
    NumpadAdd: zoomIn,
    Minus: zoomOut,
    NumpadSubtract: zoomOut,
  };
  const isTyping = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const ownsArrows = (t) => t instanceof HTMLElement && Boolean(t.closest('[role="tablist"], [role="radiogroup"]'));
  const isButton = (t) => t instanceof HTMLElement && /^(BUTTON|A|SUMMARY)$/.test(t.tagName);
  const canControl = (e) => me() && onScreen && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target);
  // แตะปุ่มสั้นมาก (กด-ปล่อยจบก่อนเฟรมถัดไป) ต้องยังเดินได้ ≥ 1 ก้าว → ค้างปุ่มไว้อย่างน้อย MIN_HOLD_MS
  const MIN_HOLD_MS = 110;
  const pressedAt = new Map();
  const releaseTimers = new Map();

  window.addEventListener('keydown', (e) => {
    running = e.shiftKey;
    if (!canControl(e)) return;
    if (MOVE_KEYS.has(e.code)) {
      if (ownsArrows(e.target)) return;
      clearTimeout(releaseTimers.get(e.code)); // กดซ้ำเร็วๆ อย่าให้การปล่อยครั้งก่อนมาตัด
      if (!keys.has(e.code)) pressedAt.set(e.code, performance.now());
      keys.add(e.code);
    } else if (ACTION_KEYS[e.code]) {
      if (e.code === 'Space' && isButton(e.target)) return; // Space บนปุ่ม = กดปุ่มตามปกติ
      if (!e.repeat) ACTION_KEYS[e.code]();
    } else return;
    e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    running = e.shiftKey;
    const held = performance.now() - (pressedAt.get(e.code) ?? 0);
    if (held >= MIN_HOLD_MS) keys.delete(e.code);
    else releaseTimers.set(e.code, setTimeout(() => keys.delete(e.code), MIN_HOLD_MS - held));
  });
  const releaseKeys = () => {
    keys.clear();
    running = false;
  };
  window.addEventListener('blur', releaseKeys);
  document.addEventListener('visibilitychange', releaseKeys);

  return {
    // ใช้ตอน ?debug=1: ดูตำแหน่งตัวละครทุกตัว
    debug: () => [...avatars.entries()].map(([id, e]) => ({ id, me: id === myId, x: +e.pos.x.toFixed(2), z: +e.pos.z.toFixed(2), ry: +e.ry.toFixed(2), sit: e.sit, held: e.av.held(), dancing: Boolean(e.dancing) })),
    debugItems: () => [...ground.entries()].map(([id, g]) => ({ id, kind: g.kind, x: g.x, z: g.z })),
    // รายชื่อทั้งห้อง (ตอนเข้าห้อง/ต่อใหม่) — ล้างของเก่าทิ้งแล้ววาดใหม่หมด
    reset(list, you, items = []) {
      for (const id of [...avatars.keys()]) remove(id);
      myId = you;
      lastSent = '';
      list.forEach(add);
      setItems(items);
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
    setItems,
    setHeld,
    dropHeld,
    gesture,
    toggleSit,
    setMyLook(look) {
      me()?.av.setLook(look);
    },
    setScreen(title, isPlaying) {
      music = isPlaying;
      screenTitle = title;
      drawScreen(title, isPlaying, mvOn, beats);
    },
    // app.js วาง/เอาตัวเล่น YouTube ออกจากจอเวที → สลับจอระหว่างแบบตัวหนังสือกับแบบ EQ ข้างวิดีโอ
    setMv(on) {
      if (mvOn === on) return;
      mvOn = on;
      drawScreen(screenTitle, music, on, beats);
    },
    zoomBy(step) {
      setZoom(zoom * step);
    },
  };
}
