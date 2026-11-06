// สถานะห้อง = "ความจริงหนึ่งเดียว" ที่ทุกเครื่องต้องตาม
// เป็น pure function: รับ state เดิม + action → คืน state ใหม่ (ไม่แก้ของเดิม) จึงเทสง่าย
//
// แนวคิดเรื่องเวลา: ไม่เก็บ "ตอนนี้เล่นถึงวินาทีไหน" ตรงๆ เพราะมันเปลี่ยนทุกมิลลิวินาที
// แต่เก็บ position ณ เวลาอ้างอิง refTime แล้วให้ทุกเครื่องคำนวณเอง:
//   ตำแหน่งตอนนี้ = position + (เวลาตอนนี้ - refTime)   (ถ้ากำลังเล่น)

export const MAX_QUEUE = 200;
const PREV_RESTART_THRESHOLD_SEC = 3;

// เมื่อคิวหมดให้ทำอะไร: หยุด / วนกลับเพลงแรก / ต่อเพลงแนวเดียวกัน (server ค้นมาเติมให้)
export const WHEN_EMPTY_MODES = Object.freeze(['stop', 'loop', 'similar']);

export function createRoomState(now) {
  return {
    queue: [],
    currentId: null,
    isPlaying: false,
    position: 0,
    refTime: now,
    finished: false,
    whenEmpty: 'similar',
    version: 0,
  };
}

export function positionAt(state, now) {
  if (!state.isPlaying) return state.position;
  return state.position + (now - state.refTime) / 1000;
}

// ตั้งเพลงที่เล่นใหม่ เริ่มจาก 0
function startItem(state, id, now, isPlaying = true) {
  return { ...state, currentId: id, isPlaying, position: 0, refTime: now, finished: false };
}

function indexOfCurrent(state) {
  return state.queue.findIndex((item) => item.id === state.currentId);
}

// หาเพลงถัดไปที่เล่นได้ (ข้ามเพลงที่ YouTube ไม่ให้ฝัง)
function findPlayable(queue, fromIndex, step) {
  for (let i = fromIndex; i >= 0 && i < queue.length; i += step) {
    if (!queue[i].blocked) return queue[i];
  }
  return null;
}

function goNext(state, now) {
  const next = findPlayable(state.queue, indexOfCurrent(state) + 1, 1);
  if (next) return startItem(state, next.id, now);
  // หมดคิว: โหมด loop วนกลับเพลงแรก / similar ที่เติมเพลงไม่ทัน (ค้นพลาด/โควต้าหมด) ก็วนแทนการเงียบ
  const first = state.whenEmpty === 'stop' ? null : findPlayable(state.queue, 0, 1);
  if (first) return startItem(state, first.id, now);
  // โหมด stop: หยุดค้างไว้ที่เพลงสุดท้าย และจำไว้ว่าจบแล้ว (เพลงที่เพิ่มต่อจะเล่นทันที)
  return { ...state, isPlaying: false, position: 0, refTime: now, finished: true };
}

// เพลงที่กำลังเล่นเป็นเพลงสุดท้ายที่เล่นได้แล้ว และห้องตั้งให้ต่อเพลงแนวเดียวกัน → ถึงเวลาเติม
export function needsAutofill(state) {
  if (state.whenEmpty !== 'similar' || state.currentId === null) return false;
  return findPlayable(state.queue, indexOfCurrent(state) + 1, 1) === null;
}

// ต่อท้ายคิวหลายเพลง (เติมอัตโนมัติ / เพิ่มทั้ง playlist) · คิวเต็มก็รับเท่าที่ใส่ได้
// ยังไม่มีเพลงเล่น หรือคิวจบไปแล้ว → เริ่มเล่นเพลงแรกที่เพิ่งเพิ่ม
function appendItems(state, items, now) {
  const room = MAX_QUEUE - state.queue.length;
  if (room <= 0 || items.length === 0) return state;
  const added = items.slice(0, room);
  const next = { ...state, queue: [...state.queue, ...added] };
  return state.currentId === null || state.finished ? startItem(next, added[0].id, now) : next;
}

function goPrev(state, now) {
  if (positionAt(state, now) > PREV_RESTART_THRESHOLD_SEC) {
    return { ...state, position: 0, refTime: now };
  }
  const prev = findPlayable(state.queue, indexOfCurrent(state) - 1, -1);
  return prev ? startItem(state, prev.id, now) : { ...state, position: 0, refTime: now };
}

function addItem(state, item, now) {
  if (state.queue.length >= MAX_QUEUE) return state;
  const queue = [...state.queue, item];
  // ยังไม่เคยเล่น หรือเล่นจบคิวไปแล้ว → เพลงที่เพิ่งเพิ่มเล่นต่อเลย
  if (state.currentId === null || state.finished) return startItem({ ...state, queue }, item.id, now);
  return { ...state, queue };
}

function removeItem(state, id, now) {
  const idx = state.queue.findIndex((item) => item.id === id);
  if (idx === -1) return state;
  const queue = state.queue.filter((item) => item.id !== id);
  if (id !== state.currentId) return { ...state, queue };
  // ลบเพลงที่กำลังเล่น → ไปเพลงที่อยู่ตำแหน่งเดิม (ตัวถัดไปเลื่อนขึ้นมา)
  const replacement = findPlayable(queue, idx, 1) ?? findPlayable(queue, idx - 1, -1);
  if (!replacement) return { ...state, queue, currentId: null, isPlaying: false, position: 0, refTime: now };
  return startItem({ ...state, queue }, replacement.id, now, state.isPlaying);
}

// รับเฉพาะเพลงที่กำลังเล่น (ตัวเล่นเพิ่ง error จริง) — กัน client ป้าย blocked ใส่เพลงไหนก็ได้
function markBlocked(state, id, now) {
  if (id !== state.currentId) return state;
  const queue = state.queue.map((item) => (item.id === id ? { ...item, blocked: true } : item));
  return goNext({ ...state, queue }, now);
}

// ย้ายเพลงไปลำดับ to (นับจาก 0 ในคิวหลังย้าย) — ไม่แตะเพลงที่กำลังเล่น/ตำแหน่งเพลง
function moveItem(state, id, to) {
  const from = state.queue.findIndex((item) => item.id === id);
  if (from === -1) return state;
  const target = Math.min(Math.max(0, to), state.queue.length - 1);
  if (target === from) return state;
  const rest = state.queue.filter((item) => item.id !== id);
  return { ...state, queue: [...rest.slice(0, target), state.queue[from], ...rest.slice(target)] };
}

function jumpTo(state, id, now) {
  const item = state.queue.find((q) => q.id === id);
  if (!item || item.blocked) return state;
  return startItem(state, id, now);
}

// คืน state ใหม่ ถ้า action ไม่มีผลจะคืน object เดิม (ใช้ === เช็คว่าต้อง broadcast ไหม)
function applyAction(state, action, now) {
  switch (action.type) {
    case 'add':
      return addItem(state, action.item, now);
    case 'play':
      if (state.currentId === null || state.isPlaying) return state;
      return { ...state, isPlaying: true, refTime: now, finished: false };
    case 'pause':
      if (!state.isPlaying) return state;
      return { ...state, isPlaying: false, position: positionAt(state, now), refTime: now };
    case 'seek':
      if (state.currentId === null) return state;
      return { ...state, position: Math.max(0, action.position), refTime: now };
    case 'next':
      return state.currentId === null ? state : goNext(state, now);
    case 'prev':
      return state.currentId === null ? state : goPrev(state, now);
    case 'jump':
      return jumpTo(state, action.id, now);
    case 'remove':
      return removeItem(state, action.id, now);
    case 'move':
      return moveItem(state, action.id, action.to);
    // 'ended'/'blocked' อาจถูกส่งมาจากหลายเครื่องพร้อมกัน → ทำเฉพาะเมื่อ id ตรงกับเพลงปัจจุบัน
    // เครื่องแรกที่ส่งมาจะเลื่อนเพลงไป เครื่องที่ส่งตามมาจะถูกเมิน (กันข้ามเพลงซ้ำ)
    case 'ended':
      return action.id === state.currentId ? goNext(state, now) : state;
    case 'blocked':
      return markBlocked(state, action.id, now);
    case 'mode':
      return state.whenEmpty === action.mode ? state : { ...state, whenEmpty: action.mode };
    // มาจาก server เท่านั้น (sanitizeAction ไม่ยอมให้ client ส่ง type นี้)
    case 'autofill':
    case 'addMany':
      return appendItems(state, action.items, now);
    default:
      return state;
  }
}

export function reduce(state, action, now) {
  const next = applyAction(state, action, now);
  return next === state ? state : { ...next, version: state.version + 1 };
}
