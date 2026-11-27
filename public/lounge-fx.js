// เอฟเฟกต์อนุภาคแบบพิกเซล: ฝุ่นตอนวิ่ง / ลงพื้น / ออกตัวกระโดด
// ใช้ InstancedMesh ก้อนเดียว + pool คงที่ → ไม่สร้าง object ใหม่ทุกเฟรม (ไม่กระตุกจาก GC)
// ฝุ่นไม่จางด้วย opacity (ทำต่อชิ้นใน instanced ไม่ได้) แต่ "หดจนหาย" แทน — เข้ากับภาพ voxel
import * as THREE from 'three';

const POOL = 96;
const SIZE = 0.13;

export function createFx(scene) {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(SIZE, SIZE, SIZE),
    new THREE.MeshLambertMaterial({ flatShading: true }),
    POOL,
  );
  mesh.frustumCulled = false; // อนุภาคกระจายทั่วลาน bounding sphere ของ mesh ไม่ตาม
  mesh.castShadow = false;
  scene.add(mesh);

  // แต่ละช่อง: ตำแหน่ง ความเร็ว อายุ
  const parts = Array.from({ length: POOL }, () => ({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1, spin: 0 }));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < POOL; i += 1) mesh.setMatrixAt(i, hidden);
  mesh.instanceMatrix.needsUpdate = true;
  let next = 0;
  let anyAlive = false;

  // ปล่อยฝุ่น n ก้อนที่ (x, y, z) · spread = กระจายแนวนอน · up = พุ่งขึ้น · back = ดันไปทางหลัง (ทิศ bx, bz)
  function puff(x, y, z, { n = 2, spread = 1.2, up = 1.2, hex = 0xd8c8a8, bx = 0, bz = 0, back = 0, size = 1 } = {}) {
    for (let k = 0; k < n; k += 1) {
      const index = next;
      const p = parts[index];
      next = (next + 1) % POOL; // pool เต็ม → ทับก้อนเก่าสุด
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.4 + Math.random() * 0.6);
      Object.assign(p, {
        alive: true,
        x: x + (Math.random() - 0.5) * 0.2,
        y: y + 0.05,
        z: z + (Math.random() - 0.5) * 0.2,
        vx: Math.cos(a) * s + bx * back,
        vy: up * (0.5 + Math.random() * 0.6),
        vz: Math.sin(a) * s + bz * back,
        age: 0,
        life: 0.35 + Math.random() * 0.3,
        size: size * (0.7 + Math.random() * 0.6),
        spin: Math.random() * Math.PI,
      });
      mesh.setColorAt(index, color.setHex(hex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    anyAlive = true;
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
      const drag = Math.exp(-dt * 5); // ฝุ่นเบา ชะลอเร็ว
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - 2.5 * dt;
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

  return { puff, update };
}
