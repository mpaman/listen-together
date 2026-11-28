// เอฟเฟกต์อนุภาคแบบพิกเซล 2 ชุด
// - ฝุ่น (puff): ก้อนทึบมีแสงเงา ตอนวิ่ง / ลงพื้น / ออกตัวกระโดด
// - แสง (spark / rise): ก้อนเรืองแสงแบบบวกสี (additive) ตอนตีโดน / กินยา / น็อก · ไม่โดนแสงในฉาก จึงสว่างเสมอ
//   และสว่างพอให้ bloom (เปิดในลานตอนคมสุด) จับไปฟุ้งต่อ
// ใช้ InstancedMesh ชุดละก้อนเดียว + pool คงที่ → ไม่สร้าง object ใหม่ทุกเฟรม (ไม่กระตุกจาก GC)
// ไม่จางด้วย opacity (ทำต่อชิ้นใน instanced ไม่ได้) แต่ "หดจนหาย" แทน — เข้ากับภาพ voxel
import * as THREE from 'three';

const DUST_POOL = 96;
const GLOW_POOL = 160;
const SIZE = 0.13;
const GLOW_SIZE = 0.09;

// pool อนุภาค 1 ชุด: แต่ละก้อนมีแรงโน้มถ่วงและแรงหน่วงของตัวเอง (ฝุ่นตกลง · ประกายพุ่งแล้วหยุด · ออร่าลอยขึ้น)
function createPool(scene, material, count, size) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size, size, size), material, count);
  mesh.frustumCulled = false; // อนุภาคกระจายทั่วลาน bounding sphere ของ mesh ไม่ตาม
  mesh.castShadow = false;
  scene.add(mesh);

  const parts = Array.from({ length: count }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, spin: 0, g: 0, drag: 0 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i += 1) mesh.setMatrixAt(i, hidden);
  mesh.instanceMatrix.needsUpdate = true;
  let next = 0;
  let anyAlive = false;

  // เพิ่ม 1 ก้อน · pool เต็ม → ทับก้อนเก่าสุด
  function emit(p0, hex, jitter) {
    const index = next;
    next = (next + 1) % count;
    Object.assign(parts[index], p0, { alive: true, age: 0, spin: Math.random() * Math.PI });
    mesh.setColorAt(index, color.setHex(hex).offsetHSL(0, 0, (Math.random() - 0.5) * jitter));
    anyAlive = true;
  }
  function flushColors() {
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(dt) {
    if (!anyAlive) return;
    anyAlive = false;
    parts.forEach((p, i) => {
      if (!p.alive) return;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        mesh.setMatrixAt(i, hidden);
        return;
      }
      anyAlive = true;
      const drag = Math.exp(-dt * p.drag);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = 1 - p.age / p.life;
      const s = p.size * (0.4 + 0.6 * k) * Math.min(1, p.age * 12); // พองออกนิดตอนเกิด แล้วหดจนหาย
      pos.set(p.x, p.y, p.z);
      q.setFromEuler(euler.set(p.spin, p.spin * 0.7, 0));
      scl.setScalar(s);
      mesh.setMatrixAt(i, m.compose(pos, q, scl));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { emit, flushColors, update };
}

export function createFx(scene) {
  const dust = createPool(scene, new THREE.MeshLambertMaterial({ flatShading: true }), DUST_POOL, SIZE);
  // toneMapped: false = สีไม่ถูกบีบลงตอน tone map → ประกายขาวเหลืองยังจ้าจริง
  const glow = createPool(
    scene,
    new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
    GLOW_POOL,
    GLOW_SIZE,
  );

  // ปล่อยฝุ่น n ก้อนที่ (x, y, z) · spread = กระจายแนวนอน · up = พุ่งขึ้น · back = ดันไปทางหลัง (ทิศ bx, bz)
  function puff(x, y, z, { n = 2, spread = 1.2, up = 1.2, hex = 0xd8c8a8, bx = 0, bz = 0, back = 0, size = 1 } = {}) {
    for (let k = 0; k < n; k += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.4 + Math.random() * 0.6);
      dust.emit({
        x: x + (Math.random() - 0.5) * 0.2,
        y: y + 0.05,
        z: z + (Math.random() - 0.5) * 0.2,
        vx: Math.cos(a) * s + bx * back,
        vy: up * (0.5 + Math.random() * 0.6),
        vz: Math.sin(a) * s + bz * back,
        life: 0.35 + Math.random() * 0.3,
        size: size * (0.7 + Math.random() * 0.6),
        g: 2.5,
        drag: 5, // ฝุ่นเบา ชะลอเร็ว
      }, hex, 0.08);
    }
    dust.flushColors();
  }

  // ประกายตอนตีโดน: พุ่งออกรอบทิศเร็วมากแล้วหยุดทันที (drag สูง) · อายุสั้น ให้รู้สึก "เปรี๊ยะ"
  function spark(x, y, z, { n = 12, speed = 7, hex = 0xfff1b0, size = 1, life = 0.22 } = {}) {
    for (let k = 0; k < n; k += 1) {
      // สุ่มทิศบนทรงกลม (ไม่ใช่แค่แนวนอน) ประกายจะได้แตกเป็นดาว
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.5 + Math.random() * 0.5);
      glow.emit({
        x, y, z,
        vx: Math.cos(a) * r * s,
        vy: u * s * 0.8 + 1,
        vz: Math.sin(a) * r * s,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.6 + Math.random() * 0.8),
        g: 6,
        drag: 9,
      }, hex, 0.12);
    }
    glow.flushColors();
  }

  // แสงลอยขึ้นช้าๆ: ออร่าตอนกินยา / วิญญาณหลุดตอนน็อก · กระจายเป็นวงรอบตัว
  function rise(x, y, z, { n = 14, radius = 0.5, up = 1.6, hex = 0x4ade80, size = 1, life = 0.9 } = {}) {
    for (let k = 0; k < n; k += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      glow.emit({
        x: x + Math.cos(a) * r,
        y: y + Math.random() * 0.4,
        z: z + Math.sin(a) * r,
        vx: Math.cos(a) * 0.2,
        vy: up * (0.6 + Math.random() * 0.6),
        vz: Math.sin(a) * 0.2,
        life: life * (0.6 + Math.random() * 0.6),
        size: size * (0.7 + Math.random() * 0.7),
        g: -0.4, // ค่าลบ = ลอยเร่งขึ้นนิดๆ เหมือนควัน/แสง
        drag: 1.5,
      }, hex, 0.1);
    }
    glow.flushColors();
  }

  // วงแสงขยายบนพื้นแล้วจาง (กินยา / น็อก) · เกิดไม่บ่อย จึงสร้าง mesh ใหม่ทุกครั้งแล้วทิ้งได้
  const rings = [];
  function ring(x, y, z, { hex = 0x4ade80, radius = 1.6, life = 0.5 } = {}) {
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32, 1), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.05, z);
    mesh.scale.setScalar(0.2);
    scene.add(mesh);
    rings.push({ mesh, mat, age: 0, life, radius });
  }
  function updateRings(dt) {
    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const r = rings[i];
      r.age += dt;
      const k = Math.min(1, r.age / r.life);
      r.mesh.scale.setScalar(0.2 + (r.radius - 0.2) * (1 - (1 - k) ** 3)); // ขยายเร็วตอนแรกแล้วช้าลง
      r.mat.opacity = 0.9 * (1 - k);
      if (k < 1) continue;
      scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
      rings.splice(i, 1);
    }
  }

  function update(dt) {
    dust.update(dt);
    glow.update(dt);
    updateRings(dt);
  }

  return { puff, spark, rise, ring, update };
}
