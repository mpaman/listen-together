// แผงลอยบนลาน 3D: วิธีเล่น (ปุ่ม ?) · แต่งตัว · เมนูประลอง · ตั้งค่าปุ่ม
// เปิดได้ทีละแผง · Esc/ปุ่ม X ปิดแล้วคืน focus ให้ปุ่มที่กดเปิด · ไม่ปิดเมื่อคลิกฉาก (แต่งตัวอยู่ก็หมุนกล้องดูตัวเองได้)
import { cleanLoadout, SHIELD, STAMINA, WEAPONS, WEAPON_KINDS } from './arena-rules.js';
import { LOOK_PARTS } from './lounge-avatar.js';
import { CLASSES } from './lounge-model.js';
import { KEY_ACTIONS, canBind, keyLabel, keyOf, labelOf, mouseSwapped, onKeysChange, resetKeys, setKey, setMouseSwap } from './keybinds.js';

// คอม = มีเมาส์และ hover ได้ (แล็ปท็อปจอสัมผัสก็นับเป็นคอมเพราะ pointer หลักยังเป็นเมาส์/ทัชแพด)
export const desktopQuery = matchMedia('(hover: hover) and (pointer: fine)');
export const isDesktop = () => desktopQuery.matches;

// ส่วนที่เลือกได้ในหน้าแต่งตัว (ลำดับ = ลำดับแถว)
// ตัวละครเป็นโมเดล 3D แล้ว (Man 11-28 เลือก: เลือกคลาสจาก 5 แบบ) · สี/หมวก/หน้าของตัวกล่องเดิมไม่ได้โชว์แล้วจึงเอาออก
const PARTS = [
  { key: 'cls', label: 'ตัวละคร', names: CLASSES.map((c) => c.name) },
];

// ---------- วิธีเล่น ----------
// แถว = [ไอคอน, ปุ่มที่กด (keycap), คำอธิบาย] · ปุ่มที่ตั้งเองได้ดึงจาก keybinds.js ทุกครั้งที่เปิด
function desktopGuide() {
  const k = labelOf;
  const move = [k('up'), k('left'), k('down'), k('right')];
  const [hit, guard] = mouseSwapped() ? ['คลิกขวา', 'คลิกซ้ายค้าง'] : ['คลิกซ้าย', 'คลิกขวาค้าง'];
  return [
    ['ลานฟังเพลง', [
      ['i-mouse', ['คลิกพื้น'], 'เดินไปตรงนั้น · คลิกโซฟา = นั่ง'],
      ['i-locate', move, 'เดิน (ใช้ลูกศรก็ได้) · กด Shift ค้าง = วิ่ง'],
      ['i-jump', [k('jump')], 'กระโดด ปีนขึ้นที่สูงได้'],
      ['i-punch', [k('attack')], 'ต่อยคนข้างหน้า'],
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
      ['i-keyboard', [], 'ตั้งค่าปุ่ม: เปลี่ยนปุ่มเอง / สลับเมาส์ซ้าย-ขวา'],
    ]],
    ['ในลานประลอง', [
      ['i-expand', [k('fullscreen')], 'เต็มจอ + ล็อกเมาส์ (เมาส์หมุนกล้อง ไม่หลุดขอบจอ) · Esc ออก'],
      ['i-mouse', [hit, k('attack')], 'โจมตีด้วยอาวุธที่ถือ (คู่อยู่ใกล้ หันไปหาให้เอง) · ไม่ใช้สตามินา'],
      ['i-shield', [guard, k('block')], `ยกการ์ดบล็อก ลดดาเมจจากด้านหน้า (เดินช้าลง) · โล่ใหญ่บล็อกแล้วโดนแค่ ${SHIELD.chip} แต่ใช้สตามินา ${SHIELD.cost} ต่อครั้ง`],
      ['i-target', [k('lockon')], 'ล็อกเป้า: ตีท่าไหนก็พุ่งไปที่คู่เสมอ (กล้องหมุนเองได้ตามปกติ) · กดอีกทีปลด'],
      ['i-roll', [k('roll')], `กลิ้งหลบ ช่วงแรกโดนอะไรไม่เข้า (สตามินา ${STAMINA.roll})`],
      ['i-sword', [k('swap'), k('slot1'), k('slot2'), 'ล้อเมาส์'], 'สลับอาวุธหลัก/รอง (รอแป๊บก่อนตีได้)'],
      ['i-jump', [k('jump')], 'กระโดดหลบค้อนกับลูกธนู'],
      ['i-heart', [], 'เลือด 100 · หมดก่อนแพ้ · ครบ 90 วิ เลือดมากกว่าชนะ · สตามินาใช้แค่กลิ้ง ไม่ได้กลิ้งสักพักฟื้นเอง'],
    ]],
  ];
}

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
  const sections = (isDesktop() ? desktopGuide() : TOUCH_GUIDE).map(([title, rows]) => `
    <h4>${title}</h4>
    <ul class="guide-list">${rows.map(([ic, keys, text]) => `
      <li><span class="guide-icon">${icon(ic)}</span><span class="guide-keys">${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('')}</span><span class="guide-text">${esc(text)}</span></li>`).join('')}
    </ul>`);
  if (isDesktop()) {
    // อาวุธทุกชิ้น: จุดเด่น/จุดด้อย ดึงจากกติกาเดียวกับ server (แก้ตัวเลขที่ arena-rules.js ที่เดียว)
    sections.push(`<h4>อาวุธในลาน</h4><ul class="guide-weapons">${WEAPON_KINDS.map((k) => {
      const w = WEAPONS[k];
      return `<li><strong>${esc(w.name)}</strong> <span class="guide-dmg">${w.dmg} ดาเมจ</span><span class="is-pro">+ ${esc(w.pro)}</span><span class="is-con">− ${esc(w.con)}</span></li>`;
    }).join('')}</ul>`);
  }
  return sections.join('');
}

// ---------- เลือกอาวุธหลัก/รอง (ในเมนูประลอง) ----------
const LOADOUT_KEY = 'duel-loadout';
const NPC_WEAPON_KEY = 'duel-npc-weapon';

// เลือกอาวุธให้ NPC (ไว้ทดสอบ) · "สุ่ม" = ชุดตามระดับเหมือนเดิม · จำไว้ในเครื่อง
function createNpcWeaponPicker() {
  const select = document.getElementById('duel-npc-weapon');
  if (!select) return { get: () => null };
  select.replaceChildren(new Option('สุ่มตามปกติ', ''), ...WEAPON_KINDS.map((kind) => new Option(WEAPONS[kind].name, kind)));
  const saved = localStorage.getItem(NPC_WEAPON_KEY);
  select.value = WEAPON_KINDS.includes(saved) ? saved : '';
  select.addEventListener('change', () => {
    try {
      localStorage.setItem(NPC_WEAPON_KEY, select.value);
    } catch {
      // โหมดส่วนตัว/ที่เก็บเต็ม: ไม่จำก็ได้ ใช้ค่าที่เลือกตอนนี้ไปก่อน
    }
  });
  return { get: () => select.value || null };
}
const TYPE_NAMES = { melee: 'ประชิด', slam: 'ทุบเป็นวง', shot: 'ยิงไกล' };
const FASTEST_COOLDOWN = Math.min(...WEAPON_KINDS.map((k) => WEAPONS[k].cooldown));
const MAX_DMG = Math.max(...WEAPON_KINDS.map((k) => WEAPONS[k].dmg));
// ตัวเลขดิบอ่านยาก → แปลงเป็นแถบ 0–1 เทียบกับอาวุธอื่นในลาน
function weaponStats(w) {
  const reach = w.type === 'shot' ? 1 : Math.min(1, (w.range + (w.radius ?? 0)) / 3);
  return [
    ['ดาเมจ', w.dmg / MAX_DMG, String(w.dmg)],
    ['ความไว', FASTEST_COOLDOWN / w.cooldown, `${(1000 / w.cooldown).toFixed(1)}/วิ`],
    ['ระยะ', reach, w.type === 'shot' ? 'ไกล' : `${w.range} m`],
    w.wall ? ['บล็อก', 1, `โดน ${SHIELD.chip}`] : ['บล็อก', w.guard, `${Math.round(w.guard * 100)}%`],
  ];
}

function loadSavedLoadout() {
  try {
    return cleanLoadout(JSON.parse(localStorage.getItem(LOADOUT_KEY)));
  } catch {
    return cleanLoadout(null); // เก็บค่าไว้ไม่ได้ (โหมดส่วนตัว/ค่าเสีย) → ใช้ชุดเริ่มต้น
  }
}

function createLoadoutPicker() {
  const grid = document.getElementById('loadout-grid');
  const detail = document.getElementById('loadout-detail');
  const slots = [...document.querySelectorAll('#duel-panel .loadout-slot')];
  let loadout = loadSavedLoadout();
  let editing = 0; // ช่องที่กำลังเลือก 0 = หลัก · 1 = รอง

  function renderDetail(kind) {
    const w = WEAPONS[kind];
    const rows = weaponStats(w).map(([label, k, text]) => `
      <div class="wd-row"><dt>${label}</dt><dd><span class="wd-bar"><i style="transform:scaleX(${Math.max(0.06, k).toFixed(2)})"></i></span><span class="wd-val">${text}</span></dd></div>`).join('');
    const extra = (w.pierce ? ` · ทะลุบล็อก ${Math.round(w.pierce * 100)}%` : '')
      + (w.wall ? ` · บล็อก 1 ครั้งใช้สตามินา ${SHIELD.cost}` : '');
    detail.innerHTML = `
      <div class="wd-head"><strong>${esc(w.name)}</strong><span class="wd-type">${TYPE_NAMES[w.type]}</span></div>
      <p class="wd-hint">${esc(w.hint)}</p>
      <dl class="wd-stats">${rows}</dl>
      <p class="wd-meta">ง้าง ${(w.windup / 1000).toFixed(2)} วิ · เดิน ×${w.move}${extra}</p>
      <p class="is-pro">+ ${esc(w.pro)}</p><p class="is-con">− ${esc(w.con)}</p>`;
  }

  function render() {
    slots.forEach((btn, i) => {
      btn.querySelector('strong').textContent = WEAPONS[loadout[i]].name;
      btn.setAttribute('aria-pressed', String(i === editing));
    });
    grid.innerHTML = WEAPON_KINDS.map((kind) => {
      const w = WEAPONS[kind];
      const slot = loadout.indexOf(kind);
      const badge = slot >= 0 ? `<em class="wc-slot">${slot + 1}</em>` : '';
      return `<button type="button" class="weapon-card${slot >= 0 ? ' is-picked' : ''}" data-kind="${kind}" aria-pressed="${slot === editing}"
        aria-label="${esc(w.name)} ${TYPE_NAMES[w.type]} ดาเมจ ${w.dmg}${slot >= 0 ? ` (ช่อง ${slot + 1})` : ''}">
        ${badge}<span class="wc-type">${TYPE_NAMES[w.type]}</span><strong>${esc(w.name)}</strong><span class="wc-dmg">${w.dmg} ดาเมจ</span></button>`;
    }).join('');
    renderDetail(loadout[editing]);
  }

  function pick(kind) {
    const other = 1 - editing;
    // เลือกอันที่อยู่อีกช่อง = สลับสองช่อง (อาวุธหลัก/รองห้ามซ้ำกัน)
    loadout = loadout[other] === kind ? [loadout[1], loadout[0]] : loadout.map((k, i) => (i === editing ? kind : k));
    try {
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(loadout));
    } catch {
      // เก็บไม่ได้ก็เล่นต่อได้ แค่รอบหน้าต้องเลือกใหม่
    }
    if (editing === 0) editing = 1; // เลือกหลักเสร็จ → ไปช่องรองต่อเลย
    render();
    grid.querySelector(`[data-kind="${kind}"]`)?.focus({ preventScroll: true });
  }

  slots.forEach((btn, i) => btn.addEventListener('click', () => {
    editing = i;
    render();
  }));
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-kind]');
    if (card) pick(card.dataset.kind);
  });
  // ชี้เมาส์/โฟกัสการ์ด = ดูรายละเอียด · ออกจากกริด = กลับไปโชว์อาวุธในช่องที่เลือกอยู่
  const preview = (e) => {
    const card = e.target.closest('[data-kind]');
    if (card) renderDetail(card.dataset.kind);
  };
  grid.addEventListener('pointerover', preview);
  grid.addEventListener('focusin', preview);
  grid.addEventListener('pointerleave', () => renderDetail(loadout[editing]));
  grid.addEventListener('focusout', (e) => !grid.contains(e.relatedTarget) && renderDetail(loadout[editing]));

  return { render, get: () => [...loadout] };
}

// ---------- แผงทั้งหมด ----------
export function createPanels({ getLook, setLook, randomLook }) {
  const panels = {
    guide: { el: document.getElementById('guide-panel'), trigger: document.getElementById('guide-btn') },
    wardrobe: { el: document.getElementById('wardrobe-panel'), trigger: document.getElementById('wardrobe-btn') },
    duel: { el: document.getElementById('duel-panel'), trigger: document.querySelector('.lounge-actions [data-act="duel"]') },
    keys: { el: document.getElementById('keys-panel'), trigger: document.getElementById('keys-btn') },
  };
  let openName = null;
  const loadoutPicker = createLoadoutPicker();
  const npcWeaponPicker = createNpcWeaponPicker();

  function close(returnFocus = true) {
    if (!openName) return;
    if (openName === 'keys') capturing = null;
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
    if (name === 'duel') {
      loadoutPicker.render();
      // ป้ายช่องอาวุธบอกปุ่มที่ตั้งไว้จริง
      p.el.querySelectorAll('.loadout-slot small').forEach((el, i) => (el.textContent = `อาวุธ${i ? 'รอง' : 'หลัก'} · กด ${labelOf(i ? 'slot2' : 'slot1')}`));
    }
    if (name === 'keys') renderKeys();
    p.el.hidden = false;
    p.trigger?.setAttribute('aria-expanded', 'true');
    openName = name;
    p.el.querySelector('button:not(.panel-close):not(:disabled)')?.focus({ preventScroll: true });
  }

  for (const p of Object.values(panels)) p.el.querySelector('.panel-close').addEventListener('click', () => close());
  panels.guide.trigger.addEventListener('click', () => open('guide'));
  panels.wardrobe.trigger.addEventListener('click', () => open('wardrobe'));
  panels.keys.trigger.addEventListener('click', () => open('keys'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openName) close();
    // ? (Shift+/) เปิดวิธีเล่น ตอนไม่ได้พิมพ์อยู่
    if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) open('guide');
  });
  // สลับจอ/เสียบเมาส์ระหว่างเปิดอยู่ → คู่มือเปลี่ยนชุดตาม
  desktopQuery.addEventListener('change', () => {
    if (openName === 'guide') document.getElementById('guide-body').innerHTML = guideHtml();
    if ((openName === 'duel' || openName === 'keys') && !isDesktop()) close(false);
  });

  // ---------- ตั้งค่าปุ่ม ----------
  // กดปุ่มของท่าไหน = รอรับปุ่มถัดไปที่กด (Esc ยกเลิก) · ปุ่มนั้นมีท่าอื่นใช้อยู่ = สลับกันให้
  const keyRows = document.getElementById('keys-rows');
  const keyNote = document.getElementById('keys-note');
  const mouseBox = document.getElementById('keys-mouse');
  let capturing = null; // id ท่าที่รอรับปุ่มอยู่
  function renderKeys() {
    let group = '';
    keyRows.innerHTML = KEY_ACTIONS.map((a) => {
      const head = a.group !== group ? `<h4>${esc(a.group)}</h4>` : '';
      group = a.group;
      const wait = capturing === a.id;
      return `${head}<div class="keys-row"><span class="keys-label" id="kl-${a.id}">${esc(a.label)}</span>
        <button type="button" class="keys-cap${wait ? ' is-waiting' : ''}" data-action="${a.id}" aria-labelledby="kl-${a.id} kc-${a.id}" aria-pressed="${wait}"><span id="kc-${a.id}">${wait ? 'กดปุ่มที่ต้องการ…' : esc(keyLabel(keyOf(a.id)))}</span></button></div>`;
    }).join('');
    mouseBox.checked = mouseSwapped();
  }
  function stopCapture() {
    capturing = null;
    renderKeys();
  }
  keyRows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    capturing = capturing === btn.dataset.action ? null : btn.dataset.action;
    keyNote.textContent = capturing ? 'กดปุ่มบนคีย์บอร์ดที่จะใช้แทน · Esc = ยกเลิก' : '';
    renderKeys();
    keyRows.querySelector(`[data-action="${btn.dataset.action}"]`)?.focus();
  });
  // ดักก่อนทุกตัว (capture ที่ window) → ปุ่มที่กดตอนตั้งค่าไม่ไปทำให้ตัวละครเดิน/กระโดด และ Esc ไม่ปิดแผง
  window.addEventListener('keydown', (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    const action = capturing;
    if (e.code === 'Escape') {
      keyNote.textContent = 'ยกเลิกแล้ว ปุ่มเดิมยังใช้ได้';
    } else if (!canBind(e.code)) {
      keyNote.textContent = `ใช้ปุ่ม ${keyLabel(e.code)} ไม่ได้ (ลูกศรเดินได้อยู่แล้ว · Esc/Tab สงวนไว้) ลองปุ่มอื่น`;
      return;
    } else {
      const swapped = setKey(action, e.code);
      const label = KEY_ACTIONS.find((a) => a.id === action).label;
      const other = KEY_ACTIONS.find((a) => a.id === swapped);
      keyNote.textContent = other ? `${label} = ${keyLabel(e.code)} · ${other.label} ย้ายไปใช้ ${labelOf(other.id)} แทน` : `${label} = ${keyLabel(e.code)}`;
    }
    stopCapture();
    keyRows.querySelector(`[data-action="${action}"]`)?.focus();
  }, true);
  mouseBox.addEventListener('change', () => setMouseSwap(mouseBox.checked));
  document.getElementById('keys-reset').addEventListener('click', () => {
    resetKeys();
    capturing = null;
    keyNote.textContent = 'กลับเป็นปุ่มเริ่มต้นแล้ว';
    renderKeys();
  });
  onKeysChange(() => {
    if (openName === 'keys' && !capturing) renderKeys();
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
    loadout: () => loadoutPicker.get(),
    npcWeapon: () => npcWeaponPicker.get(),
  };
}
