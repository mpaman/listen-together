// content script บนเว็บห้องฟังเพลง: ตัวกลางระหว่างหน้าเว็บ (public/host-link.js) กับ background
// หน้าเว็บส่ง { source: 'lt-page', type: 'ping' | 'poll', id } · เราตอบ { source: 'lt-ext', type, id, ... }
// และส่งสถานะเพลงจาก YouTube Music เข้ามาเป็น { source: 'lt-ext', type: 'ytm', state }
(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const reply = (payload) => window.postMessage({ source: 'lt-ext', ...payload }, location.origin);

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'lt-page') return;
    const { type, id } = e.data;
    if (type === 'ping') return reply({ type: 'pong', id, version: VERSION });
    if (type === 'poll') {
      let found = false;
      try {
        found = Boolean((await chrome.runtime.sendMessage({ type: 'site:poll' }))?.found);
      } catch {
        // reload extension แล้วยังไม่ได้รีเฟรชหน้านี้
      }
      reply({ type: 'poll-result', id, found });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'ytm:state' && msg.state) reply({ type: 'ytm', state: msg.state });
  });
})();
