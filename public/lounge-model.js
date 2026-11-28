// ตัวละครโมเดล 3D (KayKit Adventurers by Kay Lousberg · CC0 · public/models/kaykit/LICENSE.txt)
// ใช้แทนตัวกล่องจาก lounge-avatar.js ด้วย API ชุดเดียวกัน (root/update/play/setHeld/…) → lounge.js กับ lounge-duel.js แทบไม่ต้องแก้
// - ระหว่างโหลดไฟล์ (~3.6 MB ต่อคลาส) โชว์ตัวกล่องไปก่อน คนในห้องจะไม่หายวับ · โหลดไม่ได้ = ใช้ตัวกล่องต่อ
// - ท่าทางมาจากคลิปในไฟล์ (76 ท่า) · ท่าที่ไม่มีคลิป (โบกมือ/ปรบมือ/ร้องไห้/โกรธ) หมุนกระดูกแขนเองทับท่าเดิน
// - ท่าตี/ดื่ม/ยกการ์ด ใช้แค่ "ตัวท่อนบน" (ตั้งแต่ spine ขึ้นไป) ขายังเดิน/ยืนตามจริง ไม่ไถลไปทั้งตัว
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { BODY_COLORS, buildBottle, buildCrown, buildHat, crownTier, createAvatar as createBoxAvatar, HAT_COLORS, SEAT_HIP } from './lounge-avatar.js';
import { buildBack } from './lounge-outfit.js';
import { animateItem, buildItem } from './lounge-items.js';

export const CLASSES = [
  { file: 'Knight', name: 'อัศวิน' },
  { file: 'Barbarian', name: 'คนเถื่อน' },
  { file: 'Mage', name: 'จอมเวท' },
  { file: 'Rogue', name: 'นักธนู' },
  { file: 'Rogue_Hooded', name: 'นักฆ่าฮู้ด' },
];
const BASE = '/models/kaykit';
// โมเดลสูง ~2.4 หน่วย → ย่อให้สูงพอๆ กับตัวกล่องเดิม (ป้ายชื่อ HEAD_TOP / ที่นั่ง / ระยะตีในลานยังใช้ค่าเดิมได้)
const MODEL_SCALE = 0.72;
// สะโพกของท่านั่ง (หน่วยหลังย่อแล้ว): ใช้ชดเชยระดับที่ lounge.js ลดตัวลง (ออกแบบไว้สำหรับตัวกล่องที่สะโพกสูง SEAT_HIP)
const CHAIR_HIP = 0.3;
const FLOOR_HIP = 0.11; // ต้องตรงกับ FLOOR_SIT_DROP ใน lounge.js (0.11 - SEAT_HIP)
const CROWN_Y = 1.2; // เหนือกระดูกหัว (หน่วยของโมเดลก่อนย่อ)
const FADE_IN = 0.08;
const FADE_OUT = 0.16;
const LOCO = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', air: 'Jump_Idle', chair: 'Sit_Chair_Idle', floor: 'Sit_Floor_Idle', lie: 'Lie_Idle' };

// ท่าชั่วคราว → คลิป · full = ทั้งตัว (ขาเปลี่ยนด้วย) · impact = สัดส่วนของคลิปที่อาวุธโดนจริง (ไว้ตรงกับ hitAt ที่ server กำหนด)
// loop = เล่นวนจนหมดเวลา · clip: null = ไม่มีคลิป หมุนแขนเอง (ดู overlayGesture)
const GESTURES = {
  slash: { clip: '1H_Melee_Attack_Slice_Diagonal', impact: 0.42 },
  stab: { clip: '2H_Melee_Attack_Stab', impact: 0.4 },
  slam: { clip: '2H_Melee_Attack_Chop', impact: 0.45, full: true },
  shoot: { clip: '2H_Ranged_Shoot', impact: 0.3 },
  cast: { clip: 'Spellcast_Shoot', impact: 0.4 },
  drink: { clip: 'Use_Item' },
  flinch: { clip: 'Hit_A', full: true },
  roll: { clip: 'Dodge_Forward', full: true },
  dash: { clip: 'Dodge_Forward', full: true },
  finisher: { clip: '2H_Melee_Attack_Spin', impact: 0.62, full: true },
  ko: { clip: 'Death_A', full: true },
  jump: { clip: 'Jump_Full_Short', full: true },
  hit: { clip: 'Hit_B', full: true },
  dance: { clip: 'Cheer', full: true, loop: true },
  laugh: { clip: 'Cheer', full: true, loop: true },
  love: { clip: 'Cheer', full: true, loop: true },
  party: { clip: 'Cheer', full: true, loop: true },
  wave: { clip: null },
  clap: { clip: null },
  cry: { clip: null },
  angry: { clip: null },
};
// ท่าต่อย/แทงสั้น (jab) ดูตามของในมือ · punch = ต่อยในลานฟังเพลง
function jabClip(held) {
  if (!held || held === 'fists') return { clip: 'Unarmed_Melee_Attack_Punch_A', impact: 0.3 };
  if (held === 'dagger') return { clip: 'Dualwield_Melee_Attack_Stab', impact: 0.35 };
  if (held === 'shield') return { clip: 'Block_Attack', impact: 0.35 };
  return { clip: '1H_Melee_Attack_Stab', impact: 0.35 };
}
function punchClip(held) {
  return held === 'sword' ? { clip: '1H_Melee_Attack_Chop', impact: 0.4 } : { clip: 'Unarmed_Melee_Attack_Punch_A', impact: 0.3 };
}
// ระยะเวลาเริ่มต้น (ใช้เมื่อผู้เรียกไม่ส่ง sec มา) · ท่าอาวุธ server ส่งความยาวตาม windup มาเอง
const GESTURE_SEC = { jump: 0.8, punch: 0.5, wave: 1.6, dance: 2.4, clap: 1.4, hit: 0.8, laugh: 1.4, love: 1.4, party: 1.6, cry: 1.6, angry: 1.4, jab: 0.3, slash: 0.45, stab: 0.5, slam: 1, shoot: 0.6, cast: 0.75, flinch: 0.3, roll: 0.48, dash: 0.25, drink: 1.6, finisher: 1.5, ko: 0.9 };

// ของในมือที่มีโมเดลจาก KayKit · ที่เหลือ (ค้อน/หอก/ธนู/กีตาร์/ไมค์…) ใช้ของกล่องเดิม
// ---------- แต่งตัว (look) ----------
// ของแต่งแบบเก่า (กล่อง) สร้างมาสำหรับหัว/ลำตัวของตัวกล่อง → วางบนกระดูกแล้วขยายให้พอดีโมเดล (หน่วยของโมเดลก่อนย่อ)
// วัดจากโมเดลจริง 11-28: ลำตัว (mesh *_Body) กว้าง ~0.87 กลาง y ~0.82 หลัง z ~-0.33 · หัวกว้าง ~1.1 ยอดหัว y ~2.19 · กระดูก chest y 0.96 · head y 1.23
const BACK_ANCHOR = { y: -0.14, z: -0.08, scale: 1.65 }; // ลำตัวกล่อง 0.52 × 1.65 ≈ ลำตัวโมเดล
// ยอดหัวกล่องอยู่ที่ y 0.28 → 0.28 × 1.95 + 0.41 = ยอดหัวโมเดลพอดี แต่หัวโมเดลกลมมน หมวกแบนจะลอยตรงขอบ จึงกดลงอีก ~0.1
const HAT_ANCHOR = { y: 0.3, scale: 1.95 };
const HAT_OWN = 0; // หมวก/หมวกเหล็ก/ฮู้ดที่มากับตัวละคร
const HAT_NONE = 7;
// สีย้อม: 0 = สีเดิมของโมเดล · 1..10 = BODY_COLORS · คูณกับ texture จึงผสมกับสีขาวไว้บ้าง ลายเดิมยังเห็น
const TINT_MIX = 0.75;
const WHITE = new THREE.Color(0xffffff);
function tintColor(index, out) {
  const hex = index > 0 ? BODY_COLORS[index - 1] : undefined;
  return hex === undefined ? out.copy(WHITE) : out.copy(WHITE).lerp(new THREE.Color(hex), TINT_MIX);
}
// ตัวกล่องตอนโหลด: ใช้สีใกล้เคียงกับที่เลือก (ช่วงตัวเลขของ look ใหม่ไม่ตรงกับของตัวกล่อง)
function boxLook(look) {
  if (!look) return look;
  return { ...look, body: look.body > 0 ? look.body - 1 : 7, hat: look.hat > 0 && look.hat < HAT_NONE ? look.hat : 0, outfit: 0 };
}

const ITEM_MODELS = { sword: 'sword_1handed', dagger: 'dagger', shield: 'shield_square', staff: 'staff' };
const LEFT_HAND = new Set(['shield']); // โล่ถือมือซ้ายตามที่โมเดลออกแบบมา

const loader = new GLTFLoader();
const classCache = new Map(); // file → Promise<{ scene, clips, upper, splits }>
const itemCache = new Map(); // ชื่อไฟล์ → Promise<Object3D>

function loadClass(index) {
  const c = CLASSES[index] ?? CLASSES[0];
  if (!classCache.has(c.file)) {
    classCache.set(c.file, loader.loadAsync(`${BASE}/characters/${c.file}.glb`).then(prepareClass));
  }
  return classCache.get(c.file);
}

function prepareClass(gltf) {
  const scene = gltf.scene;
  // วัสดุ Lambert: แสงเงาตรงกับฉากที่เหลือ (ทั้งห้องใช้ Lambert) และเบากว่า Standard
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = new THREE.MeshLambertMaterial({ map: o.material.map });
    o.castShadow = true;
    o.frustumCulled = false; // กล่องขอบของ skinned mesh ไม่ขยับตามท่า → ถ้าไม่ปิด ตัวจะหายตอนอยู่ขอบจอ
  });
  // ท่อนบน = กระดูก spine และทุกอย่างที่อยู่ใต้มัน (อก/หัว/แขน/มือ)
  const upper = new Set();
  scene.getObjectByName('spine')?.traverse((o) => upper.add(o.name));
  return { scene, clips: new Map(gltf.animations.map((c) => [c.name, c])), upper, splits: new Map() };
}

// แยกคลิปเป็นท่อนบน/ท่อนล่าง (ครั้งเดียวต่อคลาส) → ผสมท่าตีท่อนบนกับท่าเดินท่อนล่างได้
function splitClip(base, name) {
  if (base.splits.has(name)) return base.splits.get(name);
  const clip = base.clips.get(name);
  let result = null;
  if (clip) {
    const isUpper = (t) => base.upper.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
    result = {
      upper: new THREE.AnimationClip(`${name}:upper`, clip.duration, clip.tracks.filter(isUpper)),
      lower: new THREE.AnimationClip(`${name}:lower`, clip.duration, clip.tracks.filter((t) => !isUpper(t))),
    };
  }
  base.splits.set(name, result);
  return result;
}

function loadItemModel(file) {
  if (!itemCache.has(file)) {
    itemCache.set(file, loader.loadAsync(`${BASE}/weapons/${file}.gltf`).then((g) => {
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshLambertMaterial({ map: o.material.map });
        o.castShadow = true;
      });
      return g.scene;
    }));
  }
  return itemCache.get(file);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (t) => t * t * (3 - 2 * t);
const approach = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-dt * rate));

// หมุนกระดูกรอบแกนของ "ตัวละคร" (ไม่ใช่แกนของกระดูกเอง ซึ่งแต่ละชิ้นหันไม่เหมือนกัน)
// x ลบ = ยกไปข้างหน้า · z = กางออกข้าง · เรียกจากกระดูกแม่ไปลูก (ลูกใช้ตำแหน่งแม่ที่หมุนแล้ว)
const _qModel = new THREE.Quaternion();
const _qParent = new THREE.Quaternion();
const _qBone = new THREE.Quaternion();
const _qTurn = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _euler = new THREE.Euler();
function turnBone(model, bone, ax, ay, az, k) {
  if (!bone || k <= 0.001) return;
  model.getWorldQuaternion(_qModel);
  bone.parent.getWorldQuaternion(_qParent);
  bone.getWorldQuaternion(_qBone);
  _qTurn.setFromEuler(_euler.set(ax * k, ay * k, az * k));
  _qTurn.premultiply(_qModel).multiply(_qInv.copy(_qModel).invert()); // แกนของตัวละคร → แกนโลก
  _qBone.premultiply(_qTurn);
  bone.quaternion.copy(_qParent.invert().multiply(_qBone));
  bone.updateMatrixWorld(true);
}

// IK สองท่อน (ต้นแขน + แขนท่อนล่าง): วางมือไว้ที่จุดเป้า (หน่วย/แกนของตัวละคร) · pole = ทิศที่ข้อศอกชี้ไป
// ใช้กับท่าที่ไม่มีคลิป: บอก "มืออยู่ตรงไหน" แม่นกว่าหมุนกระดูกทีละท่อนแล้วเดาว่ามือจะไปตกตรงไหน
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _H = new THREE.Vector3();
const _T = new THREE.Vector3();
const _P = new THREE.Vector3();
const _d = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
function aimBone(bone, pivot, from, to) { // หมุน bone (โลก) ให้ทิศ pivot→from ชี้ไปทาง pivot→to
  _from.subVectors(from, pivot).normalize();
  _to.subVectors(to, pivot).normalize();
  _qTurn.setFromUnitVectors(_from, _to);
  bone.parent.getWorldQuaternion(_qParent);
  bone.getWorldQuaternion(_qBone);
  _qBone.premultiply(_qTurn);
  bone.quaternion.copy(_qParent.invert().multiply(_qBone));
  bone.updateMatrixWorld(true);
}
function reachHand(model, upper, lower, hand, target, pole, k) {
  if (!upper || !lower || !hand || k <= 0.001) return;
  upper.getWorldPosition(_S);
  lower.getWorldPosition(_E);
  hand.getWorldPosition(_H);
  const a = _S.distanceTo(_E);
  const b = _E.distanceTo(_H);
  model.localToWorld(_T.copy(target));
  _T.lerp(_H, 1 - k); // k < 1 = ไปไม่ถึงเป้า (ค่อยๆ เข้าท่า/ออกท่า)
  const dist = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, _S.distanceTo(_T)));
  _d.subVectors(_T, _S).normalize();
  // ระนาบของแขน: ทิศเป้า + ทิศ pole (ตัดส่วนที่ขนานกับทิศเป้าออก)
  _P.copy(pole).transformDirection(model.matrixWorld);
  _P.addScaledVector(_d, -_P.dot(_d)).normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const elbow = _from.copy(_S).addScaledVector(_d, cosA * a).addScaledVector(_P, sinA * a);
  const elbowTarget = elbow.clone();
  aimBone(upper, _S, _E, elbowTarget);
  lower.getWorldPosition(_E);
  hand.getWorldPosition(_H);
  _T.copy(_S).addScaledVector(_d, dist);
  aimBone(lower, _E, _H, _T);
}

export function createAvatar(look) {
  const root = new THREE.Group(); // lounge.js ตั้งตำแหน่ง/ทิศของตัวนี้
  const box = createBoxAvatar(boxLook(look)); // ตัวกล่องระหว่างรอโหลด
  root.add(box.root);
  const holder = new THREE.Group(); // ขยับเอง: ลดตัวตอนนั่ง เด้ง ย่อ เอียง หมุน
  root.add(holder);

  let cls = look?.cls ?? 0;
  let curLook = look ?? {};
  let backAnim = null; // ของบนหลังที่ขยับได้ (ปีก/ผ้าคลุม/เจ็ตแพ็ก)
  let extras = []; // หมวก/ของบนหลังแบบเก่าที่แปะไว้ (ไว้ถอดตอนเปลี่ยนชุด)
  let m = null; // โมเดลที่พร้อมใช้ { model, mixer, base, bones, loco, guard, sockets }
  let loadToken = 0;
  let heldKind = null;
  let crownWins = 0;
  let guardOn = false;
  let gesture = null; // { type, t, dur, hold, hit, def, acts }
  let sitK = 0;
  let lieK = 0;
  let airK = 0;
  let guardK = 0;
  let helloK = 0;
  let clean = null; // ท่าสะอาดจาก mixer (ดู saveClean)
  let squash = 0;
  let clock = Math.random() * 10;
  let flashT = 0;

  function useModel(base, token) {
    if (token !== loadToken) return; // เปลี่ยนคลาสไปแล้วระหว่างโหลด
    if (m) {
      holder.remove(m.model);
      m.mixer.stopAllAction();
    }
    const model = cloneSkinned(base.scene);
    clean = null; // กระดูกชุดใหม่ ต้องเก็บท่าสะอาดใหม่ (ถ้าค้างของโมเดลเก่า โมเดลใหม่จะไม่ถูกคืนท่า → หัวหมุนอีก)
    model.scale.setScalar(MODEL_SCALE);
    const mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone(); // แยกวัสดุต่อตัว → กะพริบขาวตอนโดนตีเฉพาะตัวนั้น (texture ยังใช้ร่วมกัน)
      mats.push(o.material);
    });
    // GLTFLoader ตัดจุดออกจากชื่อ node (handslot.r → handslotr) จึงต้องค้นด้วยชื่อที่ไม่มีจุด
    const bone = (n) => model.getObjectByName(n.replaceAll('.', ''));
    const sockets = { r: bone('handslot.r'), l: bone('handslot.l') };
    // ซ่อนอาวุธ/โล่ที่ติดมากับโมเดล (เราใส่ของตามที่ถือจริงเอง)
    for (const s of Object.values(sockets)) for (const c of s?.children ?? []) c.visible = false;
    const mixer = new THREE.AnimationMixer(model);
    const action = (clip, loop = true) => {
      const a = mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      return a;
    };
    const loco = {};
    for (const [key, name] of Object.entries(LOCO)) {
      const s = splitClip(base, name);
      if (s) loco[key] = { lower: action(s.lower), upper: action(s.upper), w: key === 'idle' ? 1 : 0 };
    }
    const g = splitClip(base, 'Blocking');
    const guard = g ? action(g.upper) : null;
    m = {
      model, mixer, base, mats, sockets, loco, guard, action,
      bones: {
        head: bone('head'), chest: bone('chest'), spine: bone('spine'),
        armL: bone('upperarm.l'), armR: bone('upperarm.r'), foreL: bone('lowerarm.l'), foreR: bone('lowerarm.r'),
        handL: bone('hand.l'), handR: bone('hand.r'),
      },
    };
    holder.add(model);
    applyLook();
    box.root.visible = false;
    holder.visible = true;
    setHeld(heldKind);
    setCrown(crownWins);
    if (gesture) startGestureActions(gesture);
  }

  function load(index) {
    cls = Number.isInteger(index) ? index : 0;
    const token = ++loadToken;
    loadClass(cls).then((base) => useModel(base, token)).catch((err) => {
      console.warn('โหลดโมเดลตัวละครไม่ได้ ใช้ตัวกล่องแทน', err);
    });
  }
  holder.visible = false;
  load(cls);

  function setLook(next) {
    curLook = next ?? {};
    box.setLook(boxLook(next));
    const nextCls = next?.cls ?? 0;
    if (nextCls === cls && m) {
      applyLook();
      return;
    }
    load(nextCls);
  }

  // ย้อมสีเสื้อ/ผ้าคลุม · ซ่อน/โชว์หมวกประจำตัว · แปะหมวกและของบนหลังแบบเก่า
  function applyLook() {
    if (!m) return;
    const { body = 0, outfit = 0, hat = HAT_OWN, back = 0 } = curLook;
    m.model.traverse((o) => {
      if (!o.isMesh) return;
      if (/_Body$/.test(o.name)) tintColor(body, o.material.color);
      else if (/_Cape$/.test(o.name)) {
        tintColor(outfit, o.material.color);
        o.visible = !back; // มีของบนหลังแล้ว ซ่อนผ้าคลุมเดิม กันสองชิ้นทะลุกัน
      } else if (/_(Hat|Helmet)$/.test(o.name)) o.visible = hat === HAT_OWN;
    });
    for (const o of extras) o.removeFromParent();
    extras = [];
    backAnim = null;
    const { head, chest } = m.bones;
    if (head && hat !== HAT_OWN && hat !== HAT_NONE) {
      const anchor = new THREE.Group();
      anchor.position.y = HAT_ANCHOR.y;
      anchor.scale.setScalar(HAT_ANCHOR.scale);
      buildHat(anchor, hat, HAT_COLORS[(body + hat) % HAT_COLORS.length]);
      head.add(anchor);
      extras.push(anchor);
    }
    if (chest && back) {
      const anchor = new THREE.Group();
      anchor.position.set(0, BACK_ANCHOR.y, BACK_ANCHOR.z);
      anchor.scale.setScalar(BACK_ANCHOR.scale);
      backAnim = buildBack(anchor, curLook);
      chest.add(anchor);
      extras.push(anchor);
    }
  }

  // ---------- ของในมือ ----------
  let held = []; // ของที่ติดมืออยู่ตอนนี้ (ไว้ถอดออก)
  let heldToken = 0;
  function attach(socket, obj) {
    socket.add(obj);
    held.push(obj);
  }
  function setHeld(kind) {
    heldKind = kind ?? null;
    box.setHeld(heldKind);
    for (const o of held) o.removeFromParent();
    held = [];
    const token = ++heldToken;
    if (!m || !heldKind || heldKind === 'fists') return;
    const file = ITEM_MODELS[heldKind];
    const hand = LEFT_HAND.has(heldKind) ? m.sockets.l : m.sockets.r;
    if (!file) { // ของกล่องเดิม: ทำมาให้ด้ามอยู่ที่ 0 ชี้ขึ้น +y · ขยายกลับให้ขนาดเท่าในมือตัวกล่อง
      const item = buildItem(heldKind);
      item.scale.setScalar(1 / MODEL_SCALE);
      attach(m.sockets.r, item);
      if (item.userData.dual) {
        const left = buildItem(heldKind);
        left.scale.setScalar(1 / MODEL_SCALE);
        attach(m.sockets.l, left);
      }
      return;
    }
    loadItemModel(file).then((src) => {
      if (token !== heldToken || !m) return; // เปลี่ยนของไปแล้วระหว่างโหลด
      attach(hand, src.clone());
      if (heldKind === 'dagger') attach(m.sockets.l, src.clone()); // มีดคู่
    }).catch((err) => console.warn('โหลดโมเดลอาวุธไม่ได้', err));
  }

  // ขวดยาในมือซ้าย: โผล่เฉพาะตอนดื่ม
  let bottle = null;
  function setBottle(on) {
    if (!m) return;
    if (on && !bottle) {
      bottle = buildBottle();
      bottle.position.set(0, 0, 0);
      bottle.rotation.set(0, 0, 0);
      bottle.scale.setScalar(1 / MODEL_SCALE);
    }
    if (bottle) {
      if (on) m.sockets.l.add(bottle);
      else bottle.removeFromParent();
    }
    for (const o of held) if (o.parent === m.sockets.l) o.visible = !on;
  }

  let crown = null;
  let crownT = 0;
  function setCrown(wins) {
    crownWins = Math.max(0, Math.floor(wins) || 0);
    box.setCrown(crownWins);
    crown?.removeFromParent();
    crown = null;
    const tier = crownTier(crownWins);
    if (!tier || !m?.bones.head) return;
    crown = buildCrown(tier);
    crown.scale.setScalar(1 / MODEL_SCALE);
    m.bones.head.add(crown);
  }

  // ---------- ท่าชั่วคราว ----------
  function gestureDef(type) {
    if (type === 'jab') return jabClip(heldKind);
    if (type === 'punch') return punchClip(heldKind);
    return GESTURES[type] ?? null;
  }
  function startGestureActions(gs) {
    if (!m) return;
    stopGestureActions();
    const s = gs.def.clip ? splitClip(m.base, gs.def.clip) : null;
    if (!s) return;
    gs.acts = { upper: m.action(s.upper, false), lower: m.action(s.lower, false), duration: s.upper.duration };
    for (const a of [gs.acts.upper, gs.acts.lower]) {
      a.reset();
      a.timeScale = 0; // เดินเวลาของคลิปเอง (ให้ตรง hitAt) ไม่ให้ mixer เดิน
    }
  }
  function stopGestureActions() {
    if (!gesture?.acts) return;
    for (const a of [gesture.acts.upper, gesture.acts.lower]) a.stop();
    gesture.acts = null;
  }

  // sec = ความยาวท่า · hitAt = วินาทีที่โดนจริง · hold = จบแล้วค้างท่าสุดท้าย (ล้มน็อก)
  function play(type, { sec, hitAt, hold = false } = {}) {
    box.play(type, { sec, hitAt, hold });
    const def = gestureDef(type);
    if (!def) return;
    stopGestureActions();
    const dur = sec ?? GESTURE_SEC[type] ?? 1;
    gesture = { type, t: 0, dur, hold, def, hit: hitAt !== undefined ? Math.min(0.85, hitAt / dur) : null, acts: null };
    startGestureActions(gesture);
    setBottle(type === 'drink');
  }
  function stop() {
    box.stop();
    stopGestureActions();
    gesture = null;
    setBottle(false);
  }

  // เวลาในคลิปตามความคืบหน้าของท่า: ก่อนจังหวะโดนยืด/หดให้ถึงจุด impact พอดี แล้วค่อยเล่นที่เหลือ
  function clipTime(gs, p, duration) {
    if (gs.def.loop) return (gs.t % duration);
    const impact = gs.def.impact;
    if (impact === undefined || gs.hit === null) return p * duration;
    if (p <= gs.hit) return (p / gs.hit) * impact * duration;
    return (impact + ((p - gs.hit) / (1 - gs.hit)) * (1 - impact)) * duration;
  }

  function flash() {
    box.flash();
    flashT = 0.12;
    for (const mat of m?.mats ?? []) mat.emissive.setHex(0xffffff);
  }
  function tickFlash(dt) {
    if (flashT <= 0) return;
    flashT -= dt;
    if (flashT <= 0) for (const mat of m?.mats ?? []) mat.emissive.setHex(0x000000);
  }

  function setGuard(on) {
    guardOn = Boolean(on);
    box.setGuard(on);
  }
  function land(strength) {
    box.land(strength);
    squash = Math.max(squash, 0.35 + strength * 0.65);
  }

  // ---------- ทุกเฟรม ----------
  function update(dt, opts = {}) {
    const { speed = 0, seated = false, groove = null, air = null, lean = 0, rest = null } = opts;
    sitK = approach(sitK, seated ? 1 : 0, dt, 9);
    if (Math.abs(sitK - (seated ? 1 : 0)) < 0.002) sitK = seated ? 1 : 0;
    if (!m) { // ยังโหลดไม่เสร็จ: ตัวกล่องทำงานเหมือนเดิม
      box.update(dt, opts);
      if (gesture && (gesture.t += dt) >= gesture.dur && !gesture.hold) gesture = null;
      return;
    }
    clock += dt;
    lieK = approach(lieK, rest === 'lie' ? 1 : 0, dt, 6);
    helloK = approach(helloK, rest === 'hello' ? 1 : 0, dt, 8);
    airK = approach(airK, air === null ? 0 : 1, dt, 14);
    guardK = approach(guardK, guardOn ? 1 : 0, dt, 16);
    squash *= Math.exp(-dt * 7);

    // น้ำหนักท่าพื้นฐาน (รวมกัน = 1): นอน → นั่ง → ลอย → ยืน/เดิน/วิ่ง
    const move = Math.min(speed, 1.8);
    const run = clamp01((move - 1) / 0.6);
    const going = clamp01(move * 2.5);
    const lieW = lieK;
    const sitW = sitK * (1 - lieW);
    const rest1 = 1 - lieW - sitW;
    const airW = airK * rest1;
    const groundW = rest1 - airW;
    const W = {
      lie: lieW,
      floor: rest === 'sit' ? sitW : 0,
      chair: rest === 'sit' ? 0 : sitW,
      air: airW,
      idle: groundW * (1 - going),
      walk: groundW * going * (1 - run),
      run: groundW * going * run,
    };
    if (m.loco.walk) m.loco.walk.lower.timeScale = m.loco.walk.upper.timeScale = Math.max(0.6, move * 1.1);
    if (m.loco.run) m.loco.run.lower.timeScale = m.loco.run.upper.timeScale = Math.max(0.8, move / 1.6);

    // ท่าชั่วคราว: ค่อยๆ ผสมเข้า/ออก · ท่าค้าง (hold) อยู่เต็มจนกว่าจะสั่งท่าอื่น
    let g = 0;
    let full = false;
    if (gesture) {
      gesture.t += dt;
      const p = Math.min(gesture.t / gesture.dur, 1);
      const acts = gesture.acts;
      if (acts) {
        g = gesture.hold && p >= 1 ? 1 : ease(clamp01(Math.min(gesture.t / FADE_IN, (gesture.dur - gesture.t) / FADE_OUT)));
        full = Boolean(gesture.def.full);
        const time = clipTime(gesture, p, acts.duration);
        acts.upper.time = acts.lower.time = Math.min(time, acts.duration - 1e-3);
        acts.upper.setEffectiveWeight(g);
        acts.lower.setEffectiveWeight(full ? g : 0);
      }
      if (p >= 1 && !gesture.hold) stop();
    }
    const guardW = (1 - g) * guardK * (m.guard ? 1 : 0);
    m.guard?.setEffectiveWeight(guardW);
    for (const [key, act] of Object.entries(m.loco)) {
      const w = W[key] ?? 0;
      act.lower.setEffectiveWeight(w * (full ? 1 - g : 1));
      act.upper.setEffectiveWeight(w * (1 - g) * (1 - guardK));
    }
    restoreClean(); // ต้องคืนท่าก่อน mixer: mixer เขียนกระดูกเฉพาะตอนค่าเปลี่ยน ถ้าไม่คืน ท่าเสริมจะสะสมทับเฟรมก่อนจนหัวหมุน
    m.mixer.update(dt);
    saveClean();

    // ขยับทั้งตัวเอง: ชดเชยระดับนั่ง · ย่อตอนลงพื้น · เอียงเข้าโค้ง · เด้งตามเพลง
    const hipTarget = rest === 'sit' ? FLOOR_HIP : CHAIR_HIP;
    holder.position.set(0, (SEAT_HIP - hipTarget) * sitK - squash * 0.08, 0);
    holder.scale.set(1 + squash * 0.06, 1 - squash * 0.1, 1 + squash * 0.06);
    holder.rotation.set(0, 0, -lean * 0.18 * Math.min(1, move) * (1 - sitK));
    const dancing = groove !== null && !gesture && W.idle > 0.5;
    if (dancing) {
      const bounce = Math.abs(Math.sin(groove * Math.PI));
      const side = Math.sin(groove * Math.PI);
      holder.position.y += bounce * 0.07;
      holder.rotation.z += side * 0.08;
      holder.rotation.y = side * 0.25;
    }
    if (gesture?.type === 'dance') holder.rotation.y = Math.min(1, gesture.t / gesture.dur) * Math.PI * 2;

    // ท่าที่ไม่มีคลิป: หมุนกระดูกแขนทับท่าเดิม
    overlayGesture();
    overlayHello();
    if (dancing) overlayGroove(groove);

    if (crown) {
      crownT += dt;
      crown.rotation.y = crownT * 0.9;
      crown.position.y = CROWN_Y + Math.sin(crownT * 2.4) * 0.04;
    }
    for (const o of held) animateItem(o, clock);
    backAnim?.(dt, { clock, speed: move, air }); // ปีกกระพือ / ผ้าคลุมปลิว / ไฟเจ็ตแพ็ก
    tickFlash(dt);
  }

  // จุดวางมือของท่าที่ไม่มีคลิป (แกนตัวละคร: +x = ซ้ายของตัว, +y = ขึ้น, +z = หน้า · หน่วยก่อนย่อ: อก ~0.94 คอ ~1.2 หัวใหญ่สูงถึง ~2.3)
  // ข้อศอกชี้ลง/ออกข้าง (pole) แขนจะได้ไม่บิดเข้าลำตัว
  const POLE_L = new THREE.Vector3(1, -1, -0.4);
  const POLE_R = new THREE.Vector3(-1, -1, -0.4);
  const _tL = new THREE.Vector3();
  const _tR = new THREE.Vector3();
  function hands(left, right, k) {
    const b = m.bones;
    if (left) reachHand(m.model, b.armL, b.foreL, b.handL, left, POLE_L, k);
    if (right) reachHand(m.model, b.armR, b.foreR, b.handR, right, POLE_R, k);
  }

  function overlayGesture() {
    if (!gesture || gesture.def.clip) return;
    const { model, bones: b } = m;
    const t = gesture.t;
    const k = ease(clamp01(Math.min(t / 0.15, (gesture.dur - t) / 0.2)));
    switch (gesture.type) {
      case 'wave': // ยกมือขวาข้างหัว โบกซ้ายขวา
        hands(null, _tR.set(-0.75 + Math.sin(t * 12) * 0.14, 1.8, 0.2), k);
        break;
      case 'clap': { // สองมือยื่นไปหน้าอก ตบเข้าหากัน
        const c = Math.abs(Math.sin(t * 11));
        hands(_tL.set(0.05 + 0.22 * c, 1.02, 0.5), _tR.set(-0.05 - 0.22 * c, 1.02, 0.5), k);
        break;
      }
      case 'cry': // ก้มหน้า เอามือปิดตา
        turnBone(model, b.head, 0.3, 0, 0, k);
        hands(_tL.set(0.2, 1.45, 0.6), _tR.set(-0.2, 1.45, 0.6), k);
        break;
      case 'angry': { // กำหมัดลงข้างตัว ตัวสั่น
        const shake = Math.sin(t * 30) * 0.05;
        turnBone(model, b.spine, 0, 0, shake, k);
        hands(_tL.set(0.42, 0.78, 0.22), _tR.set(-0.42, 0.78, 0.22), k);
        break;
      }
      default:
        break;
    }
  }
  function overlayHello() { // โบกมือทักทายค้างไว้: ยกมือขวาข้างหัว โบกช้ากว่าอีโมตโบกมือนิดหน่อย
    if (helloK < 0.01) return;
    hands(null, _tR.set(-0.75 + Math.sin(clock * 9) * 0.14, 1.8, 0.2), helloK);
  }
  // ท่าสะอาดจาก mixer ของกระดูกที่ท่าเสริม (IK/turnBone) แตะ · เก็บหลัง mixer.update แล้วคืนก่อนเฟรมถัดไป
  // เหตุผล: PropertyMixer ของ three เขียนค่าลงกระดูกเฉพาะเมื่อค่าที่ผสมได้ต่างจากเฟรมก่อน
  // ตอนยืนนิ่งค่ามักเท่าเดิม → กระดูกค้างค่าที่ท่าเสริมหมุนไว้ แล้วโดนหมุนซ้ำทุกเฟรม (บั๊กหัวหมุนตอนไหว้ 11-28)
  function saveClean() {
    const list = Object.values(m.bones).filter(Boolean);
    clean ??= list.map((b) => ({ b, q: b.quaternion.clone() }));
    for (const c of clean) c.q.copy(c.b.quaternion);
  }
  function restoreClean() {
    if (clean) for (const c of clean) c.b.quaternion.copy(c.q);
  }
  function overlayGroove(groove) { // ยกมือโยกตามบีต
    const bounce = Math.abs(Math.sin(groove * Math.PI));
    hands(_tL.set(0.5, 1.2 + bounce * 0.25, 0.3), _tR.set(-0.5, 1.2 + bounce * 0.25, 0.3), 1);
  }

  return {
    root,
    update,
    play,
    stop,
    setLook,
    setHeld,
    setGuard,
    setCrown,
    held: () => heldKind,
    isBusy: () => gesture !== null,
    gesture: () => gesture?.type ?? null,
    sitAmount: () => sitK,
    land,
    flash,
    debugModel: () => m, // ใช้ตอนทดสอบท่าในเบราว์เซอร์เท่านั้น
  };
}
