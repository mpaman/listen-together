// กฎชื่อห้อง — ต้องตรงกับ normalizeRoomId ใน server/validate.js (server ตรวจซ้ำอีกชั้นเสมอ)
const ROOM_ID_RE = /^[\p{L}\p{M}\p{N}-]{2,32}$/u;
const SUGGESTIONS = ['ห้องนั่งเล่น', 'ดึกนี้', 'ร้านแผ่นเสียง', 'ห้องซ้อม', 'วงข้าวต้ม'];

export function normalizeRoomId(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export const isRoomId = (value) => ROOM_ID_RE.test(value);

export function suggestRoomName() {
  const base = SUGGESTIONS[Math.floor(Math.random() * SUGGESTIONS.length)];
  return `${base}-${Math.floor(10 + Math.random() * 90)}`;
}
