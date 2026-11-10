// คุยกับ Chrome extension "ฟังเพลงกับ chok — host" ผ่าน window.postMessage
//
// ทำไมต้องมี extension: browser ไม่ยอมให้เว็บหนึ่งอ่านแท็บของอีกเว็บ หน้านี้เลยมองไม่เห็นว่า
// แท็บ music.youtube.com เล่นเพลงอะไรอยู่ · extension มี content script ฝังในหน้านี้ (bridge.js)
// คอยส่งต่อสถานะเพลงจากแท็บ YouTube Music เข้ามา
//
// รูปแบบข้อความ: หน้านี้ส่ง { source: 'lt-page', type, id } · extension ตอบ { source: 'lt-ext', type, id, ... }

const PAGE = 'lt-page';
const EXT = 'lt-ext';
const DETECT_TIMEOUT_MS = 600;
const POLL_TIMEOUT_MS = 2000;

export function createHostLink({ onYtm }) {
  const pending = new Map(); // id → resolve
  let seq = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== EXT) return;
    const msg = e.data;
    if (msg.type === 'ytm' && msg.state && typeof msg.state === 'object') return onYtm(msg.state);
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  });

  function request(type, timeoutMs) {
    seq += 1;
    const id = seq;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      window.postMessage({ source: PAGE, type, id }, location.origin);
      setTimeout(() => {
        if (pending.delete(id)) resolve(null);
      }, timeoutMs);
    });
  }

  return {
    // มี extension ติดตั้งไหม (ไม่ตอบในเวลา = ไม่มี)
    detect: async () => Boolean(await request('ping', DETECT_TIMEOUT_MS)),
    // ขอสถานะเพลงทันที (ไม่ต้องรอรอบถัดไป) · คืน true ถ้าเจอแท็บ YouTube Music อย่างน้อย 1 แท็บ
    poll: async () => Boolean((await request('poll', POLL_TIMEOUT_MS))?.found),
  };
}
