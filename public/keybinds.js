// ปุ่มควบคุมที่ผู้เล่นเปลี่ยนเองได้ (คนถนัดซ้าย / คีย์บอร์ดไม่ใช่ QWERTY / ชอบแบบอื่น)
// เก็บเป็น KeyboardEvent.code (ตำแหน่งปุ่มจริง ไม่ขึ้นกับภาษาที่พิมพ์อยู่ → แป้นไทยก็ยังเดินได้)
// ลูกศรเดินได้เสมอ ไม่ต้องตั้ง · Esc ใช้ออกจากล็อกเมาส์/ปิดแผง จึงตั้งเป็นปุ่มอื่นไม่ได้
const STORE_KEY = 'duel-keys';
// v2: กลิ้งย้ายจาก C ไป Shift · เพิ่มล็อกเป้า (Tab) — ค่าที่เก็บไว้ก่อนหน้า (ไม่มี v) ต้องย้ายให้
const STORE_VERSION = 2;

// ลำดับ = ลำดับแถวในหน้าตั้งค่า · group = หัวข้อ
export const KEY_ACTIONS = [
  { id: 'up', label: 'เดินหน้า', group: 'เดิน', def: 'KeyW' },
  { id: 'left', label: 'เดินซ้าย', group: 'เดิน', def: 'KeyA' },
  { id: 'down', label: 'เดินถอย', group: 'เดิน', def: 'KeyS' },
  { id: 'right', label: 'เดินขวา', group: 'เดิน', def: 'KeyD' },
  { id: 'jump', label: 'กระโดด', group: 'เดิน', def: 'Space' },
  { id: 'attack', label: 'โจมตี / ต่อย', group: 'ต่อสู้', def: 'KeyF' },
  { id: 'block', label: 'บล็อก (กดค้าง)', group: 'ต่อสู้', def: 'KeyX' },
  { id: 'roll', label: 'กลิ้งหลบ', group: 'ต่อสู้', def: 'ShiftLeft' },
  { id: 'lockon', label: 'ล็อกเป้า (กดเปิด/ปิด)', group: 'ต่อสู้', def: 'Tab' },
  { id: 'heal', label: 'ดื่มยาเติมเลือด', group: 'ต่อสู้', def: 'KeyE' },
  { id: 'swap', label: 'สลับอาวุธ', group: 'ต่อสู้', def: 'KeyQ' },
  { id: 'slot1', label: 'อาวุธหลัก', group: 'ต่อสู้', def: 'Digit1' },
  { id: 'slot2', label: 'อาวุธรอง', group: 'ต่อสู้', def: 'Digit2' },
  { id: 'fullscreen', label: 'เต็มจอ + ล็อกเมาส์', group: 'ต่อสู้', def: 'Enter' },
];
const DEFAULTS = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.def]));
const FORBIDDEN = new Set(['Escape', 'MetaLeft', 'MetaRight', 'ContextMenu']);
// ปุ่มที่มีซ้าย-ขวา: ตั้ง Shift ซ้ายไว้ กด Shift ขวาก็ได้ผลเหมือนกัน (คนถนัดซ้ายกดฝั่งไหนก็ได้)
const PAIRS = { ShiftRight: 'ShiftLeft', ShiftLeft: 'ShiftRight', ControlRight: 'ControlLeft', ControlLeft: 'ControlRight', AltRight: 'AltLeft', AltLeft: 'AltRight' };
export const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return fresh();
    const keys = { ...DEFAULTS };
    for (const id of Object.keys(DEFAULTS)) {
      if (typeof raw.keys?.[id] === 'string' && !FORBIDDEN.has(raw.keys[id])) keys[id] = raw.keys[id];
    }
    // ค่าเก่าที่ยังใช้ C กลิ้งตามค่าเริ่มต้นเดิม → ย้ายไป Shift (คนที่ตั้ง C ให้ท่าอื่นเอง ไม่แตะ)
    if (raw.v !== STORE_VERSION && raw.keys?.roll === 'KeyC') keys.roll = DEFAULTS.roll;
    // ค่าที่เก็บไว้ชนกันเอง (แก้ localStorage มือ) → ใช้ค่าเริ่มต้นทั้งชุด ดีกว่าปุ่มเดียวทำสองอย่าง
    const unique = new Set(Object.values(keys)).size === Object.keys(keys).length;
    return { v: STORE_VERSION, keys: unique ? keys : { ...DEFAULTS }, mouseSwap: raw.mouseSwap === true };
  } catch {
    return fresh(); // localStorage ใช้ไม่ได้ (โหมดส่วนตัวบางตัว) → ค่าเริ่มต้น
  }
}
function fresh() {
  return { v: STORE_VERSION, keys: { ...DEFAULTS }, mouseSwap: false };
}

let state = load();
const listeners = new Set();
function commit(next) {
  state = next;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // เก็บไม่ได้ก็ใช้ได้ในรอบนี้ แค่รีเฟรชแล้วกลับเป็นค่าเดิม
  }
  for (const fn of listeners) fn();
}

export const keyOf = (action) => state.keys[action];
// ปุ่มนี้ทำอะไร (ลูกศร = เดินเสมอ) · ไม่ได้ผูก = null
export function actionOf(code) {
  if (ARROWS[code]) return ARROWS[code];
  const find = (c) => KEY_ACTIONS.find((a) => state.keys[a.id] === c)?.id ?? null;
  return find(code) ?? (PAIRS[code] ? find(PAIRS[code]) : null);
}
export const mouseSwapped = () => state.mouseSwap;
export const canBind = (code) => Boolean(code) && !FORBIDDEN.has(code) && !ARROWS[code];

// ตั้งปุ่มใหม่ · ปุ่มนั้นผูกกับท่าอื่นอยู่ → สลับกัน (ไม่มีท่าไหนหลุดไม่มีปุ่ม)
export function setKey(action, code) {
  if (!DEFAULTS[action] || !canBind(code)) return false;
  const keys = { ...state.keys };
  const other = KEY_ACTIONS.find((a) => keys[a.id] === code && a.id !== action);
  if (other) keys[other.id] = keys[action];
  keys[action] = code;
  commit({ ...state, keys });
  return other?.id ?? true;
}
export const setMouseSwap = (on) => commit({ ...state, mouseSwap: Boolean(on) });
export const resetKeys = () => commit(fresh());
export function onKeysChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ชื่อปุ่มสำหรับโชว์ (keycap) จาก code
const NAMED = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', ShiftLeft: 'Shift ซ้าย', ShiftRight: 'Shift ขวา',
  ControlLeft: 'Ctrl ซ้าย', ControlRight: 'Ctrl ขวา', AltLeft: 'Alt ซ้าย', AltRight: 'Alt ขวา', CapsLock: 'Caps',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};
export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}
export const labelOf = (action) => keyLabel(keyOf(action));
