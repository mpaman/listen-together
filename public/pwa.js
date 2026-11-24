// ให้เว็บเปิดค้างได้แบบแอป:
//  1) service worker → "ติดตั้งลงเครื่อง" ได้ (เปิดเต็มจอ ไม่มีแถบ browser) และหน้าเว็บขึ้นเร็วตอนเปิดซ้ำ
//  2) Wake Lock → สั่งไม่ให้จอดับเอง — มือถือจอดับเมื่อไร YouTube embed หยุดเพลง (ข้อจำกัดของ YouTube แก้ไม่ได้)
//     เลยทำได้แค่กันจอดับระหว่างเปิดหน้านี้อยู่
//  3) Media Session → ชื่อเพลง/ปก/ปุ่มเล่น-ข้าม บนแถบแจ้งเตือนและหน้าจอล็อก (กดแล้วส่งคำสั่งเข้าห้องเหมือนกดในเว็บ)

const WAKE_KEY = 'listen-together:wake';

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // ลงทะเบียนหลังหน้าโหลดเสร็จ ไม่แย่งเน็ตกับตัวเล่น YouTube ตอนเปิดหน้า
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[sw]', err.message));
  });
}

export function createWakeLock(button, { onNotice }) {
  if (!('wakeLock' in navigator)) {
    button.hidden = true; // browser ไม่รองรับ (เช่น Firefox) → ไม่โชว์ปุ่มที่กดแล้วไม่มีผล
    return;
  }
  let wanted = false;
  let lock = null;

  const render = () => button.setAttribute('aria-pressed', String(wanted));

  async function acquire() {
    if (!wanted || lock || document.hidden) return;
    try {
      lock = await navigator.wakeLock.request('screen');
      // ระบบปล่อย lock เอง (สลับแท็บ/แบตต่ำ) → ล้างค่า รอขอใหม่ตอนกลับมา
      lock.addEventListener('release', () => (lock = null));
    } catch (err) {
      wanted = false;
      render();
      onNotice(`กันจอดับไม่ได้: ${err.message}`);
    }
  }

  function setWanted(on) {
    wanted = on;
    try {
      localStorage.setItem(WAKE_KEY, on ? '1' : '');
    } catch {
      // ไม่เป็นไร
    }
    render();
    if (on) acquire();
    else lock?.release();
  }

  button.hidden = false;
  button.addEventListener('click', () => {
    setWanted(!wanted);
    onNotice(wanted ? 'จอจะไม่ดับเองระหว่างเปิดหน้านี้' : 'ให้จอดับตามปกติแล้ว');
  });
  // ทุกครั้งที่กลับมาที่หน้านี้ lock เดิมหายไปแล้ว (กฎของ browser) → ขอใหม่
  document.addEventListener('visibilitychange', acquire);
  try {
    wanted = localStorage.getItem(WAKE_KEY) === '1';
  } catch {
    wanted = false;
  }
  render();

  // browser ยอมให้ขอ lock เฉพาะหลังผู้ใช้กดอะไรสักอย่าง → เรียกตอนผ่านหน้าเข้าห้อง
  return { resume: acquire };
}

export function createMediaSession({ onAction }) {
  const session = navigator.mediaSession;
  if (!session) return { update() {} };
  const actions = { play: 'play', pause: 'pause', nexttrack: 'next', previoustrack: 'prev' };
  for (const [name, type] of Object.entries(actions)) {
    try {
      session.setActionHandler(name, () => onAction({ type }));
    } catch {
      // browser บางตัวไม่รู้จักบาง action
    }
  }
  let lastKey = null;
  return {
    update(item, isPlaying) {
      session.playbackState = item ? (isPlaying ? 'playing' : 'paused') : 'none';
      const key = item?.id ?? null;
      if (key === lastKey) return;
      lastKey = key;
      session.metadata = item
        ? new MediaMetadata({
            title: item.title,
            artist: String(item.channel ?? '').replace(/\s*-\s*Topic$/i, ''),
            album: 'ฟังเพลงกับ chok',
            artwork: [
              { src: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`, sizes: '320x180', type: 'image/jpeg' },
              { src: `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`, sizes: '480x360', type: 'image/jpeg' },
            ],
          })
        : null;
    },
  };
}
