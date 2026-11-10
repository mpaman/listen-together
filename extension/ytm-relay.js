// content script ปกติบน music.youtube.com: ตัวกลางระหว่าง ytm-main.js (โลกของหน้าเว็บ) กับ background
(() => {
  // reload extension แล้วสคริปต์เก่าในแท็บที่เปิดค้างจะเรียก chrome.runtime ไม่ได้ (throw ทันที) → เงียบไว้
  // ผู้ใช้แค่ต้องรีเฟรชแท็บ YouTube Music
  function toBackground(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // context หลุด
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'lt-ytm' || !e.data.state) return;
    toBackground({ type: 'ytm:state', state: e.data.state });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ytm:poll') window.postMessage({ source: 'lt-relay', type: 'poll' }, location.origin);
  });
})();
