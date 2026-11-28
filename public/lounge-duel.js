// ลานประลอง 1v1 ฝั่งหน้าเว็บ: วาดลาน + ลูกธนู/ลูกไฟ + แถบเลือด/สตามินา + ช่องอาวุธ 1/2 + ป้ายแพ้ชนะ
// ท่าของเรา (ตี/บล็อก/กลิ้ง/สลับอาวุธ) เล่นทันทีในเครื่อง แล้วค่อยบอก server · server ตัดสินสตามินา/ดาเมจจริง
// สตามินาใช้แค่กลิ้ง · แดชปิดไว้ (DASH_ENABLED ใน arena-rules.js)
// server ตัดสินดาเมจเอง หน้าเว็บมีหน้าที่ "โชว์" + ส่งตำแหน่ง/การกดโจมตีของเรา
// ลานอยู่ในฉากเดียวกับลานฟังเพลงแต่ไกลออกไป (ARENA_ORIGIN) → หมอกบังลานฟังเพลงให้เอง ไม่ต้องสร้างฉากใหม่
// พิกัดที่ส่งกับ server = พิกัดในลาน (กลางลาน 0,0) · ในฉาก = บวก ARENA_ORIGIN
import * as THREE from 'three';
import { buildItem, animateItem } from './lounge-items.js';
import {
  ARENA_HALF, ARENA_MAPS, BLOCK_MOVE, BODY_RADIUS, clampArena, DASH_DIST, DASH_ENABLED, DASH_MS, HP_MAX, inPillar, obstaclesOf, POTION, RESULT_MS,
  ROLL_DIST, ROLL_MS, STAMINA, SWAP_MS, WEAPON_KINDS, WEAPONS,
} from './arena-rules.js';
import { labelOf, mouseSwapped } from './keybinds.js';

export const ARENA_ORIGIN = { x: 0, z: 150 };
const AIM_ASSIST = Math.cos((60 * Math.PI) / 180); // คู่อยู่ในมุม ±60° จากที่หัน → หันไปหาคู่ให้เอง
const DMG_FLOAT_MS = 900;
const TIP_MS = 2600; // คำอธิบายอาวุธตอนสลับ โชว์แป๊บเดียวพอ
const FACE_HOLD_MS = 260; // หลังโดนจริงแล้วยังหันทางที่ฟันอีกแป๊บ (ไม่งั้นเดินตีแล้วตัวหมุนกลับทางเดินกลางท่า)
const LOW_STAMINA = STAMINA.roll; // ต่ำกว่านี้ = กลิ้งไม่ได้ → แถบเปลี่ยนสีเตือน
export const ARENA_SPEED = 4.2; // ในลานไม่มีวิ่ง → เดินเร็วกว่าลานฟังเพลงนิดนึง
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// ท่าตีทุกแบบ (ใช้กันท่าสะดุ้งมาทับกลางท่า)
const ATTACK_ANIMS = new Set(['jab', 'slash', 'stab', 'slam', 'shoot', 'cast']);
// ขอบจอแดงเมื่อเลือดเราเหลือไม่ถึงเท่านี้ (สัดส่วนของเลือดเต็ม) · ต่ำกว่า CRITICAL = แดงเต้นเป็นจังหวะ
const LOW_HP = 0.35;
const CRITICAL_HP = 0.15;
// ท่าปิดเกม (น็อกเท่านั้น): ผู้ชนะพุ่งไปยืนข้างผู้แพ้ → กระโดดทุบ → ผู้แพ้ล้ม → ค่อยขึ้นป้ายผล
// ทั้งสองเครื่องเล่นเองจาก duel:end (ไม่ต้องรอ server ส่งตำแหน่ง) จึงเห็นเหมือนกันทั้งสองฝั่ง
const FINISH = { gap: 1.1, approachMin: 220, approachMax: 520, sec: 1.5, hitAt: 0.62, bannerAfter: 750 };

const toWorld = (x, z) => ({ x: x + ARENA_ORIGIN.x, z: z + ARENA_ORIGIN.z });
const toLocal = (x, z) => ({ x: x - ARENA_ORIGIN.x, z: z - ARENA_ORIGIN.z });

// สิ่งกีดขวางของแผนที่ที่กำลังสู้ (เปลี่ยนทุกแมตช์ตามที่ server สุ่ม)
let obstacles = obstaclesOf('stone');

// หน้าตาแต่ละแผนที่: สีพื้นสลับ 2 สี + วงกลาง · กำแพง · สิ่งกีดขวาง · ของบนหัวสิ่งกีดขวาง · ฝุ่นตอนวิ่ง
// ลานหิน = ม่วงเทาเดิม · ซากปราสาท = ทรายส้ม หินทรายแตกๆ · ทุ่งหิมะ = ขาวฟ้า หินมีหิมะคลุม
const MAP_THEMES = {
  stone: { tiles: [0x5a6988, 0x4a5675], center: 0xb55088, wall: 0x3a4466, block: 0x8b9bb4, cap: 0xfeae34, trim: 0xfeae34, base: 0x262b44, dust: 0x8b9bb4, capStyle: 'slab' },
  ruins: { tiles: [0xc28569, 0xb07258], center: 0xe4a672, wall: 0x8f563b, block: 0xd9a066, cap: 0xbe7d50, trim: 0x733e39, base: 0x3e2731, dust: 0xe4a672, capStyle: 'broken' },
  snow: { tiles: [0xe8f1ff, 0xd4e3f5], center: 0x8bd3e6, wall: 0x9badb7, block: 0x6b7a99, cap: 0xffffff, trim: 0x8bd3e6, base: 0x5a6988, dust: 0xffffff, capStyle: 'snow' },
};

// พื้นดินของลาน (หน้าตาเดียวกับของลานฟังเพลง ให้ lounge.js สลับใช้แทนกันได้)
export const ARENA_LAND = {
  clampX: (x) => ARENA_ORIGIN.x + clampArena(x - ARENA_ORIGIN.x),
  clampZ: (z) => ARENA_ORIGIN.z + clampArena(z - ARENA_ORIGIN.z),
  supportAt: () => 0,
  groundAt: () => 0,
  blockedAt: (x, z) => inPillar(x - ARENA_ORIGIN.x, z - ARENA_ORIGIN.z, BODY_RADIUS, obstacles),
  push: (x, z) => [x, z],
  dust: 0x8b9bb4,
};

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// ---------- ฉากลาน ----------
function buildArena(scene, floor, map) {
  const theme = MAP_THEMES[map] ?? MAP_THEMES.stone;
  obstacles = obstaclesOf(map);
  ARENA_LAND.dust = theme.dust;
  const root = new THREE.Group();
  root.position.set(ARENA_ORIGIN.x, 0, ARENA_ORIGIN.z);
  scene.add(root);
  const size = ARENA_HALF * 2;
  // พื้นหินลายตาราง (กระเบื้อง 1×1 สลับสี) — InstancedMesh ก้อนเดียว
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.98, 0.2, 0.98), lambert(0xffffff), size * size);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let i = 0;
  for (let x = 0; x < size; x += 1) {
    for (let z = 0; z < size; z += 1) {
      m.makeTranslation(x - ARENA_HALF + 0.5, -0.1, z - ARENA_HALF + 0.5);
      tiles.setMatrixAt(i, m);
      const ring = Math.max(Math.abs(x - ARENA_HALF + 0.5), Math.abs(z - ARENA_HALF + 0.5));
      tiles.setColorAt(i, c.setHex(ring < 2 ? theme.center : theme.tiles[(x + z) % 2])); // วงกลางสีเด่น
      i += 1;
    }
  }
  tiles.receiveShadow = true;
  root.add(tiles);
  // แผ่นมองไม่เห็นไว้ให้คลิกเดิน
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ visible: false }));
  hit.rotation.x = -Math.PI / 2;
  root.add(hit);
  floor.push(hit);
  // กำแพงเตี้ยรอบลาน + ฐานใต้ลาน
  const wall = lambert(theme.wall);
  const trim = lambert(theme.trim);
  for (const [w, d, x, z] of [[size + 1, 0.5, 0, ARENA_HALF + 0.25], [size + 1, 0.5, 0, -ARENA_HALF - 0.25], [0.5, size, ARENA_HALF + 0.25, 0], [0.5, size, -ARENA_HALF - 0.25, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), wall);
    b.position.set(x, 0.25, z);
    b.castShadow = b.receiveShadow = true;
    root.add(b);
    const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.08, d + 0.02), trim);
    t.position.set(x, 0.72, z);
    root.add(t);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(size + 6, 1, size + 6), lambert(theme.base));
  base.position.y = -0.7;
  base.receiveShadow = true;
  root.add(base);
  // สิ่งกีดขวาง (ที่หลบลูกยิง) + ของบนหัวตามแผนที่ + คบไฟมุมลาน
  const blockMat = lambert(theme.block);
  const capMat = lambert(theme.cap);
  const add = (w, h, d, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  };
  for (const p of obstacles) {
    add(p.sx * 2, p.h, p.sz * 2, blockMat, p.x, p.h / 2, p.z);
    if (theme.capStyle === 'slab') add(p.sx * 2 + 0.2, 0.2, p.sz * 2 + 0.2, capMat, p.x, p.h, p.z);
    else if (theme.capStyle === 'snow') add(p.sx * 2 + 0.1, 0.18, p.sz * 2 + 0.1, capMat, p.x, p.h + 0.02, p.z);
    else { // ซากปราสาท: ยอดแตกเป็นก้อนเล็กไม่เท่ากัน + เศษหินตกข้างฐาน
      add(p.sx, 0.35, p.sz, capMat, p.x - p.sx / 2, p.h + 0.17, p.z - p.sz / 2);
      add(p.sx * 0.6, 0.6, p.sz * 0.6, blockMat, p.x + p.sx * 0.5, p.h + 0.3, p.z + p.sz * 0.4);
      add(0.3, 0.25, 0.3, capMat, p.x + p.sx + 0.3, 0.12, p.z - p.sz * 0.3);
    }
  }
  const flames = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const torch = buildItem('torch');
      torch.scale.setScalar(2);
      torch.position.set(sx * (ARENA_HALF + 0.25), 0.7, sz * (ARENA_HALF + 0.25));
      root.add(torch);
      flames.push(torch);
    }
  }
  return { root, flames, map, hit };
}

// ทิ้งลานเก่า (แมตช์ใหม่ได้แผนที่ต่างไป) · คืนหน่วยความจำการ์ดจอของ geometry ที่สร้างเฉพาะลานนี้
function disposeArena(scene, floor, arena) {
  scene.remove(arena.root);
  const at = floor.indexOf(arena.hit);
  if (at >= 0) floor.splice(at, 1);
  arena.root.traverse((o) => {
    if (o.isMesh && !arena.flames.some((f) => f === o || f.getObjectById(o.id))) o.geometry.dispose();
  });
}

// ---------- กล่องแถบเลือด (HTML ทับลาน) ----------
function buildHud(container) {
  const hud = document.createElement('div');
  hud.className = 'duel-hud';
  hud.hidden = true;
  hud.innerHTML = `
    <div class="duel-side" data-side="0"><b class="duel-name"></b><div class="duel-bar"><i></i></div><div class="duel-stam"><i></i></div><span class="duel-info"></span></div>
    <div class="duel-clock" aria-live="polite"></div>
    <div class="duel-side" data-side="1"><b class="duel-name"></b><div class="duel-bar"><i></i></div><div class="duel-stam"><i></i></div><span class="duel-info"></span></div>`;
  // ช่องอาวุธ + สตามินาของเรา (โชว์เฉพาะคนที่สู้อยู่)
  const kit = document.createElement('div');
  kit.className = 'duel-kit';
  kit.hidden = true;
  kit.innerHTML = `
    <div class="duel-status" aria-live="polite"></div>
    <div class="duel-kit-stam" role="meter" aria-label="สตามินา" aria-valuemin="0" aria-valuemax="${STAMINA.max}"><i></i></div>
    <div class="duel-slots">
      <div class="duel-slot" data-slot="0"><kbd>1</kbd><span></span><i class="cd"></i></div>
      <div class="duel-slot" data-slot="1"><kbd>2</kbd><span></span><i class="cd"></i></div>
      <div class="duel-potion"><kbd>E</kbd><span></span></div>
    </div>
    <div class="duel-practice" role="group" aria-label="เปลี่ยนอาวุธในมือ (โหมดลองอาวุธ)" hidden>
      ${WEAPON_KINDS.map((kind) => `<button type="button" class="duel-pick" data-kind="${kind}">${WEAPONS[kind].name}</button>`).join('')}
    </div>`;
  // ขอบจอแดงตอนเลือดใกล้หมด (อยู่ใต้แถบเลือด/ป้าย · ไม่รับคลิก)
  const vignette = document.createElement('div');
  vignette.className = 'duel-vignette';
  vignette.setAttribute('aria-hidden', 'true');
  // ขอบจอแดงวาบตอนเราโดนตี (คนละชั้นกับขอบแดงเลือดน้อย ที่ค้างตามเลือด · อันนี้วาบแล้วหาย)
  const hurt = document.createElement('div');
  hurt.className = 'duel-hurt';
  hurt.setAttribute('aria-hidden', 'true');
  const lockHint = document.createElement('div');
  lockHint.className = 'lock-hint';
  lockHint.hidden = true;
  const renderLockHint = () => (lockHint.textContent = `คลิกที่ลานเพื่อล็อกเมาส์ (เมาส์หมุนกล้อง ไม่หลุดขอบ) · ${labelOf('fullscreen')} = เต็มจอ`);
  renderLockHint();
  const banner = document.createElement('div');
  banner.className = 'duel-banner';
  banner.hidden = true;
  const tip = document.createElement('div');
  tip.className = 'duel-tip';
  tip.hidden = true;
  container.append(vignette, hurt, hud, banner, tip, kit, lockHint);
  const sides = [...hud.querySelectorAll('.duel-side')];
  return {
    hud, banner, tip, sides, kit, lockHint, renderLockHint, vignette, hurt,
    potion: kit.querySelector('.duel-potion'),
    practice: kit.querySelector('.duel-practice'),
    clock: hud.querySelector('.duel-clock'),
    status: kit.querySelector('.duel-status'),
    stam: kit.querySelector('.duel-kit-stam'),
    slots: [...kit.querySelectorAll('.duel-slot')],
  };
}

export function createDuel(ctx) {
  const { scene, floor, fx, camera, container, layer } = ctx;
  let arena = null; // สร้างตอนประลองครั้งแรก (คนที่ไม่เคยประลองไม่ต้องเสียเวลาสร้าง)
  const ui = buildHud(container);
  let match = null; // publicMatch ล่าสุดของแมตช์ที่เราสู้อยู่ (ไม่ได้สู้ = null)
  const active = new Map(); // แมตช์ที่กำลังสู้ในห้องตอนนี้: id → ไอดีคนสู้ (ไว้ซ่อนตัวคนที่ไปอยู่ในลาน)
  let phaseEndsAt = 0; // performance.now() ที่ช่วงปัจจุบันจะหมด
  let inArena = false; // เราเป็นคนสู้อยู่
  let saved = null; // ตำแหน่ง/ของในมือในลานฟังเพลงก่อนเข้าลาน
  let readyAt = 0;
  let readyFrom = 0; // เริ่มนับ cooldown ตอนไหน (ไว้วาดแถบในช่องอาวุธ)
  const shots = new Map(); // id → { mesh, vx, vz, until, kind }
  const floats = []; // ตัวเลขดาเมจลอย
  const stamina = new Map(); // id → สตามินาล่าสุด (server ส่งทุก 200 ms · ของเราลดเองทันทีตอนกด)
  let blocking = false; // ยกการ์ดอยู่ (ของเรา)
  let blockHeld = false; // ผู้เล่นยังกดปุ่มบล็อกค้างอยู่
  let stunUntil = 0; // การ์ดแตก มึน
  let busyUntil = 0; // กลิ้ง/แดชอยู่ ทำอย่างอื่นไม่ได้
  let motion = null; // { vx, vz, until } ความเร็วบังคับตอนกลิ้ง/แดช (lounge.js ใช้แทนปุ่มเดิน)
  let face = null; // { ry, until } ตีแล้วหันค้างทางที่ฟันจนจบท่า (lounge.js ค่อยๆ หมุนไปหา ไม่วาร์ป)
  let lockOn = false; // กด Tab ล็อกเป้า: ทุกท่าตีพุ่งไปทางคู่ต่อสู้เสมอ (กล้อง/การเดินคุมเองตามปกติ · Man ขอ 11-28 ไม่ให้ล็อกจอ)
  let lockRing = null; // วงแดงใต้เท้าเป้า (สร้างตอนล็อกครั้งแรก)
  let tipTimer = null;
  let bannerTimer = null;
  let drinkUntil = 0; // กำลังดื่มยาถึงเมื่อไหร่ (เดินช้า ตี/กลิ้ง/บล็อกไม่ได้)
  let pendingDrink = false; // ส่งดื่มยาไปแล้ว รอ server ยืนยัน (ปฏิเสธ = คืนขวด หยุดท่า)
  let finish = null; // ท่าปิดเกมที่กำลังเล่น { winId, loseId, start, swingAt, impactAt, bannerAt, ... }

  // ปุ่มเลือกอาวุธตอนซ้อม: คลิกแล้วปล่อยโฟกัสทันที (ไม่งั้น Space/Enter ไปกดปุ่มซ้ำแทนกระโดด/เต็มจอ)
  ui.practice.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    btn.blur();
    practicePick(btn.dataset.kind);
  });

  const fighterIds = () => (match ? match.fighters.map((f) => f.id) : []);
  const opponentId = () => fighterIds().find((id) => id !== ctx.myId());
  const myFighter = () => match?.fighters.find((f) => f.id === ctx.myId());

  function showBanner(text, ms, cls = '') {
    ui.banner.textContent = text;
    ui.banner.className = `duel-banner ${cls}`;
    ui.banner.hidden = false;
    clearTimeout(bannerTimer);
    if (ms) bannerTimer = setTimeout(() => (ui.banner.hidden = true), ms);
  }

  // ของในมือของคนสู้ตามที่ server บอก (หมัด = มือเปล่า)
  function syncHeld() {
    for (const f of match?.fighters ?? []) {
      const entry = ctx.avatars.get(f.id);
      const kind = f.weapon === 'fists' ? null : f.weapon;
      if (entry && entry.av.held() !== kind) entry.av.setHeld(kind);
      // การ์ดของคนอื่นมากับ state · ของเราใช้ค่าในเครื่อง (ตอบสนองทันที)
      if (entry && f.id !== ctx.myId()) entry.av.setGuard(Boolean(f.blocking));
    }
  }

  const myStamina = () => stamina.get(ctx.myId()) ?? STAMINA.max;
  const isStunned = (now) => now < stunUntil;
  function setMyStamina(v) {
    stamina.set(ctx.myId(), Math.max(0, v));
    renderStamina();
  }
  function setBlocking(on) {
    blocking = on;
    ctx.me()?.av.setGuard(on);
  }

  function showTip(text) {
    ui.tip.textContent = text;
    ui.tip.hidden = !text;
    clearTimeout(tipTimer);
    if (text) tipTimer = setTimeout(() => (ui.tip.hidden = true), TIP_MS);
  }
  function weaponTip(kind) {
    const info = WEAPONS[kind];
    if (info) showTip(`${info.name}: ${info.hint} · ✔ ${info.pro} · ✘ ${info.con}`);
  }

  // ---------- เข้า/ออกลาน ----------
  function enter() {
    const entry = ctx.me();
    if (!entry || inArena) return;
    if (arena && arena.map !== match.map) {
      disposeArena(scene, floor, arena);
      arena = null;
    }
    arena ??= buildArena(scene, floor, match.map);
    inArena = true;
    container.classList.add('is-dueling'); // ซ่อนคำแนะนำลานฟังเพลง (ทับกับคำแนะนำอาวุธ)
    saved = { x: entry.pos.x, y: entry.pos.y, z: entry.pos.z, ry: entry.ry, sit: entry.sit, held: entry.av.held() };
    ctx.setLand(ARENA_LAND);
    for (const f of match.fighters) {
      const e = ctx.avatars.get(f.id);
      if (!e) continue;
      const w = toWorld(f.pose.x, f.pose.z);
      e.sit = null;
      e.rest = null; // นั่งพื้น/นอนค้างไว้ก่อนเข้าลาน → ยืนขึ้นสู้
      e.pos.set(w.x, 0, w.z);
      e.viewY = 0;
      e.ry = f.pose.ry;
      e.target = { x: w.x, y: 0, z: w.z, ry: f.pose.ry };
      e.vel.x = e.vel.z = 0;
      e.vy = 0;
    }
    ctx.stopWalking();
    readyAt = 0;
    resetCombat();
    ui.kit.hidden = false;
    syncHeld();
    ctx.snapCamera(entry.ry);
  }

  function resetCombat() {
    blocking = false;
    blockHeld = false;
    stunUntil = 0;
    busyUntil = 0;
    drinkUntil = 0;
    pendingDrink = false;
    motion = null;
    setLockOn(false);
    ctx.me()?.av.setGuard(false);
  }

  // ---------- ล็อกเป้า ----------
  // ตำแหน่งเป้าที่ล็อกอยู่ (null = ไม่ได้ล็อก / ไม่มีคู่) · ใช้เล็งท่าตี + วาดวงแดงใต้เป้า
  function lockTarget() {
    if (!lockOn || !inArena) return null;
    return ctx.avatars.get(opponentId())?.pos ?? null;
  }
  function setLockOn(on) {
    lockOn = Boolean(on);
    if (lockRing) lockRing.visible = false;
  }
  function toggleLockOn() {
    if (!lockOn && !ctx.avatars.get(opponentId())) return flashStatus('ไม่มีเป้าให้ล็อก');
    setLockOn(!lockOn);
    flashStatus(lockOn ? `ล็อกเป้า · ${labelOf('lockon')} ปลด` : 'ปลดล็อกเป้า');
  }
  function updateLockRing(t) {
    const pos = lockTarget();
    if (!pos) {
      if (lockRing) lockRing.visible = false;
      return;
    }
    if (!lockRing) {
      // วงแหวนสองชั้น (ไม่มีแสง → เห็นชัดบนพื้นทุกสี) วางแบนบนพื้น
      lockRing = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0xe43b44, transparent: true, opacity: 0.85, depthWrite: false });
      for (const [r, w] of [[0.62, 0.07], [0.82, 0.04]]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 24), mat);
        ring.rotation.x = -Math.PI / 2;
        lockRing.add(ring);
      }
      scene.add(lockRing);
    }
    lockRing.visible = true;
    lockRing.position.set(pos.x, pos.y + 0.06, pos.z);
    lockRing.rotation.y = t * 1.6;
    lockRing.scale.setScalar(1 + Math.sin(t * 6) * 0.05);
  }

  function leave() {
    if (!inArena) return;
    inArena = false;
    container.classList.remove('is-dueling');
    ctx.releaseMouse();
    resetCombat();
    ui.kit.hidden = true;
    ui.lockHint.hidden = true;
    ctx.setLand(null);
    const entry = ctx.me();
    if (entry && saved) {
      entry.pos.set(saved.x, saved.y, saved.z);
      entry.viewY = saved.y;
      entry.ry = saved.ry;
      entry.vel.x = entry.vel.z = 0;
      entry.vy = 0;
      entry.av.setHeld(saved.held);
    }
    // คู่ต่อสู้: ตำแหน่งในลานฟังเพลงจะมากับ pose ถัดไป · ระหว่างนี้ซ่อนไว้ไม่ให้โผล่กลางอากาศ
    const other = ctx.avatars.get(opponentId());
    if (other) {
      other.av.setHeld(other.loungeHeld ?? null);
      other.av.setGuard(false);
    }
    saved = null;
    ctx.stopWalking();
    ctx.snapCamera();
    ctx.sendPoseNow();
    for (const s of shots.values()) scene.remove(s.mesh);
    shots.clear();
  }

  // ---------- เหตุการณ์จาก server ----------
  function setMatch(next) {
    match = next;
    const lengthLeft = next.msLeft ?? 0;
    phaseEndsAt = performance.now() + lengthLeft;
    for (const f of next.fighters) {
      const e = ctx.avatars.get(f.id);
      if (e && e.loungeHeld === undefined) e.loungeHeld = e.av.held(); // จำของที่ถือในลานฟังเพลงไว้คืนตอนจบ
      // ของเราลดเองในเครื่องอยู่แล้ว → รับค่าจาก state แค่ครั้งแรก (ค่าตรงอยู่แล้วจาก duel:stamina ทุก 200 ms)
      if (Number.isFinite(f.stamina) && (f.id !== ctx.myId() || !stamina.has(f.id))) stamina.set(f.id, f.stamina);
    }
    renderHud();
  }

  // NPC ไม่มีตัวในลานฟังเพลง → สร้างตัวชั่วคราวตอนเริ่ม ลบตอนจบ (เฉพาะคนที่สู้กับมัน)
  function spawnNpcs() {
    for (const f of match.fighters) {
      if (!f.npc || ctx.avatars.has(f.id)) continue;
      const w = toWorld(f.pose.x, f.pose.z);
      ctx.addAvatar({ id: f.id, name: `🤖 ${f.name}`, look: f.look, pose: { x: w.x, y: 0, z: w.z, ry: f.pose.ry }, held: null });
      ctx.avatars.get(f.id).loungeHeld = null;
    }
  }

  // ข้อความบอกปุ่ม (ตามที่ผู้เล่นตั้งไว้ · สลับเมาส์ซ้าย/ขวาแล้วก็บอกตาม)
  function controlsHint() {
    const [hit, guard] = mouseSwapped() ? ['คลิกขวา', 'คลิกซ้าย'] : ['คลิกซ้าย', 'คลิกขวา'];
    return `${hit}/${labelOf('attack')} ตี · ${guard}/${labelOf('block')} บล็อก · ${labelOf('roll')} กลิ้ง · ${labelOf('lockon')} ล็อกเป้า · ${labelOf('swap')}/${labelOf('slot1')}/${labelOf('slot2')} สลับอาวุธ · ${labelOf('fullscreen')} เต็มจอ`;
  }

  // แมตช์ใหม่ในห้อง: ของเรา = เข้าลาน · ของคนอื่น = แค่จำไว้ซ่อนตัวเขา + แจ้งในแชท (หลายคู่สู้พร้อมกันได้)
  function start(next) {
    track(next);
    if (!next.fighters.some((f) => f.id === ctx.myId())) {
      if (!next.practice) ctx.notice(`⚔️ ${next.fighters[0].name} ปะทะ ${next.fighters[1].name} ในลานประลอง`);
      return;
    }
    setMatch(next);
    ui.hud.hidden = false;
    spawnNpcs();
    enter();
    showBanner('READY?', 900);
    ctx.notice(next.practice
      ? `โหมดลองอาวุธ: ตีหุ่นได้เลย · กดปุ่มอาวุธด้านล่างเพื่อเปลี่ยนเป็นชิ้นไหนก็ได้ (ล็อกเมาส์อยู่ กด Esc ก่อน) · ${labelOf('heal')} ดื่มยา (ซ้อมไม่เสียขวด) · ไม่จับเวลา`
      : `ลาน${ARENA_MAPS[next.map]?.name.replace(/^ลาน/, '') ?? 'ประลอง'} · ${controlsHint()} · ${labelOf('heal')} ดื่มยา (${POTION.count} ขวด)`);
    weaponTip(myFighter()?.weapon);
  }
  // เข้าห้องตอนมีคนสู้อยู่: จำไว้เฉยๆ ไม่เด้งข้อความ
  function track(m) {
    active.set(m.id, m.fighters.map((f) => f.id));
  }

  function state(next) {
    if (!match || next.id !== match.id) return;
    const wasFight = match?.phase === 'fight';
    setMatch(next);
    if (inArena) syncHeld();
    if (next.phase === 'fight' && !wasFight && inArena) showBanner('FIGHT!', 900, 'is-go');
  }

  function hit(ev) {
    if (!match) return;
    const f = match.fighters.find((x) => x.id === ev.target);
    if (f) f.hp = ev.hp;
    if (Number.isFinite(ev.stamina)) stamina.set(ev.target, ev.stamina);
    renderHud();
    if (!inArena) return;
    const entry = ctx.avatars.get(ev.target);
    if (!entry) return;
    if (ev.blocked) {
      // บล็อกได้: ไม่สะดุ้ง ประกายสีเงินแทนเลือด
      floatText(entry, `บล็อก −${ev.dmg}`, 'is-blocked');
      const bx = entry.pos.x + Math.sin(entry.ry) * 0.5;
      const bz = entry.pos.z + Math.cos(entry.ry) * 0.5;
      fx.puff(bx, entry.viewY + 1.1, bz, { n: 8, spread: 2.2, up: 1.2, hex: 0xc0cbdc });
      fx.spark(bx, entry.viewY + 1.1, bz, { n: 10, speed: 6, hex: 0x9fdcff }); // ประกายฟ้าเงิน = ชนโล่/อาวุธ ไม่ใช่โดนเนื้อ
    } else {
      entry.av.flash();
      // กำลังตีอยู่ = แค่กะพริบ ไม่สะดุ้ง (เดิมท่าสะดุ้งทับท่าตีกลางคัน แขนวาร์ปกลับ ดูแปลก)
      if (!ATTACK_ANIMS.has(entry.av.gesture())) entry.av.play('flinch');
      floatText(entry, `-${ev.dmg}`);
      fx.puff(entry.pos.x, entry.viewY + 1, entry.pos.z, { n: 6, spread: 2, up: 1.5, hex: 0xe43b44 });
      // ดาเมจมาก ประกายเยอะและแรงกว่า (มีด 6 ≈ 9 ก้อน · ค้อน 32 ≈ 22 ก้อน)
      const heavy = Math.min(1, (ev.dmg || 0) / 32);
      fx.spark(entry.pos.x, entry.viewY + 1.05, entry.pos.z, { n: Math.round(8 + 14 * heavy), speed: 6 + 4 * heavy, hex: 0xfff1b0 });
    }
    // ภาพค้างแป๊บหนึ่งตอนตีเข้า (hit-stop) ให้รู้สึกว่าตีหนัก · ค้างแค่ท่าทาง/อนุภาค การเดินและ server ไม่หยุด
    if (!reducedMotion.matches) ctx.hitStop(ev.blocked ? 0.04 : 0.05 + 0.06 * Math.min(1, (ev.dmg || 0) / 32));
    if (ev.target === ctx.myId()) {
      if (!ev.blocked) flashHurt(ev.dmg);
      ctx.knockback(ev.kx, ev.kz, ev.knock);
      if (!reducedMotion.matches) ctx.shake(0.25);
    }
  }

  // โดนตี: ขอบจอแดงวาบ · ดาเมจมากวาบเข้มกว่า (มีด 6 จางๆ · ค้อน 32 เข้มสุด) · บล็อกได้ไม่วาบ จะได้รู้ว่ากันได้
  // ใช้ el.animate() ไม่ใช้ CSS animation: เครื่องที่ตั้งลดการเคลื่อนไหว CSS ทั้งเว็บปิด animation หมด (!important)
  // แต่การวาบสีจางลงไม่ใช่การเคลื่อนที่ และเป็นสัญญาณว่าโดนตี จึงต้องเห็นทุกเครื่อง
  let hurtAnim = null;
  function flashHurt(dmg) {
    hurtAnim?.cancel(); // โดนติดกันเร็วๆ เริ่มวาบใหม่ทุกที
    hurtAnim = ui.hurt.animate([{ opacity: Math.min(1, 0.45 + (dmg || 0) / 40) }, { opacity: 0 }], { duration: 450, easing: 'ease-out' });
  }

  function swing(ev) {
    if (!inArena || ev.id === ctx.myId()) return; // ท่าของเราเล่นไปแล้วตอนกด
    const entry = ctx.avatars.get(ev.id);
    entry?.av.setGuard(false); // ตีแล้ว server ลดการ์ดให้เอง
    playSwing(entry, ev.weapon, ev.windup, ev.ry);
  }

  // ท่าบล็อก/กลิ้ง/แดชของทุกคน (server ยืนยันแล้ว) · ของเราเล่นไปก่อนแล้ว เลยสนใจแค่ตอนโดนปฏิเสธ
  function act(ev) {
    if (!inArena) return;
    if (ev.id === ctx.myId()) {
      if (Number.isFinite(ev.stamina)) setMyStamina(ev.stamina);
      if (ev.act === 'denied') {
        motion = null; // สตามินาฝั่ง server ไม่พอ → หยุดพุ่ง
        if (pendingDrink) cancelDrink();
      }
      if (ev.act === 'block' && ev.on !== blocking) setBlocking(ev.on);
      if (ev.act === 'heal') {
        pendingDrink = false;
        const f = myFighter();
        if (f && Number.isFinite(ev.potions)) f.potions = ev.potions;
        renderHud();
      }
      return;
    }
    const entry = ctx.avatars.get(ev.id);
    if (!entry) return;
    if (ev.act === 'heal') {
      entry.av.setGuard(false);
      entry.av.play('drink', { sec: (ev.ms ?? POTION.ms) / 1000 });
    } else if (ev.act === 'block') entry.av.setGuard(ev.on);
    else if (ev.act === 'roll' || ev.act === 'dash') {
      entry.av.setGuard(false);
      entry.av.play(ev.act, { sec: ev.ms / 1000 + (ev.act === 'dash' ? 0.08 : 0) });
    }
  }

  // ดื่มยาเสร็จ (server): เลือดเข้า + ตัวเลขเขียวลอย + ประกายเขียว
  function healed(ev) {
    const f = match?.fighters.find((x) => x.id === ev.id);
    if (!f) return;
    f.hp = ev.hp;
    if (Number.isFinite(ev.potions)) f.potions = ev.potions;
    if (ev.id === ctx.myId()) {
      pendingDrink = false;
      drinkUntil = 0;
    }
    renderHud();
    const entry = inArena && ctx.avatars.get(ev.id);
    if (!entry) return;
    floatText(entry, `+${ev.gain}`, 'is-heal');
    fx.puff(entry.pos.x, entry.viewY + 1, entry.pos.z, { n: 10, spread: 1.6, up: 2, hex: 0x4ade80 });
    fx.rise(entry.pos.x, entry.viewY + 0.1, entry.pos.z, { n: 18, radius: 0.55, hex: 0x6af0a0 });
    fx.ring(entry.pos.x, entry.viewY, entry.pos.z, { hex: 0x4ade80, radius: 1.4, life: 0.55 });
  }

  function updateStamina(values) {
    for (const [id, v] of Object.entries(values ?? {})) stamina.set(id, v);
    renderStamina();
  }

  function dodge(ev) {
    const entry = inArena && ctx.avatars.get(ev.target);
    if (entry) floatText(entry, 'หลบ!', 'is-dodge');
  }


  function playSwing(entry, kind, windup, ry) {
    if (!entry) return;
    const weapon = WEAPONS[kind];
    // ไม่ตั้ง entry.ry ตรงๆ (ตัวจะวาร์ปหมุนในเฟรมเดียว) · คนอื่น = ตั้งเป้าแล้วให้ระบบเดิมหมุนตามนุ่มๆ
    if (entry.target) entry.target.ry = ry;
    entry.av.play(weapon.anim, { sec: windup / 1000 + 0.35, hitAt: windup / 1000 });
    if (weapon.type === 'slam') telegraph(entry, ry, weapon, windup);
    else if (weapon.type === 'melee') setTimeout(() => inArena && swingTrail(entry, weapon, kind, ry), windup);
  }

  // ---------- รอยฟัน: แสงจางๆ ตามแนวที่อาวุธกวาดผ่าน ให้เห็นชัดว่ากำลังตี + ระยะเท่าไหร่ ----------
  // แค่ภาพ ไม่ได้ใช้ตัดสินโดน (server ตัดสิน) · ขนาดตาม range/arc ของอาวุธจริง
  const TRAIL_LIFE = 0.26;
  const TRAIL_SWEEP = 0.35; // สัดส่วนอายุที่ใช้กวาดเสี้ยวจนเต็ม · ที่เหลือคือค่อยๆ จาง
  const TRAIL_SEGS = 18;
  const TRAIL_HEX = { sword: 0xeaf4ff, dagger: 0xc0cbdc, fists: 0xfee761, spear: 0x8fd3ff, shield: 0x63c7ff };
  const trails = [];
  function swingTrail(entry, weapon, kind, ry) {
    const hex = TRAIL_HEX[kind] ?? 0xffffff;
    // additive = ซ้อนแล้วสว่างขึ้นเหมือนแสงจริง · toneMapped: false ให้จ้าพอที่ bloom จะจับ
    const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mats = [glowMat(hex, 0.7), glowMat(0xffffff, 0.95)];
    const group = new THREE.Group();
    const meshes = [];
    const isStab = weapon.anim === 'stab';
    if (isStab) {
      // หอก: ลำแสงยาวตรงไปข้างหน้า (นอก = สีอาวุธ · ใน = แกนขาวบาง)
      const len = weapon.range - 0.4;
      for (const [w, mat] of [[0.12, mats[0]], [0.04, mats[1]]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, w, len), mat);
        m.userData.len = len;
        meshes.push(m);
      }
    } else {
      // ดาบ/มีด/หมัด/โล่: เสี้ยววงตามมุมที่ฟันได้ (หมุนให้กลางเสี้ยวอยู่หน้าตัว) · ขอบนอกมีเส้นขาวคมๆ
      const arc = THREE.MathUtils.degToRad(weapon.arc ?? 60);
      const r = weapon.range;
      for (const [r0, r1, mat] of [[r * 0.55, r, mats[0]], [r * 0.88, r * 0.97, mats[1]]]) {
        const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, TRAIL_SEGS, 1, -Math.PI / 2 - arc / 2, arc), mat);
        m.rotation.x = -Math.PI / 2;
        m.geometry.setDrawRange(0, 0); // เริ่มว่าง แล้วค่อยกวาดเพิ่มทีละช่อง (index เรียงตามมุม)
        meshes.push(m);
      }
    }
    for (const m of meshes) group.add(m);
    group.position.set(entry.pos.x, entry.viewY + 0.95, entry.pos.z);
    group.rotation.y = ry;
    if (weapon.anim === 'slash') group.rotation.z = 0.35; // ฟันเฉียง
    scene.add(group);
    trails.push({ group, mats, meshes, isStab, age: 0 });
    sweepTrail(trails[trails.length - 1], 0);
  }
  function tickTrails(dt) {
    for (let i = trails.length - 1; i >= 0; i -= 1) {
      const tr = trails[i];
      tr.age += dt;
      const k = tr.age / TRAIL_LIFE;
      sweepTrail(tr, Math.min(1, k / TRAIL_SWEEP));
      const fade = k < TRAIL_SWEEP ? 1 : 1 - (k - TRAIL_SWEEP) / (1 - TRAIL_SWEEP);
      tr.mats[0].opacity = 0.7 * fade;
      tr.mats[1].opacity = 0.95 * fade;
      tr.group.scale.setScalar(1 + 0.12 * k);
      if (k < 1) continue;
      scene.remove(tr.group);
      tr.group.traverse((o) => o.geometry?.dispose());
      for (const m of tr.mats) m.dispose();
      trails.splice(i, 1);
    }
  }
  // กวาดรอยฟันถึงสัดส่วน p (0..1): เสี้ยววง = เพิ่มช่องที่วาด · หอก = ยืดลำแสงออกไปข้างหน้า
  function sweepTrail(tr, p) {
    const e = 1 - (1 - p) ** 2; // ออกตัวเร็วแล้วชะลอ เหมือนแรงเหวี่ยง
    for (const m of tr.meshes) {
      if (tr.isStab) {
        const len = m.userData.len;
        m.scale.z = Math.max(0.01, e);
        m.position.z = 0.4 + (len * e) / 2;
      } else {
        m.geometry.setDrawRange(0, Math.ceil(TRAIL_SEGS * e) * 6); // 1 ช่อง = 2 สามเหลี่ยม = 6 index
      }
    }
  }

  // ค้อน: วงแดงบนพื้นตรงที่จะทุบ ให้อีกฝ่ายเห็นแล้วหลบ/กระโดดทัน
  function telegraph(entry, ry, weapon, windup) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(weapon.radius - 0.15, weapon.radius, 24, 1),
      new THREE.MeshBasicMaterial({ color: 0xe43b44, transparent: true, opacity: 0.8, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    const cx = entry.pos.x + Math.sin(ry) * weapon.range;
    const cz = entry.pos.z + Math.cos(ry) * weapon.range;
    ring.position.set(cx, 0.04, cz);
    scene.add(ring);
    setTimeout(() => {
      scene.remove(ring);
      if (inArena) fx.puff(cx, 0, cz, { n: 14, spread: 3.2, up: 1.4, hex: 0xc0cbdc });
      if (inArena && !reducedMotion.matches) ctx.shake(0.12);
    }, windup);
  }

  function shot(ev) {
    if (!inArena) return;
    const w = toWorld(ev.x, ev.z);
    const isFire = ev.kind === 'staff';
    const mesh = isFire
      ? new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), new THREE.MeshBasicMaterial({ color: 0xf77622 }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mesh.position.set(w.x, ev.y, w.z);
    mesh.rotation.y = Math.atan2(ev.vx, ev.vz);
    scene.add(mesh);
    shots.set(ev.id, { mesh, vx: ev.vx, vz: ev.vz, until: performance.now() + ev.life * 1000 + 200, isFire });
  }

  function shotEnd(ev) {
    const s = shots.get(ev.id);
    if (!s) return;
    scene.remove(s.mesh);
    shots.delete(ev.id);
    const w = toWorld(ev.x, ev.z);
    fx.puff(w.x, s.mesh.position.y - 0.4, w.z, { n: s.isFire ? 12 : 3, spread: s.isFire ? 2.6 : 1, up: 1.2, hex: s.isFire ? 0xf77622 : 0xc0cbdc });
  }

  function end(ev) {
    const why = { ko: 'น็อก!', time: 'หมดเวลา', left: 'อีกฝ่ายออกจากห้อง' }[ev.reason] ?? '';
    if (!match || ev.matchId !== match.id) { // แมตช์ของคนอื่น
      ctx.notice(ev.winner ? `🏆 ${ev.winner} ชนะการประลอง (${why})` : 'การประลองจบลงด้วยผลเสมอ');
      return;
    }
    match.phase = 'over';
    match.winner = ev.winner;
    phaseEndsAt = performance.now() + RESULT_MS;
    const wins = Object.entries(ev.wins ?? {}).map(([name, n]) => `${name} ${n}`).join(' · ');
    setLockOn(false);
    if (inArena) {
      // ป้ายผลกลางจอใช้ภาษาอังกฤษแบบเกมต่อสู้ (Man ขอ) · ข้อความแจ้งในแชทยังเป็นไทย
      const whyEn = { ko: 'K.O.!', time: 'TIME UP', left: 'OPPONENT LEFT' }[ev.reason] ?? '';
      const text = ev.winner === null ? 'DRAW' : ev.winnerId === ctx.myId() ? 'YOU WIN' : 'YOU LOSE';
      // ป้ายผลแบบเล็ก: บรรทัดเดียวใต้แถบเลือด + จำนวนชนะตัวเล็ก (Man 11-28: ป้ายเดิมใหญ่ บังฉากท่าปิดเกม)
      const result = () => {
        showBanner(whyEn ? `${text} · ${whyEn}` : text, 0, `is-result ${ev.winnerId === ctx.myId() ? 'is-win' : 'is-lose'}`);
        if (!wins) return;
        const small = document.createElement('small');
        small.textContent = `WINS ${wins}`;
        ui.banner.append(small);
      };
      // น็อก = เล่นท่าปิดเกมก่อน แล้วค่อยขึ้นป้ายผล · หมดเวลา/อีกฝ่ายออก = ขึ้นป้ายเลย
      const loseId = fighterIds().find((id) => id !== ev.winnerId);
      if (!(ev.reason === 'ko' && ev.winnerId && startFinisher(ev.winnerId, loseId, result))) result();
    } else {
      ctx.notice(ev.winner ? `🏆 ${ev.winner} ชนะการประลอง (${why})` : `การประลองจบลงด้วยผลเสมอ`);
    }
    renderHud();
  }

  // ev.matchId = ปิดแมตช์ไหน · ไม่ส่ง = ล้างทั้งหมด (ต่อ socket ใหม่)
  function close(ev) {
    if (ev?.matchId === undefined) active.clear();
    else {
      active.delete(ev.matchId);
      if (ev.matchId !== match?.id) return; // แมตช์คนอื่นปิด → แค่เลิกซ่อนตัวเขา
    }
    for (const f of match?.fighters ?? []) ctx.avatars.get(f.id)?.av.stop(); // ล้มน็อกค้างอยู่ → ลุกก่อนกลับลานฟังเพลง
    finish = null;
    leave();
    for (const f of match?.fighters ?? []) {
      if (f.npc) ctx.removeAvatar(f.id);
      const e = ctx.avatars.get(f.id);
      if (e) delete e.loungeHeld;
    }
    renderVignette(null);
    match = null;
    ui.hud.hidden = true;
    ui.banner.hidden = true;
    ui.tip.hidden = true;
    stamina.clear();
  }

  function pose({ id, x, y, z, ry }) {
    const entry = ctx.avatars.get(id);
    if (!entry || !inArena) return;
    const w = toWorld(x, z);
    entry.target = { x: w.x, y, z: w.z, ry };
  }

  // ---------- การกดของเรา ----------
  const canAct = (now) => inArena && match?.phase === 'fight' && !isStunned(now) && now >= busyUntil;

  // ตี: เช็ค cooldown ในเครื่องก่อน (กดรัวไม่ส่งรัว) · คู่อยู่ใกล้ทิศที่หัน → หันไปหาให้ · ไม่ใช้สตามินา
  // ยกการ์ดอยู่ตีไม่ได้ ต้องปล่อยการ์ดก่อน (เหมือนเกมต่อสู้ทั่วไป และกันการ์ดค้างผิดจังหวะกับ server)
  function attack() {
    const entry = ctx.me();
    const f = myFighter();
    const now = performance.now();
    if (!entry || !f || !canAct(now) || blocking || now < readyAt) return;
    const weapon = WEAPONS[f.weapon];
    let ry = entry.ry;
    const other = ctx.avatars.get(opponentId());
    const locked = lockTarget();
    if (locked) ry = Math.atan2(locked.x - entry.pos.x, locked.z - entry.pos.z); // ล็อกเป้า = ตีใส่เป้าเสมอ
    else if (other) {
      const dx = other.pos.x - entry.pos.x;
      const dz = other.pos.z - entry.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && (Math.sin(ry) * dx + Math.cos(ry) * dz) / d >= AIM_ASSIST) ry = Math.atan2(dx, dz);
    }
    readyFrom = now;
    readyAt = now + weapon.cooldown;
    face = { ry, until: now + weapon.windup + FACE_HOLD_MS };
    playSwing(entry, f.weapon, weapon.windup, ry);
    ctx.send.attack(ry);
  }

  // บล็อก (คลิกขวา/X ค้าง): ยกการ์ดทันทีในเครื่อง · server ยืนยัน/ปฏิเสธทีหลัง
  function block(on) {
    blockHeld = on;
    const now = performance.now();
    if (on && !canAct(now)) return;
    if (!inArena || on === blocking) return;
    setBlocking(on);
    ctx.send.act('block', on);
  }

  // กลิ้ง (/ แดชถ้าเปิด): พุ่งไปทางปุ่มเดินที่กดอยู่ ไม่กด = ไปทางที่หัน
  function evade(type) {
    const entry = ctx.me();
    const now = performance.now();
    if (!entry || !canAct(now) || (type === 'dash' && !DASH_ENABLED)) return;
    const cost = STAMINA[type];
    if (myStamina() < cost) return flashStatus('สตามินาไม่พอ');
    const ms = type === 'roll' ? ROLL_MS : DASH_MS;
    const speed = (type === 'roll' ? ROLL_DIST : DASH_DIST) / (ms / 1000);
    const dir = ctx.moveDir() ?? { x: Math.sin(entry.ry), z: Math.cos(entry.ry) };
    motion = { vx: dir.x * speed, vz: dir.z * speed, until: now + ms };
    busyUntil = now + ms;
    if (blocking) setBlocking(false); // server ลดการ์ดให้เองตอนกลิ้ง/แดช
    setMyStamina(myStamina() - cost);
    entry.av.play(type, { sec: ms / 1000 + (type === 'dash' ? 0.08 : 0) });
    ctx.send.act(type);
  }

  // สลับอาวุธ: slot 0/1 · ไม่ส่ง = สลับไปอีกอัน · ต้องรอ SWAP_MS ก่อนตีได้
  function swapTo(slot) {
    const f = myFighter();
    const now = performance.now();
    if (!f?.loadout || !inArena || match.phase === 'over' || isStunned(now) || now < busyUntil) return;
    const next = slot ?? 1 - f.slot;
    if (next === f.slot) return;
    f.slot = next;
    f.weapon = f.loadout[next];
    if (readyAt < now + SWAP_MS) {
      readyFrom = now;
      readyAt = now + SWAP_MS;
    }
    syncHeld();
    renderHud();
    weaponTip(f.weapon);
    ctx.send.swap(next);
    // server ลดการ์ดตอนสลับ → ยังกดบล็อกค้างอยู่ก็ยกใหม่ให้
    if (blocking) {
      setBlocking(false);
      if (blockHeld) block(true);
    }
  }

  // ดื่มยา: ขวดลดทันทีในเครื่อง (ซ้อม = ไม่ลด) · ระหว่างดื่มเดินช้า ตี/กลิ้ง/บล็อก/สลับอาวุธไม่ได้ (busyUntil)
  // เลือดเข้าตอนดื่มเสร็จ (server ส่ง duel:healed) · เลือดเต็ม/ยาหมด = บอกแล้วไม่ทำ (กันกดพลาดเสียขวด)
  function drink() {
    const entry = ctx.me();
    const f = myFighter();
    const now = performance.now();
    if (!entry || !f || !canAct(now)) return;
    if (!(f.potions > 0)) return flashStatus('ยาหมดแล้ว');
    if (f.hp >= HP_MAX) return flashStatus('เลือดเต็มอยู่แล้ว');
    if (blocking) setBlocking(false);
    drinkUntil = now + POTION.ms;
    busyUntil = Math.max(busyUntil, drinkUntil);
    pendingDrink = true;
    if (!match.practice) f.potions -= 1;
    entry.av.play('drink', { sec: POTION.ms / 1000 });
    renderHud();
    ctx.send.act('heal');
  }
  // server ไม่ให้ดื่ม (จังหวะในเครื่องกับ server ต่างกันนิดนึง) → คืนขวด หยุดท่า ขยับได้ทันที
  function cancelDrink() {
    pendingDrink = false;
    const f = myFighter();
    if (f && !match.practice) f.potions += 1;
    if (drinkUntil > performance.now()) {
      busyUntil = drinkUntil = 0;
      ctx.me()?.av.stop();
      flashStatus('ดื่มยาไม่ได้ตอนนี้');
    }
    renderHud();
  }

  // โหมดลองอาวุธ: เปลี่ยนอาวุธในมือเป็นชิ้นไหนก็ได้ · ทำแบบเดียวกับ server ในเครื่องก่อน (ตอบสนองทันที) แล้ว duel:state มายืนยัน
  function practicePick(kind) {
    const f = myFighter();
    const now = performance.now();
    if (!match?.practice || !inArena || match.phase !== 'fight' || !f?.loadout || !WEAPONS[kind]) return;
    if (!canAct(now)) return flashStatus('รอจบท่าก่อน');
    if (f.weapon === kind) return weaponTip(kind);
    const other = 1 - f.slot;
    if (f.loadout[other] === kind) f.loadout = f.slot === 0 ? [kind, f.loadout[0]] : [f.loadout[1], kind];
    else f.loadout = f.loadout.map((k, i) => (i === f.slot ? kind : k));
    f.weapon = kind;
    if (readyAt < now + SWAP_MS) {
      readyFrom = now;
      readyAt = now + SWAP_MS;
    }
    if (blocking) setBlocking(false);
    syncHeld();
    renderHud();
    weaponTip(kind);
    ctx.send.practiceWeapon(kind);
  }

  // ท่าปิดเกม: คืน false = เล่นไม่ได้ (ไม่มีตัวใดตัวหนึ่ง) ให้ขึ้นป้ายผลเลย
  function startFinisher(winId, loseId, showResult) {
    const win = ctx.avatars.get(winId);
    const lose = ctx.avatars.get(loseId);
    if (!win || !lose) return false;
    const dx = win.pos.x - lose.pos.x;
    const dz = win.pos.z - lose.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    // จุดยืนข้างผู้แพ้ ฝั่งเดียวกับที่ผู้ชนะยืนอยู่ (ไม่ต้องเดินอ้อม) · ไกลมาก (ธนู) ก็พุ่งไปเร็วขึ้น ไม่ช้าลง
    const tx = lose.pos.x + (dx / d) * FINISH.gap;
    const tz = lose.pos.z + (dz / d) * FINISH.gap;
    const ry = Math.atan2(lose.pos.x - tx, lose.pos.z - tz);
    const approach = Math.min(FINISH.approachMax, Math.max(FINISH.approachMin, Math.abs(d - FINISH.gap) * 60));
    const now = performance.now();
    const me = ctx.myId();
    if (winId === me) {
      const s = approach / 1000;
      motion = { vx: (tx - win.pos.x) / s, vz: (tz - win.pos.z) / s, until: now + approach };
      face = { ry, until: now + RESULT_MS };
    } else win.target = { x: tx, y: 0, z: tz, ry };
    // ผู้แพ้หันมาหาผู้ชนะ (ตัวเราเองหันด้วย face · ตัวอื่นหันผ่าน target)
    const loseRy = Math.atan2(tx - lose.pos.x, tz - lose.pos.z);
    if (loseId === me) face = { ry: loseRy, until: now + RESULT_MS };
    else lose.target = { x: lose.pos.x, y: lose.pos.y, z: lose.pos.z, ry: loseRy };
    win.av.setGuard(false);
    lose.av.setGuard(false);
    const swingAt = now + approach;
    const impactAt = swingAt + FINISH.sec * FINISH.hitAt * 1000;
    finish = { winId, loseId, swingAt, impactAt, bannerAt: impactAt + FINISH.bannerAfter, showResult, swung: false, hit: false, shown: false };
    return true;
  }
  function tickFinisher(now) {
    if (!finish) return;
    const win = ctx.avatars.get(finish.winId);
    const lose = ctx.avatars.get(finish.loseId);
    if (!finish.swung && now >= finish.swingAt) {
      finish.swung = true;
      win?.av.play('finisher', { sec: FINISH.sec, hitAt: FINISH.sec * FINISH.hitAt });
    }
    if (!finish.hit && now >= finish.impactAt) {
      finish.hit = true;
      if (lose) {
        lose.av.flash();
        lose.av.play('ko', { hold: true });
        fx.puff(lose.pos.x, lose.viewY + 0.4, lose.pos.z, { n: 26, spread: 4, up: 2.4, hex: 0xfeae34 });
        fx.puff(lose.pos.x, lose.viewY + 0.1, lose.pos.z, { n: 14, spread: 3, up: 0.8, hex: 0xc0cbdc });
        fx.spark(lose.pos.x, lose.viewY + 1, lose.pos.z, { n: 40, speed: 11, hex: 0xffd27a, size: 1.4, life: 0.35 });
        fx.rise(lose.pos.x, lose.viewY + 0.3, lose.pos.z, { n: 24, radius: 0.4, up: 2.2, hex: 0xdfe8ff, life: 1.4 });
        fx.ring(lose.pos.x, lose.viewY, lose.pos.z, { hex: 0xfeae34, radius: 3.2, life: 0.7 });
      }
      if (!reducedMotion.matches) {
        ctx.shake(0.45);
        ctx.hitStop(0.22); // ท่าปิดเกมค้างนานกว่าตีปกติ ให้เป็นช็อตสำคัญ
      }
      showBanner('FINISH!', FINISH.bannerAfter, 'is-finish');
    }
    if (!finish.shown && now >= finish.bannerAt) {
      finish.shown = true;
      finish.showResult();
    }
  }
  // กล้องระหว่างท่าปิดเกม: มองกึ่งกลางสองคน · axis = ทิศเส้นที่ลากระหว่างสองคน (lounge.js หมุนกล้องไปด้านข้างเส้นนี้)
  function cinematic() {
    if (!finish || !inArena) return null;
    const a = ctx.avatars.get(finish.winId);
    const b = ctx.avatars.get(finish.loseId);
    if (!a || !b) return null;
    return {
      x: (a.pos.x + b.pos.x) / 2,
      y: Math.min(a.viewY, b.viewY),
      z: (a.pos.z + b.pos.z) / 2,
      axis: Math.atan2(a.pos.x - b.pos.x, a.pos.z - b.pos.z),
    };
  }

  // ปุ่มคีย์บอร์ดในลาน · action = ชื่อท่าจาก keybinds.js (lounge.js แปลงจากปุ่มที่ผู้เล่นตั้งไว้)
  // คืน true = ลานจัดการแล้ว (lounge.js ไม่ต้องทำต่อ) · เดิน/กระโดด คืน false ให้ lounge.js ทำตามปกติ
  function key(action, down, repeat) {
    if (!inArena) return false;
    const press = down && !repeat;
    switch (action) {
      // case 'dash': // ปิดไว้ก่อน (Man ขอ 2026-11-27) · เปิดกลับ: DASH_ENABLED + เพิ่มท่า dash ใน keybinds.js
      //   if (press) evade('dash');
      //   return true;
      case 'attack':
        if (press) attack();
        return true;
      case 'roll':
        if (press) evade('roll');
        return true;
      case 'block':
        if (!repeat) block(down);
        return true;
      case 'swap':
        if (press) swapTo();
        return true;
      case 'heal':
        if (press) drink();
        return true;
      case 'lockon':
        if (press) toggleLockOn();
        return true;
      case 'slot1':
      case 'slot2':
        if (press) swapTo(action === 'slot1' ? 0 : 1);
        return true;
      default:
        return false;
    }
  }

  // ความเร็วบังคับตอนกลิ้ง/แดช (หมดเวลาแล้วคืน null)
  function currentMotion(now) {
    if (motion && now >= motion.until) motion = null;
    return motion;
  }

  // ---------- ตัวเลขดาเมจ/ข้อความลอยขึ้นจากหัว ----------
  function floatText(entry, text, cls = '') {
    const node = document.createElement('div');
    node.className = `duel-dmg ${cls}`;
    node.textContent = text;
    layer.append(node);
    floats.push({ node, entry, born: performance.now() });
  }
  const point = new THREE.Vector3();
  function updateFloats(now) {
    const w = container.clientWidth;
    const h = container.clientHeight;
    for (let i = floats.length - 1; i >= 0; i -= 1) {
      const f = floats[i];
      const k = (now - f.born) / DMG_FLOAT_MS;
      if (k >= 1) {
        f.node.remove();
        floats.splice(i, 1);
        continue;
      }
      point.set(f.entry.pos.x, f.entry.viewY + 2.3 + k * 0.8, f.entry.pos.z).project(camera);
      f.node.style.transform = `translate(${((point.x + 1) / 2) * w}px, ${((1 - point.y) / 2) * h}px)`;
      f.node.style.opacity = String(1 - k * k);
    }
  }

  // ---------- แถบเลือด ----------
  function renderHud() {
    if (!match) return;
    match.fighters.forEach((f, i) => {
      const side = ui.sides[i];
      side.querySelector('.duel-name').textContent = f.id === ctx.myId() ? `${f.name} (คุณ)` : f.name;
      const pct = Math.max(0, f.hp) / HP_MAX;
      const bar = side.querySelector('.duel-bar i');
      bar.style.transform = `scaleX(${pct})`;
      side.classList.toggle('is-low', pct <= 0.3);
      side.querySelector('.duel-info').textContent = `${f.hp} HP · ${WEAPONS[f.weapon]?.name ?? ''}${match.practice || !Number.isFinite(f.potions) ? '' : ` · ยา ${f.potions}`}`;
    });
    renderStamina();
    renderVignette(myFighter());
    renderPotion();
    renderPractice();
    ui.renderLockHint();
    ui.slots.forEach((el, i) => (el.querySelector('kbd').textContent = labelOf(i ? 'slot2' : 'slot1')));
    const f = myFighter();
    if (!f?.loadout) return;
    ui.slots.forEach((el, i) => {
      el.querySelector('span').textContent = WEAPONS[f.loadout[i]].name;
      el.classList.toggle('is-active', i === f.slot);
    });
  }

  // ขอบจอแดง: เข้มขึ้นเรื่อยๆ ยิ่งเลือดน้อย · วิกฤต = เต้นเป็นจังหวะหัวใจ (ปิดถ้าเครื่องตั้งลดการเคลื่อนไหว — ทำใน CSS)
  function renderVignette(f) {
    const pct = inArena && f ? Math.max(0, f.hp) / HP_MAX : 1;
    const level = pct < LOW_HP ? 1 - pct / LOW_HP : 0;
    ui.vignette.style.opacity = level > 0 ? String(0.4 + 0.6 * level) : '0';
    ui.vignette.classList.toggle('is-critical', level > 0 && pct <= CRITICAL_HP);
  }
  function renderPotion() {
    const f = myFighter();
    const n = f?.potions ?? 0;
    ui.potion.querySelector('kbd').textContent = labelOf('heal');
    ui.potion.querySelector('span').textContent = match?.practice ? 'ยา ∞' : `ยา ×${n}`;
    ui.potion.classList.toggle('is-empty', !match?.practice && n <= 0);
    ui.potion.classList.toggle('is-active', performance.now() < drinkUntil);
  }
  function renderPractice() {
    const on = inArena && Boolean(match?.practice);
    ui.practice.hidden = !on;
    if (!on) return;
    const weapon = myFighter()?.weapon;
    for (const btn of ui.practice.children) {
      const active = btn.dataset.kind === weapon;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  function renderStamina() {
    if (!match) return;
    match.fighters.forEach((f, i) => {
      const v = stamina.get(f.id) ?? f.stamina ?? STAMINA.max;
      ui.sides[i].querySelector('.duel-stam i').style.transform = `scaleX(${v / STAMINA.max})`;
    });
    const mine = myStamina();
    ui.stam.querySelector('i').style.transform = `scaleX(${mine / STAMINA.max})`;
    ui.stam.setAttribute('aria-valuenow', String(Math.round(mine)));
    ui.stam.classList.toggle('is-low', mine < LOW_STAMINA);
  }

  // สถานะใต้ช่องอาวุธ: มึน / ยกการ์ด / สตามินาใกล้หมด · flashStatus = ข้อความชั่วคราว (กดแล้วทำไม่ได้)
  let flashUntil = 0;
  let statusKey = '';
  function setStatus(text, bad) {
    const k = `${text}|${bad}`;
    if (k === statusKey) return;
    statusKey = k;
    ui.status.textContent = text;
    ui.status.classList.toggle('is-bad', bad);
  }
  function flashStatus(text) {
    flashUntil = performance.now() + 900;
    setStatus(text, true);
  }
  function renderKit(now) {
    if (ui.kit.hidden) return;
    const f = myFighter();
    if (f?.loadout) {
      const left = readyAt > now ? (readyAt - now) / Math.max(1, readyAt - readyFrom) : 0;
      ui.slots.forEach((el, i) => (el.querySelector('.cd').style.transform = `scaleX(${i === f.slot ? left : 0})`));
    }
    if (now < flashUntil) return;
    ui.potion.classList.toggle('is-active', now < drinkUntil);
    if (now < drinkUntil) setStatus('กำลังดื่มยา… (เดินช้า ตีไม่ได้)', false);
    else if (isStunned(now)) setStatus('มึน', true);
    else if (blocking) setStatus('ยกการ์ดอยู่ (เดินช้าลง)', false);
    else if (myStamina() < STAMINA.roll) setStatus('สตามินาไม่พอกลิ้ง รอฟื้นแป๊บ', true);
    else setStatus('', false);
  }

  let lastClock = '';
  function renderClock(now) {
    if (!match) return;
    const left = Math.max(0, phaseEndsAt - now);
    let text = '';
    if (match.phase === 'countdown') text = String(Math.ceil(left / 1000));
    else if (match.phase === 'fight' && match.practice) text = 'ซ้อม';
    else if (match.phase === 'fight') text = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
    else text = 'จบ';
    if (text === lastClock) return;
    lastClock = text;
    ui.clock.textContent = text;
    ui.clock.classList.toggle('is-count', match.phase === 'countdown');
    if (match.phase === 'countdown' && inArena) showBanner(text, 0, 'is-count');
  }

  // ---------- ทุกเฟรม ----------
  function tick(dt, now) {
    renderClock(now);
    if (!inArena) return;
    const t = now / 1000;
    tickTrails(dt);
    for (const flame of arena.flames) animateItem(flame, t);
    for (const [id, s] of shots) {
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.z += s.vz * dt;
      if (s.isFire) {
        s.mesh.rotation.x += dt * 8;
        if (Math.random() < 0.5) fx.puff(s.mesh.position.x, s.mesh.position.y - 0.2, s.mesh.position.z, { n: 1, spread: 0.3, up: 0.6, hex: 0xfeae34, size: 1.4 });
      }
      if (now > s.until) {
        scene.remove(s.mesh);
        shots.delete(id);
      }
    }
    tickFinisher(now);
    // ส่งดื่มยาไปแล้ว server ไม่ตอบเลย (โดนจำกัดความถี่) → ถือว่าไม่ได้ดื่ม คืนขวดในเครื่อง
    if (pendingDrink && now > drinkUntil + 400) cancelDrink();
    renderKit(now);
    updateLockRing(t);
    ui.lockHint.hidden = ctx.isLocked() || !ctx.isDesktop();
    updateFloats(now);
  }

  return {
    start,
    state,
    hit,
    swing,
    shot,
    shotEnd,
    end,
    close,
    pose,
    act,
    healed,
    cinematic,
    stamina: updateStamina,
    dodge,
    attack,
    block,
    swap: () => swapTo(),
    swapTo,
    key,
    motion: () => (inArena ? currentMotion(performance.now()) : null),
    lockTarget,
    // ทิศที่ต้องหันค้างไว้ระหว่างท่าตี (null = ไม่ล็อก)
    faceLock: () => (inArena && face && performance.now() < face.until ? face.ry : null),
    // ใช้ตอน ?debug=1 / ทดสอบ: ดูสถานะการต่อสู้ของเรา
    debugState: () => ({ inArena, phase: match?.phase, blocking, blockHeld, stunUntil, busyUntil, stamina: myStamina(), readyAt, now: performance.now() }),
    tick,
    inArena: () => inArena,
    isPractice: () => Boolean(match?.practice),
    // คนดูข้างนอก: ซ่อนตัวคนสู้ (ไปอยู่ในลานแล้ว) · คนสู้: ซ่อนทุกคนยกเว้นคู่ต่อสู้
    hides: (id) => {
      if (inArena) return !fighterIds().includes(id);
      for (const ids of active.values()) if (ids.includes(id)) return true;
      return false;
    },
    track,
    // ยกการ์ด = เดินช้าลง · มึน = เดินไม่ได้
    moveScale: () => {
      if (!inArena) return 1;
      const now = performance.now();
      if (isStunned(now) || match?.phase === 'over') return 0; // จบแมตช์แล้วยืนนิ่ง (ท่าปิดเกมพาเดินเอง)
      return WEAPONS[myFighter()?.weapon ?? 'fists'].move * (blocking ? BLOCK_MOVE : 1) * (now < drinkUntil ? POTION.move : 1);
    },
    toLocal,
  };
}
