// ส่วนคำนวณของเนื้อเพลง (ไม่แตะ DOM) — แยกไว้ให้ test ด้วย node ได้

// บรรทัดที่ควรไฮไลต์ ณ เวลา t = บรรทัดสุดท้ายที่เวลาเริ่ม ≤ t · ยังไม่ถึงบรรทัดแรก = -1
// ค้นแบบ binary search เพราะเรียกทุกเฟรม (~60 ครั้ง/วิ)
export function activeIndex(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// ปรับเวลาเนื้อเพลง (MV มักมีฉากเปิดก่อนเข้าเพลง เนื้อจากอัลบั้มเลยมาก่อนเสียง)
// ค่าบวก = เลื่อนเนื้อให้ช้าลง · จำแยกต่อเพลง เก็บแค่เพลงล่าสุด MAX_SAVED เพลง กัน localStorage โต
export const OFFSET_STEP = 0.5;
export const OFFSET_LIMIT = 30;
const MAX_SAVED = 200;

export function clampOffset(value) {
  const n = Math.round((Number(value) || 0) / OFFSET_STEP) * OFFSET_STEP;
  // `|| 0` เปลี่ยน -0 (จากปัด -0.2) เป็น 0 — ไม่งั้นเทียบ/เก็บแล้วดูเหมือนตั้งค่าไว้
  return Math.min(OFFSET_LIMIT, Math.max(-OFFSET_LIMIT, n)) || 0;
}

// คืน object ใหม่ (ไม่แก้ของเดิม) · ค่า 0 = ลบทิ้ง · เกินจำนวน → ตัดเพลงที่ตั้งไว้นานสุดออก
export function withOffset(saved, videoId, value) {
  const next = { ...saved };
  delete next[videoId];
  const offset = clampOffset(value);
  if (offset !== 0) next[videoId] = offset;
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_SAVED))) delete next[key];
  return next;
}

// "+1.5 วิ" / "−2 วิ" / "ตรงเวลา"
export function formatOffset(offset) {
  if (!offset) return 'ตรงเวลา';
  const sign = offset > 0 ? '+' : '−';
  return `${sign}${Math.abs(offset)} วิ`;
}

// เพลงไทยอยู่แล้ว (ตัวอักษรไทย ≥30% ของตัวอักษรทั้งหมด) → ไม่ต้องโชว์ปุ่มแปลไทย
// ตัวเลขเดียวกับ server/translate.js · ฝั่งเว็บใช้ตัดสินว่าจะโชว์ปุ่มไหม โดยไม่ต้องยิงไปแปลก่อน
export function isMostlyThai(texts) {
  const all = texts.join('');
  const letters = all.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return false;
  return (all.match(/[฀-๿]/g)?.length ?? 0) / letters >= 0.3;
}
