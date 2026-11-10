// รันใน "โลกของหน้าเว็บ" music.youtube.com (world: MAIN) เพราะต้องเรียก method ของตัวเล่น YouTube ตรงๆ
// content script ปกติ (isolated) เห็นแค่ DOM เรียก movie_player.getVideoData() ไม่ได้
//
// ทำไมไม่อ่าน videoId จาก URL: ถ้าผู้ใช้กดไปหน้าอื่นใน YouTube Music (เช่นหน้าศิลปิน) เพลงยังเล่นต่อในแถบล่าง
// แต่ URL ไม่มี ?v= แล้ว · getVideoData() บอกเพลงที่ตัวเล่นเล่นอยู่จริงเสมอ
//
// ส่งให้ ytm-relay.js ผ่าน window.postMessage (ตัวนี้เรียก chrome.runtime ไม่ได้)
(() => {
  const SOURCE = 'lt-ytm';
  const TICK_MS = 1000;
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function readState() {
    const player = document.getElementById('movie_player');
    const video = document.querySelector('video');
    if (!player || typeof player.getVideoData !== 'function' || !video) return null;
    const data = player.getVideoData() || {};
    if (!VIDEO_ID_RE.test(data.video_id ?? '')) return null;
    // ระหว่างโฆษณา (บัญชีไม่มี Premium) เวลาใน <video> เป็นของโฆษณา ไม่ใช่ของเพลง
    const isAd = player.classList.contains('ad-showing');
    return {
      videoId: data.video_id,
      title: data.title ?? '',
      channel: data.author ?? '',
      position: video.currentTime || 0,
      isPlaying: !video.paused && !video.ended,
      isAd,
      at: Date.now(),
    };
  }

  function send() {
    const state = readState();
    if (state) window.postMessage({ source: SOURCE, state }, location.origin);
  }

  // event ของ <video> ไม่ bubble แต่จับได้ด้วย capture · ฟังที่ document เผื่อ YouTube เปลี่ยน <video> ตัวใหม่
  for (const type of ['play', 'pause', 'seeked', 'loadeddata', 'ended']) {
    document.addEventListener(type, send, true);
  }
  setInterval(send, TICK_MS);

  // หน้าเว็บห้องเพิ่งกด "ฟังตามผม" → ขอสถานะทันทีไม่ต้องรอรอบถัดไป
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.source === 'lt-relay' && e.data.type === 'poll') send();
  });
})();
