// ส่วนคำนวณ (ไม่แตะ DOM) ของ "จอ MV บนเวที" — แยกไว้ให้ test ด้วย node ได้
//
// แนวคิด: ไม่สร้างตัวเล่น YouTube ตัวที่สอง (กินเน็ตสองเท่า + เวลาคลาดกับห้อง)
// แต่ยกตัวเล่นที่เล่นอยู่แล้วมาวางทับจอบนเวทีด้วย CSS transform
// จอในฉาก 3D เมื่อมองจากกล้องเป็นสี่เหลี่ยมคางหมู → ต้องใช้ projective transform (matrix3d) ไม่ใช่แค่ย่อ/ขยาย

// หา matrix3d ที่พาสี่เหลี่ยม w×h (มุม 0,0 → w,0 → w,h → 0,h) ไปลงจุด 4 มุม quad (ลำดับเดียวกัน)
// สูตร unit square → quad ของ Heckbert (1989) แล้วหารขนาด w,h เข้าไป · ใช้กับ transform-origin: 0 0
export function quadMatrix(w, h, quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let k = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-9) return null; // มุมซ้อนกัน/บิดจนเป็นเส้น → วาดไม่ได้
    g = (dx3 * dy2 - dx2 * dy3) / det;
    k = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  // column-major ตามที่ CSS matrix3d ต้องการ
  return [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
}

// ใช้ matrix กับจุด (x, y) บนสี่เหลี่ยมเดิม → จุดบนจอ (ไว้ test ว่า matrix ถูก)
export function applyMatrix(m, x, y) {
  const X = m[0] * x + m[4] * y + m[12];
  const Y = m[1] * x + m[5] * y + m[13];
  const W = m[3] * x + m[7] * y + m[15];
  return [X / W, Y / W];
}

// ทุกมุมอยู่ในกรอบลาน (เผื่อขอบ pad px) → โชว์ MV ได้ · ล้นกรอบ = วิดีโอจะลอยทับหัวเกม → ใช้จอแบบตัวหนังสือแทน
export function quadInside(quad, width, height, pad = 1) {
  return quad.every(([x, y]) => x >= -pad && y >= -pad && x <= width + pad && y <= height + pad);
}
