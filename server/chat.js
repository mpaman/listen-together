// แชทในห้อง — ฟังก์ชันล้วน ไม่ยุ่ง socket (test ได้ตรงๆ)
export const MAX_CHAT_LEN = 300;
export const CHAT_HISTORY = 50;
export const CHAT_BURST = 5; // ส่งได้กี่ข้อความ…
export const CHAT_WINDOW_MS = 10_000; // …ต่อช่วงเวลานี้

// ตัดอักขระควบคุม (ยกเว้นขึ้นบรรทัดใหม่) + ยุบบรรทัดว่างซ้อน · ว่าง/ไม่ใช่ข้อความ → null
export function cleanChatText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHAT_LEN);
  return text || null;
}

// คืน array ใหม่ เก็บแค่ N ข้อความล่าสุด (คนเข้าห้องทีหลังได้เห็นย้อนหลัง)
export const appendChat = (log, message, max = CHAT_HISTORY) => [...log, message].slice(-max);

// sliding window ต่อคน: เก็บเวลาที่ส่งล่าสุด ไม่เกิน burst ครั้งในหน้าต่าง
export function createChatLimiter(burst = CHAT_BURST, windowMs = CHAT_WINDOW_MS) {
  let sent = [];
  return (now) => {
    sent = sent.filter((t) => now - t < windowMs);
    if (sent.length >= burst) return false;
    sent = [...sent, now];
    return true;
  };
}
