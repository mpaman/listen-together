// ลานประลอง 1v1 ฝั่งหน้าเว็บ: วาดลาน + ลูกธนู/ลูกไฟ + แถบเลือด/สตามินา + ช่องอาวุธ 1/2 + ป้ายแพ้ชนะ
// ท่าของเรา (ตี/บล็อก/กลิ้ง/สลับอาวุธ) เล่นทันทีในเครื่อง แล้วค่อยบอก server · server ตัดสินสตามินา/ดาเมจจริง
// สตามินาใช้แค่กลิ้ง · แดชปิดไว้ (DASH_ENABLED ใน arena-rules.js)
// server ตัดสินดาเมจเอง หน้าเว็บมีหน้าที่ "โชว์" + ส่งตำแหน่ง/การกดโจมตีของเรา
// ลานอยู่ในฉากเดียวกับลานฟังเพลงแต่ไกลออกไป (ARENA_ORIGIN) → หมอกบังลานฟังเพลงให้เอง ไม่ต้องสร้างฉากใหม่
// พิกัดที่ส่งกับ server = พิกัดในลาน (กลางลาน 0,0) · ในฉาก = บวก ARENA_ORIGIN
import * as THREE from 'three';
import { buildItem, animateItem } from './lounge-items.js';
import {
  ARENA_HALF, BLOCK_MOVE, BODY_RADIUS, clampArena, DASH_DIST, DASH_ENABLED, DASH_MS, HP_MAX, inPillar, PILLARS, ROLL_DIST, ROLL_MS,
  STAMINA, SWAP_MS, WEAPONS,
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

const toWorld = (x, z) => ({ x: x + ARENA_ORIGIN.x, z: z + ARENA_ORIGIN.z });
const toLocal = (x, z) => ({ x: x - ARENA_ORIGIN.x, z: z - ARENA_ORIGIN.z });

// พื้นดินของลาน (หน้าตาเดียวกับของลานฟังเพลง ให้ lounge.js สลับใช้แทนกันได้)
export const ARENA_LAND = {
  clampX: (x) => ARENA_ORIGIN.x + clampArena(x - ARENA_ORIGIN.x),
  clampZ: (z) => ARENA_ORIGIN.z + clampArena(z - ARENA_ORIGIN.z),
  supportAt: () => 0,
  groundAt: () => 0,
  blockedAt: (x, z) => inPillar(x - ARENA_ORIGIN.x, z - ARENA_ORIGIN.z, BODY_RADIUS),
  push: (x, z) => [x, z],
  dust: 0x8b9bb4,
};

const lambert = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

// ---------- ฉากลาน ----------
function buildArena(scene, floor) {
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
      tiles.setColorAt(i, c.setHex(ring < 2 ? 0xb55088 : (x + z) % 2 ? 0x5a6988 : 0x4a5675)); // วงกลางสีม่วง
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
  const wall = lambert(0x3a4466);
  const trim = lambert(0xfeae34);
  for (const [w, d, x, z] of [[size + 1, 0.5, 0, ARENA_HALF + 0.25], [size + 1, 0.5, 0, -ARENA_HALF - 0.25], [0.5, size, ARENA_HALF + 0.25, 0], [0.5, size, -ARENA_HALF - 0.25, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), wall);
    b.position.set(x, 0.25, z);
    b.castShadow = b.receiveShadow = true;
    root.add(b);
    const t = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, 0.08, d + 0.02), trim);
    t.position.set(x, 0.72, z);
    root.add(t);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(size + 6, 1, size + 6), lambert(0x262b44));
  base.position.y = -0.7;
  base.receiveShadow = true;
  root.add(base);
  // เสาหิน (ที่หลบลูกยิง) + คบไฟมุมลาน
  for (const p of PILLARS) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(p.s * 2, p.h, p.s * 2), lambert(0x8b9bb4));
    pillar.position.set(p.x, p.h / 2, p.z);
    pillar.castShadow = pillar.receiveShadow = true;
    root.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(p.s * 2 + 0.2, 0.2, p.s * 2 + 0.2), trim);
    cap.position.set(p.x, p.h, p.z);
    root.add(cap);
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
  return { root, flames };
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
    </div>`;
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
  container.append(hud, banner, tip, kit, lockHint);
  const sides = [...hud.querySelectorAll('.duel-side')];
  return {
    hud, banner, tip, sides, kit, lockHint, renderLockHint,
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
  let lockOn = false; // กด Tab ล็อกเป้า: กล้อง/ตัว/ท่าตี หันหาคู่ต่อสู้ตลอด
  let lockRing = null; // วงแดงใต้เท้าเป้า (สร้างตอนล็อกครั้งแรก)
  let tipTimer = null;
  let bannerTimer = null;

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
    arena ??= buildArena(scene, floor);
    inArena = true;
    container.classList.add('is-dueling'); // ซ่อนคำแนะนำลานฟังเพลง (ทับกับคำแนะนำอาวุธ)
    saved = { x: entry.pos.x, y: entry.pos.y, z: entry.pos.z, ry: entry.ry, sit: entry.sit, held: entry.av.held() };
    ctx.setLand(ARENA_LAND);
    for (const f of match.fighters) {
      const e = ctx.avatars.get(f.id);
      if (!e) continue;
      const w = toWorld(f.pose.x, f.pose.z);
      e.sit = null;
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
    motion = null;
    setLockOn(false);
    ctx.me()?.av.setGuard(false);
  }

  // ---------- ล็อกเป้า ----------
  // ตำแหน่งเป้าที่ล็อกอยู่ (null = ไม่ได้ล็อก / ไม่มีคู่) · lounge.js ใช้หมุนกล้องและหันตัว
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
      ? `โหมดลองอาวุธ: ตีหุ่นได้เลย · ${labelOf('swap')}/${labelOf('slot1')}/${labelOf('slot2')} สลับอาวุธ · ไม่จับเวลา · กด "ออกจากลาน" เมื่อพอ`
      : controlsHint());
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
      fx.puff(entry.pos.x + Math.sin(entry.ry) * 0.5, entry.viewY + 1.1, entry.pos.z + Math.cos(entry.ry) * 0.5, { n: 8, spread: 2.2, up: 1.2, hex: 0xc0cbdc });
    } else {
      entry.av.flash();
      entry.av.play('flinch');
      floatText(entry, `-${ev.dmg}`);
      fx.puff(entry.pos.x, entry.viewY + 1, entry.pos.z, { n: 6, spread: 2, up: 1.5, hex: 0xe43b44 });
    }
    if (ev.target === ctx.myId()) {
      ctx.knockback(ev.kx, ev.kz, ev.knock);
      if (!reducedMotion.matches) ctx.shake(0.25);
    }
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
      if (ev.act === 'denied') motion = null; // สตามินาฝั่ง server ไม่พอ → หยุดพุ่ง
      if (ev.act === 'block' && ev.on !== blocking) setBlocking(ev.on);
      return;
    }
    const entry = ctx.avatars.get(ev.id);
    if (!entry) return;
    if (ev.act === 'block') entry.av.setGuard(ev.on);
    else if (ev.act === 'roll' || ev.act === 'dash') {
      entry.av.setGuard(false);
      entry.av.play(ev.act, { sec: ev.ms / 1000 + (ev.act === 'dash' ? 0.08 : 0) });
    }
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
    phaseEndsAt = performance.now() + 4000;
    const wins = Object.entries(ev.wins ?? {}).map(([name, n]) => `${name} ${n}`).join(' · ');
    setLockOn(false);
    if (inArena) {
      // ป้ายผลกลางจอใช้ภาษาอังกฤษแบบเกมต่อสู้ (Man ขอ) · ข้อความแจ้งในแชทยังเป็นไทย
      const whyEn = { ko: 'K.O.!', time: 'TIME UP', left: 'OPPONENT LEFT' }[ev.reason] ?? '';
      const text = ev.winner === null ? 'DRAW' : ev.winnerId === ctx.myId() ? 'YOU WIN! 🏆' : 'YOU LOSE';
      showBanner(`${text}\n${whyEn}${wins ? `\nWINS: ${wins}` : ''}`, 0, ev.winnerId === ctx.myId() ? 'is-win' : 'is-lose');
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
    leave();
    for (const f of match?.fighters ?? []) {
      if (f.npc) ctx.removeAvatar(f.id);
      const e = ctx.avatars.get(f.id);
      if (e) delete e.loungeHeld;
    }
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
      side.querySelector('.duel-info').textContent = `${f.hp} HP · ${WEAPONS[f.weapon]?.name ?? ''}`;
    });
    renderStamina();
    ui.renderLockHint();
    ui.slots.forEach((el, i) => (el.querySelector('kbd').textContent = labelOf(i ? 'slot2' : 'slot1')));
    const f = myFighter();
    if (!f?.loadout) return;
    ui.slots.forEach((el, i) => {
      el.querySelector('span').textContent = WEAPONS[f.loadout[i]].name;
      el.classList.toggle('is-active', i === f.slot);
    });
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
    if (isStunned(now)) setStatus('มึน', true);
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
    stamina: updateStamina,
    dodge,
    attack,
    block,
    swap: () => swapTo(),
    swapTo,
    key,
    motion: () => (inArena ? currentMotion(performance.now()) : null),
    lockTarget,
    isLockedOn: () => Boolean(lockTarget()),
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
      if (isStunned(performance.now())) return 0;
      return WEAPONS[myFighter()?.weapon ?? 'fists'].move * (blocking ? BLOCK_MOVE : 1);
    },
    toLocal,
  };
}
