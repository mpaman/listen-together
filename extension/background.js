// ตัวส่งต่อข้อความระหว่างแท็บ YouTube Music กับแท็บเว็บห้องฟังเพลง (content script คุยข้ามแท็บกันเองไม่ได้)
//
// ไม่เก็บสถานะอะไรเลย: service worker ของ MV3 ถูกปิดได้ทุกเมื่อ ถ้าจำ "แท็บไหนเป็น host" ไว้จะหายตอนถูกปิด
// เลยส่งสถานะเพลงให้ทุกแท็บของเว็บห้อง แล้วให้หน้าเว็บเลือกเองว่าจะใช้ไหม (ใช้เฉพาะตอนเป็น host)
const SITE_URLS = ['https://listen-with-chok.onrender.com/*', 'http://localhost/*', 'http://127.0.0.1/*'];
const YTM_URLS = ['https://music.youtube.com/*'];

async function sendToTabs(urls, message) {
  const tabs = await chrome.tabs.query({ url: urls });
  // แท็บที่ content script ยังไม่โหลด (เพิ่งเปิด/เปิดไว้ก่อนติดตั้ง) จะ reject → ข้าม
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
  return tabs.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ytm:state') {
    sendToTabs(SITE_URLS, msg);
    return false;
  }
  if (msg?.type === 'site:poll') {
    sendToTabs(YTM_URLS, { type: 'ytm:poll' }).then((count) => sendResponse({ found: count > 0 }));
    return true; // ตอบแบบ async
  }
  return false;
});
