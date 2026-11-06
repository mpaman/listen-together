// แจ้งเตือนแชทตอนผู้ใช้ไปอยู่แท็บอื่น: เสียง "ติ๊ง" + ตัวเลขบนชื่อแท็บ
// เสียงสังเคราะห์ด้วย Web Audio (ไม่ต้องมีไฟล์เสียง) · browser ไม่ยอมให้เล่นเสียงก่อนผู้ใช้กดอะไรสักอย่าง
// → ต้องเรียก unlock() ตอนกด "เข้าร่วมฟัง" ครั้งแรก
const SOUND_KEY = 'listen-together:chat-sound';
const MIN_GAP_MS = 3000; // แชทรัวๆ ไม่ให้ดังถี่จนรำคาญ

function readEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true; // อ่านค่าไม่ได้ → เปิดเสียงไว้ตามค่าเริ่มต้น
  }
}

export function createNotifier() {
  const baseTitle = document.title;
  let ctx = null;
  let enabled = readEnabled();
  let lastDing = 0;
  let unseen = 0;

  // สร้าง/ปลุก AudioContext ระหว่างที่ผู้ใช้กดปุ่มอยู่ ไม่งั้น browser จะเริ่มแบบ suspended แล้วเงียบ
  function unlock() {
    const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioCtx) return;
    ctx ??= new AudioCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  // ติ๊ง 2 โน้ต (E6 → A6) เบาๆ สั้นๆ — แยกออกจากเสียงเพลงที่เปิดอยู่ได้
  function ding(now) {
    if (!enabled || !ctx || ctx.state !== 'running' || now - lastDing < MIN_GAP_MS) return;
    lastDing = now;
    const start = ctx.currentTime;
    [1318.5, 1760].forEach((freq, i) => {
      const t = start + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  function renderTitle() {
    document.title = unseen > 0 ? `(${unseen}) ${baseTitle}` : baseTitle;
  }

  // กลับมาที่แท็บนี้ = เห็นแล้ว ล้างตัวเลข
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    unseen = 0;
    renderTitle();
  });

  return {
    unlock,
    // เรียกเมื่อมีข้อความของคนอื่นเข้ามา — แจ้งเฉพาะตอนอยู่แท็บอื่น
    chat() {
      if (!document.hidden) return;
      unseen += 1;
      renderTitle();
      ding(Date.now());
    },
    isEnabled: () => enabled,
    setEnabled(on) {
      enabled = on;
      try {
        localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
      } catch {
        // จำค่าไม่ได้ก็แค่กลับเป็นเปิดเสียงตอนโหลดใหม่
      }
      if (on) unlock(); // กดเปิดเสียง = มีการกดของผู้ใช้ ปลุก AudioContext ได้เลย
    },
  };
}
