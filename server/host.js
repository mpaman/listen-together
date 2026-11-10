// กติกาการเป็น host ("ฟังตามผม") — แยกเป็น pure function เพื่อเทสได้โดยไม่ต้องมี socket
//
// แย่ง host ได้เสมอ แต่ถ้า host เดิม "กำลังเปิดเพลงให้ห้องฟังอยู่" ต้องถามคนที่กดก่อน (กันกดพลาดไปตัดเพลงเพื่อน)
// host หลุด หรือไม่ได้เล่นเพลงนานแล้ว → ถือว่าไม่มีใครใช้ แย่งได้เลยไม่ต้องถาม

// เพิ่งได้เป็น host ภายในเวลานี้ → ยังแย่งไม่ได้ (กันสองคนกดแย่งกันไปมาจนเพลงสะดุด)
export const HOST_TAKEOVER_COOLDOWN_MS = 10_000;
// host ไม่ได้เล่นเพลงเกินเวลานี้ (หยุดไว้ / ปิดแท็บ YouTube Music) → แย่งได้ไม่ต้องถาม
export const HOST_IDLE_MS = 2 * 60 * 1000;
// host หลุดการเชื่อมต่อ → รอให้ต่อกลับมาเท่านี้ก่อนคืนห้องให้ทุกคนคุม
export const HOST_GRACE_MS = 30_000;

/**
 * ตัดสินว่าคนที่กด "ฟังตามผม" ได้เป็น host ไหม
 * คืน 'start' | 'same' (เป็นอยู่แล้ว) | 'cooldown' | 'confirm' (ต้องถามก่อนแย่ง)
 */
export function decideHostStart({ host, socketId, hostConnected, since, activeAt, now, force }) {
  if (!host) return 'start';
  if (host.socketId === socketId) return 'same';
  if (!hostConnected) return 'start';
  if (now - since < HOST_TAKEOVER_COOLDOWN_MS) return 'cooldown';
  const isActive = now - activeAt < HOST_IDLE_MS;
  return isActive && !force ? 'confirm' : 'start';
}

export const cooldownLeftSec = (since, now) => Math.max(1, Math.ceil((HOST_TAKEOVER_COOLDOWN_MS - (now - since)) / 1000));
