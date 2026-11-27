// ลานประลอง 1v1 ฝั่งหน้าเว็บ: วาดลาน + อาวุธบนพื้น + ลูกธนู/ลูกไฟ + แถบเลือด + ป้ายแพ้ชนะ
// server ตัดสินดาเมจเอง หน้าเว็บมีหน้าที่ "โชว์" + ส่งตำแหน่ง/การกดโจมตีของเรา
// ลานอยู่ในฉากเดียวกับลานฟังเพลงแต่ไกลออกไป (ARENA_ORIGIN) → หมอกบังลานฟังเพลงให้เอง ไม่ต้องสร้างฉากใหม่
// พิกัดที่ส่งกับ server = พิกัดในลาน (กลางลาน 0,0) · ในฉาก = บวก ARENA_ORIGIN
import * as THREE from 'three';
import { buildItem, animateItem } from './lounge-items.js';
import {
  ARENA_HALF, BODY_RADIUS, clampArena, HP_MAX, inPillar, PICK_RANGE, PILLARS, WEAPONS,
} from './arena-rules.js';

export const ARENA_ORIGIN = { x: 0, z: 150 };
const AIM_ASSIST = Math.cos((60 * Math.PI) / 180); // คู่อยู่ในมุม ±60° จากที่หัน → หันไปหาคู่ให้เอง
const PICK_RETRY_MS = 700;
const DMG_FLOAT_MS = 900;
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
    <div class="duel-side" data-side="0"><b class="duel-name"></b><div class="duel-bar"><i></i></div><span class="duel-info"></span></div>
    <div class="duel-clock" aria-live="polite"></div>
    <div class="duel-side" data-side="1"><b class="duel-name"></b><div class="duel-bar"><i></i></div><span class="duel-info"></span></div>`;
  const banner = document.createElement('div');
  banner.className = 'duel-banner';
  banner.hidden = true;
  const tip = document.createElement('div');
  tip.className = 'duel-tip';
  tip.hidden = true;
  container.append(hud, banner, tip);
  const sides = [...hud.querySelectorAll('.duel-side')];
  return { hud, banner, tip, sides, clock: hud.querySelector('.duel-clock') };
}

export function createDuel(ctx) {
  const { scene, floor, fx, camera, container, layer } = ctx;
  let arena = null; // สร้างตอนประลองครั้งแรก (คนที่ไม่เคยประลองไม่ต้องเสียเวลาสร้าง)
  const ui = buildHud(container);
  let match = null; // publicMatch ล่าสุด
  let phaseEndsAt = 0; // performance.now() ที่ช่วงปัจจุบันจะหมด
  let inArena = false; // เราเป็นคนสู้อยู่
  let saved = null; // ตำแหน่ง/ของในมือในลานฟังเพลงก่อนเข้าลาน
  let readyAt = 0;
  const weapons = new Map(); // id → { group, kind, x, z }
  const shots = new Map(); // id → { mesh, vx, vz, until, kind }
  const floats = []; // ตัวเลขดาเมจลอย
  const pickTried = new Map();
  let tipKey = '';
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

  // ---------- อาวุธบนพื้นลาน ----------
  function syncWeapons(list) {
    if (!arena) return;
    const keep = new Set(list.map((w) => w.id));
    for (const [id, w] of weapons) {
      if (keep.has(id)) continue;
      arena.root.remove(w.group);
      weapons.delete(id);
    }
    for (const w of list) {
      if (weapons.has(w.id)) continue;
      const group = new THREE.Group();
      const model = buildItem(w.kind);
      model.rotation.z = model.userData.upright ? 0 : 0.6;
      group.add(model);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.55, 4, 1), new THREE.MeshBasicMaterial({ color: 0xfee761, transparent: true, opacity: 0.75, depthWrite: false }));
      ring.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      ring.position.y = -0.38;
      group.add(ring);
      group.position.set(w.x, 0.45, w.z);
      arena.root.add(group);
      weapons.set(w.id, { group, kind: w.kind, x: w.x, z: w.z });
    }
  }

  // ของในมือของคนสู้ตามที่ server บอก (หมัด = มือเปล่า)
  function syncHeld() {
    for (const f of match?.fighters ?? []) {
      const entry = ctx.avatars.get(f.id);
      const kind = f.weapon === 'fists' ? null : f.weapon;
      if (entry && entry.av.held() !== kind) entry.av.setHeld(kind);
    }
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
    syncWeapons(match.weapons);
    syncHeld();
    ctx.snapCamera(entry.ry);
  }

  function leave() {
    if (!inArena) return;
    inArena = false;
    container.classList.remove('is-dueling');
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
    if (other) other.av.setHeld(other.loungeHeld ?? null);
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

  function start(next) {
    setMatch(next);
    ui.hud.hidden = false;
    if (fighterIds().includes(ctx.myId())) {
      spawnNpcs();
      enter();
      showBanner('เตรียมตัว!', 900);
      ctx.notice(next.practice
        ? 'โหมดลองอาวุธ: เดินเก็บอาวุธแล้วตีหุ่นได้เลย · E สลับอาวุธ · ไม่จับเวลา · กด "ออกจากลาน" เมื่อพอ'
        : 'เดินไปเก็บอาวุธ · F = โจมตี · E = สลับอาวุธ · Space = กระโดดหลบ');
    } else if (!next.practice) {
      ctx.notice(`⚔️ ${next.fighters[0].name} ปะทะ ${next.fighters[1].name} ในลานประลอง`);
    }
  }

  function state(next) {
    const wasFight = match?.phase === 'fight';
    setMatch(next);
    if (inArena) {
      syncWeapons(next.weapons);
      syncHeld();
    }
    if (next.phase === 'fight' && !wasFight && inArena) showBanner('สู้!', 900, 'is-go');
  }

  function hit(ev) {
    if (!match) return;
    const f = match.fighters.find((x) => x.id === ev.target);
    if (f) f.hp = ev.hp;
    renderHud();
    if (!inArena) return;
    const entry = ctx.avatars.get(ev.target);
    if (!entry) return;
    entry.av.flash();
    entry.av.play('flinch');
    floatDamage(entry, ev.dmg);
    fx.puff(entry.pos.x, entry.viewY + 1, entry.pos.z, { n: 6, spread: 2, up: 1.5, hex: 0xe43b44 });
    if (ev.target === ctx.myId()) {
      ctx.knockback(ev.kx, ev.kz, ev.knock);
      if (!reducedMotion.matches) ctx.shake(0.25);
    }
  }

  function swing(ev) {
    if (!inArena || ev.id === ctx.myId()) return; // ท่าของเราเล่นไปแล้วตอนกด
    playSwing(ctx.avatars.get(ev.id), ev.weapon, ev.windup, ev.ry);
  }

  function playSwing(entry, kind, windup, ry) {
    if (!entry) return;
    const weapon = WEAPONS[kind];
    entry.ry = ry;
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
    if (!match) return;
    match.phase = 'over';
    match.winner = ev.winner;
    phaseEndsAt = performance.now() + 4000;
    const wins = Object.entries(ev.wins ?? {}).map(([name, n]) => `${name} ${n}`).join(' · ');
    const why = { ko: 'น็อก!', time: 'หมดเวลา', left: 'อีกฝ่ายออกจากห้อง' }[ev.reason] ?? '';
    if (inArena) {
      const text = ev.winner === null ? 'เสมอ' : ev.winnerId === ctx.myId() ? 'ชนะ! 🏆' : 'แพ้…';
      showBanner(`${text}\n${why}${wins ? `\nสถิติชนะ: ${wins}` : ''}`, 0, ev.winnerId === ctx.myId() ? 'is-win' : 'is-lose');
    } else {
      ctx.notice(ev.winner ? `🏆 ${ev.winner} ชนะการประลอง (${why})` : `การประลองจบลงด้วยผลเสมอ`);
    }
    renderHud();
  }

  function close() {
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
    for (const w of weapons.values()) arena?.root.remove(w.group);
    weapons.clear();
  }

  function pose({ id, x, y, z, ry }) {
    const entry = ctx.avatars.get(id);
    if (!entry || !inArena) return;
    const w = toWorld(x, z);
    entry.target = { x: w.x, y, z: w.z, ry };
  }

  // ---------- การกดของเรา ----------
  // F: เช็ค cooldown ในเครื่องก่อน (กดรัวไม่ส่งรัว) · คู่อยู่ใกล้ทิศที่หัน → หันไปหาให้
  function attack() {
    const entry = ctx.me();
    const f = myFighter();
    if (!entry || !f || match.phase !== 'fight') return;
    const now = performance.now();
    if (now < readyAt) return;
    const weapon = WEAPONS[f.weapon];
    let ry = entry.ry;
    const other = ctx.avatars.get(opponentId());
    if (other) {
      const dx = other.pos.x - entry.pos.x;
      const dz = other.pos.z - entry.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.01 && (Math.sin(ry) * dx + Math.cos(ry) * dz) / d >= AIM_ASSIST) ry = Math.atan2(dx, dz);
    }
    readyAt = now + weapon.cooldown;
    entry.ry = ry;
    playSwing(entry, f.weapon, weapon.windup, ry);
    ctx.send.attack(ry);
  }

  function nearestWeapon() {
    const entry = ctx.me();
    if (!entry) return null;
    const { x, z } = toLocal(entry.pos.x, entry.pos.z);
    let best = null;
    for (const [id, w] of weapons) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d <= PICK_RANGE && (!best || d < best.d)) best = { id, w, d };
    }
    return best;
  }

  // E: สลับเป็นอาวุธที่ยืนทับอยู่
  function swap() {
    const near = nearestWeapon();
    if (near) ctx.send.pick(near.id);
  }

  // มือเปล่า + เดินทับอาวุธ = เก็บเลย · ถืออยู่แล้ว = โชว์คำแนะนำให้กด E
  function checkWeapons(now) {
    const near = nearestWeapon();
    const f = myFighter();
    let tip = '';
    if (near && f && match.phase !== 'over') {
      const info = WEAPONS[near.w.kind];
      if (f.weapon === 'fists') {
        if (now - (pickTried.get(near.id) ?? -Infinity) > PICK_RETRY_MS) {
          pickTried.set(near.id, now);
          ctx.send.pick(near.id);
        }
      }
      tip = `${f.weapon === 'fists' ? 'เก็บ' : 'กด E สลับเป็น'} ${info.name} — ✔ ${info.pro} · ✘ ${info.con}`;
    } else if (f && f.weapon) {
      const info = WEAPONS[f.weapon];
      tip = `ถือ${info.name}: ดาเมจ ${info.dmg} · ✔ ${info.pro} · ✘ ${info.con}`;
    }
    if (tip !== tipKey) {
      tipKey = tip;
      ui.tip.textContent = tip;
      ui.tip.hidden = !tip;
    }
  }

  // ---------- ตัวเลขดาเมจลอยขึ้นจากหัว ----------
  function floatDamage(entry, dmg) {
    const node = document.createElement('div');
    node.className = 'duel-dmg';
    node.textContent = `-${dmg}`;
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
    for (const w of weapons.values()) {
      w.group.position.y = 0.5 + Math.sin(t * 2.4 + w.x) * 0.08;
      w.group.rotation.y = t * 1.4 + w.z;
      animateItem(w.group.children[0], t);
    }
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
    checkWeapons(now);
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
    attack,
    swap,
    tick,
    inArena: () => inArena,
    isPractice: () => Boolean(match?.practice),
    // คนดูข้างนอก: ซ่อนตัวคนสู้ (ไปอยู่ในลานแล้ว) · คนสู้: ซ่อนทุกคนยกเว้นคู่ต่อสู้
    hides: (id) => {
      if (!match) return false;
      const fighting = fighterIds().includes(id);
      return inArena ? !fighting : fighting;
    },
    moveScale: () => (inArena ? WEAPONS[myFighter()?.weapon ?? 'fists'].move : 1),
    toLocal,
  };
}
