// จอบนเวที แสดงได้ 3 แบบ (เลือกต่อเครื่อง ไม่กระทบคนอื่นในห้อง):
//   video  = MV ตามปกติ
//   cover  = ฟังอย่างเดียว: ปกเพลง + พื้นเบลอจากปก แทนวิดีโอ
//   lyrics = เนื้อเพลงวิ่งตามเพลง บนพื้นเบลอจากปก
// ตัวเล่น YouTube ยังอยู่ข้างหลังเสมอ (แค่ถูกบัง) — ถ้าเอาออกจากหน้า เพลงจะหยุดและหลุด sync
const VIEW_KEY = 'listen-together:view';
const VIEWS = new Set(['video', 'cover', 'lyrics']);
const $ = (id) => document.getElementById(id);

// hqdefault = 480×360 มีขอบดำบนล่าง (ภาพจริง 480×270 ตรงกลาง) → CSS ขยาย 4/3 เท่าแล้วตัดกลางให้ขอบดำหลุดกรอบ
const coverUrl = (videoId) => `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

function loadView() {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return VIEWS.has(saved) ? saved : 'video';
  } catch {
    return 'video';
  }
}

export function createStageView({ onChange }) {
  const stage = document.querySelector('.stage');
  const buttons = [...document.querySelectorAll('.view-switch [data-view]')];
  let view = loadView();
  let videoId = null;

  function apply() {
    stage.dataset.view = view;
    for (const btn of buttons) btn.setAttribute('aria-checked', String(btn.dataset.view === view));
    $('screen-art').hidden = view === 'video';
    $('lyrics').hidden = view !== 'lyrics';
    $('cover-art').hidden = view !== 'cover';
    onChange(view);
  }

  function setView(next) {
    if (!VIEWS.has(next) || next === view) return;
    view = next;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // จำไม่ได้ก็แค่กลับเป็น MV ตอนเปิดใหม่
    }
    apply();
  }

  for (const btn of buttons) btn.addEventListener('click', () => setView(btn.dataset.view));
  // ลูกศรซ้าย/ขวาในกลุ่มปุ่ม (radiogroup มาตรฐาน)
  buttons[0].parentElement.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = buttons.findIndex((btn) => btn.dataset.view === view);
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
    setView(next.dataset.view);
    next.focus();
  });
  apply();

  return {
    view: () => view,
    setItem(item) {
      const next = item?.videoId ?? null;
      if (next === videoId) return;
      videoId = next;
      const url = next ? `url("${coverUrl(next)}")` : 'none';
      $('screen-art').style.setProperty('--cover', url);
    },
  };
}
