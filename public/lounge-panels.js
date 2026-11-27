// แผงลอยบนลาน 3D: วิธีเล่น (ปุ่ม ?) · แต่งตัว · เมนูประลอง
// เปิดได้ทีละแผง · Esc/ปุ่ม X ปิดแล้วคืน focus ให้ปุ่มที่กดเปิด · ไม่ปิดเมื่อคลิกฉาก (แต่งตัวอยู่ก็หมุนกล้องดูตัวเองได้)
import { WEAPONS, WEAPON_KINDS } from './arena-rules.js';
import { BODY_COLORS, LOOK_PARTS, SKIN_COLORS } from './lounge-avatar.js';
import { BACK_NAMES, OUTFIT_NAMES } from './lounge-outfit.js';

// คอม = มีเมาส์และ hover ได้ (แล็ปท็อปจอสัมผัสก็นับเป็นคอมเพราะ pointer หลักยังเป็นเมาส์/ทัชแพด)
export const desktopQuery = matchMedia('(hover: hover) and (pointer: fine)');
export const isDesktop = () => desktopQuery.matches;

const BODY_NAMES = ['แดง', 'ฟ้า', 'เขียว', 'เหลืองทอง', 'ม่วงชมพู', 'ฟ้าอ่อน', 'ส้ม', 'เทา', 'เขียวเข้ม', 'ม่วงเข้ม'];
const SKIN_NAMES = ['ผิวอ่อน', 'ผิวสองสี', 'ผิวแทน', 'ผิวคล้ำ', 'ผิวเข้ม', 'ผิวขาว'];
const HAT_NAMES = ['ไม่ใส่', 'หมวกไหมพรม', 'หมวกแก๊ป', 'หมวกปาร์ตี้', 'หูแมว', 'หูฟัง', 'มงกุฎ'];
const FACE_NAMES = ['ปกติ', 'ยิ้มแก้มแดง', 'ตาหยี', 'ใส่แว่น'];
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// ส่วนที่เลือกได้ในหน้าแต่งตัว (ลำดับ = ลำดับแถว)
const PARTS = [
  { key: 'body', label: 'สีเสื้อ', names: BODY_NAMES, swatch: (i) => hex(BODY_COLORS[i]) },
  { key: 'outfit', label: 'แบบชุด', names: OUTFIT_NAMES },
  { key: 'back', label: 'ของบนหลัง', names: BACK_NAMES },
  { key: 'hat', label: 'หมวก', names: HAT_NAMES },
  { key: 'face', label: 'หน้า', names: FACE_NAMES },
  { key: 'skin', label: 'สีผิว', names: SKIN_NAMES, swatch: (i) => SKIN_COLORS[i] },
];

// ---------- วิธีเล่น ----------
// แถว = [ไอคอน, ปุ่มที่กด (keycap), คำอธิบาย]
const DESKTOP_GUIDE = [
  ['ลานฟังเพลง', [
    ['i-mouse', ['คลิกพื้น'], 'เดินไปตรงนั้น · คลิกโซฟา = นั่ง'],
    ['i-locate', ['W', 'A', 'S', 'D'], 'เดิน (ใช้ลูกศรก็ได้) · กด Shift ค้าง = วิ่ง'],
    ['i-jump', ['Space'], 'กระโดด ปีนขึ้นที่สูงได้'],
    ['i-punch', ['F'], 'ต่อยคนข้างหน้า'],
    ['i-sit', ['E'], 'นั่ง / ลุก'],
    ['i-drop', ['G'], 'วางของที่ถือ (เดินทับของบนพื้น = เก็บเอง)'],
    ['i-mouse', ['คลิกขวาลาก'], 'หมุนกล้อง · R = กลับมุมเดิม'],
    ['i-plus', ['ล้อเมาส์', '+', '−'], 'ซูมเข้า / ออก'],
    ['i-note', [], 'ยืนบนพรมแดงตอนเพลงเล่น = เต้นเอง'],
    ['i-spark', ['P'], 'โชว์ FPS'],
  ]],
  ['ปุ่มด้านล่าง', [
    ['i-wave', [], 'อีโมต: โบกมือ เต้น หัวเราะ ฯลฯ ทุกคนในห้องเห็น'],
    ['i-sword', [], 'ประลอง: หาคู่ (คนจริง) · สู้กับ NPC · ลองอาวุธ'],
    ['i-dice', [], 'สุ่มตัวละครใหม่ทั้งตัว'],
    ['i-shirt', [], 'แต่งตัวเอง เลือกทีละส่วน'],
  ]],
  ['ในลานประลอง', [
    ['i-punch', ['F'], 'โจมตีด้วยอาวุธที่ถือ (คู่อยู่ใกล้ หันไปหาให้เอง)'],
    ['i-sword', ['E'], 'สลับกับอาวุธบนพื้นที่ยืนใกล้'],
    ['i-jump', ['Space'], 'กระโดดหลบค้อนกับลูกธนู'],
    ['i-heart', [], 'เลือด 100 · หมดก่อนแพ้ · ครบ 90 วิ เลือดมากกว่าชนะ'],
  ]],
];

const TOUCH_GUIDE = [
  ['ลานฟังเพลง', [
    ['i-locate', ['แตะพื้น'], 'เดินไปตรงนั้น · แตะโซฟา = นั่ง'],
    ['i-plus', ['ถ่างนิ้ว'], 'ซูมกล้อง (หรือกดปุ่ม − +)'],
    ['i-drop', [], 'เดินทับของบนพื้น = เก็บ · ปุ่ม "วางของ" = วาง'],
    ['i-note', [], 'ยืนบนพรมแดงตอนเพลงเล่น = เต้นเอง'],
  ]],
  ['ปุ่มด้านล่าง', [
    ['i-jump', [], 'กระโดด'],
    ['i-punch', [], 'ต่อยคนข้างหน้า'],
    ['i-sit', [], 'นั่ง / ลุก'],
    ['i-wave', [], 'อีโมต: ทุกคนในห้องเห็น'],
    ['i-dice', [], 'สุ่มตัวละครใหม่'],
    ['i-shirt', [], 'แต่งตัวเอง'],
    ['i-sword', [], 'ลานประลองเล่นได้บนคอมเท่านั้น (ต้องใช้คีย์บอร์ด)'],
  ]],
];

const icon = (id) => `<svg class="icon" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function guideHtml() {
  const sections = (isDesktop() ? DESKTOP_GUIDE : TOUCH_GUIDE).map(([title, rows]) => `
    <h4>${title}</h4>
    <ul class="guide-list">${rows.map(([ic, keys, text]) => `
      <li><span class="guide-icon">${icon(ic)}</span><span class="guide-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span class="guide-text">${esc(text)}</span></li>`).join('')}
    </ul>`);
  if (isDesktop()) {
    // อาวุธ 6 ชิ้น: จุดเด่น/จุดด้อย ดึงจากกติกาเดียวกับ server (แก้ตัวเลขที่ arena-rules.js ที่เดียว)
    sections.push(`<h4>อาวุธในลาน</h4><ul class="guide-weapons">${WEAPON_KINDS.map((k) => {
      const w = WEAPONS[k];
      return `<li><strong>${esc(w.name)}</strong> <span class="guide-dmg">${w.dmg} ดาเมจ</span><span class="is-pro">+ ${esc(w.pro)}</span><span class="is-con">− ${esc(w.con)}</span></li>`;
    }).join('')}</ul>`);
  }
  return sections.join('');
}

// ---------- แผงทั้งหมด ----------
export function createPanels({ getLook, setLook, randomLook }) {
  const panels = {
    guide: { el: document.getElementById('guide-panel'), trigger: document.getElementById('guide-btn') },
    wardrobe: { el: document.getElementById('wardrobe-panel'), trigger: document.getElementById('wardrobe-btn') },
    duel: { el: document.getElementById('duel-panel'), trigger: document.querySelector('.lounge-actions [data-act="duel"]') },
  };
  let openName = null;

  function close(returnFocus = true) {
    if (!openName) return;
    const p = panels[openName];
    p.el.hidden = true;
    p.trigger?.setAttribute('aria-expanded', 'false');
    openName = null;
    if (returnFocus) p.trigger?.focus();
  }

  function open(name) {
    if (openName === name) return close();
    close(false);
    const p = panels[name];
    if (name === 'guide') document.getElementById('guide-body').innerHTML = guideHtml();
    if (name === 'wardrobe') renderWardrobe();
    p.el.hidden = false;
    p.trigger?.setAttribute('aria-expanded', 'true');
    openName = name;
    p.el.querySelector('button:not(.panel-close):not(:disabled)')?.focus({ preventScroll: true });
  }

  for (const p of Object.values(panels)) p.el.querySelector('.panel-close').addEventListener('click', () => close());
  panels.guide.trigger.addEventListener('click', () => open('guide'));
  panels.wardrobe.trigger.addEventListener('click', () => open('wardrobe'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openName) close();
    // ? (Shift+/) เปิดวิธีเล่น ตอนไม่ได้พิมพ์อยู่
    if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) open('guide');
  });
  // สลับจอ/เสียบเมาส์ระหว่างเปิดอยู่ → คู่มือเปลี่ยนชุดตาม
  desktopQuery.addEventListener('change', () => {
    if (openName === 'guide') document.getElementById('guide-body').innerHTML = guideHtml();
    if (openName === 'duel' && !isDesktop()) close(false);
  });

  // ---------- แต่งตัว ----------
  const rows = document.getElementById('wardrobe-rows');
  function renderWardrobe() {
    const look = getLook();
    rows.innerHTML = PARTS.map((part) => {
      const i = look[part.key] ?? 0;
      const swatch = part.swatch ? `<i class="swatch" style="background:${part.swatch(i)}"></i>` : '';
      return `<div class="wardrobe-row" data-part="${part.key}">
        <span class="wardrobe-label" id="wl-${part.key}">${part.label}</span>
        <button type="button" class="icon-btn" data-step="-1" aria-label="${part.label}ก่อนหน้า">${icon('i-chevron-left')}</button>
        <span class="wardrobe-value" aria-live="polite" aria-labelledby="wl-${part.key}">${swatch}<span>${esc(part.names[i] ?? i + 1)}</span><small>${i + 1}/${LOOK_PARTS[part.key]}</small></span>
        <button type="button" class="icon-btn" data-step="1" aria-label="${part.label}ถัดไป">${icon('i-chevron-right')}</button>
      </div>`;
    }).join('');
  }
  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    const key = btn.closest('[data-part]').dataset.part;
    const n = LOOK_PARTS[key];
    const look = getLook();
    setLook({ ...look, [key]: (((look[key] ?? 0) + Number(btn.dataset.step)) % n + n) % n });
    renderWardrobe();
    rows.querySelector(`[data-part="${key}"] [data-step="${btn.dataset.step}"]`)?.focus();
  });
  document.getElementById('wardrobe-random').addEventListener('click', () => {
    setLook(randomLook());
    renderWardrobe();
  });

  return {
    open,
    close: () => close(false),
    isOpen: (name) => openName === name,
    refreshWardrobe: () => openName === 'wardrobe' && renderWardrobe(),
  };
}
