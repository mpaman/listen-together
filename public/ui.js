// วาด UI ทั้งหมด — รับข้อมูลเข้ามาแล้ววาด ไม่คุย socket เอง
// กฎ: ข้อความจากผู้ใช้/YouTube ใส่ด้วย textContent เสมอ (กันชื่อเพลงแปลกๆ แทรก HTML)
import { icon } from './icons.js';
import { currentItem, expectedPosition } from './sync.js';

const $ = (id) => document.getElementById(id);
const TOAST_MS = 3200;
const TOAST_EXIT_MS = 160;
const MAX_TOASTS = 3;
const AVATAR_LIMIT = 4;
const AVATAR_HUES = ['#f2a541', '#5fd4a6', '#f07a6a', '#9fb4ff', '#e3a6e8'];
const MODE_LABEL = { similar: 'ต่อเพลงแนวเดียวกัน', loop: 'วนคิว', stop: 'หยุด' };

export const formatTime = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(name, label, className) {
  const btn = el('button', className);
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.append(icon(name));
  return btn;
}

function songRow(item, sub) {
  const row = el('li', 'song');
  const img = el('img', 'thumb');
  img.src = item.thumb;
  img.alt = '';
  img.loading = 'lazy';
  img.width = 64;
  img.height = 36;
  const meta = el('div', 'song-meta');
  meta.append(el('span', 'song-title', item.title), el('span', 'song-sub', sub));
  row.append(img, meta);
  return { row, meta };
}

// ---------- ผลค้นหา (popover) ----------
export function renderResults(items, label, onAdd) {
  $('results-label').textContent = label;
  const list = $('results');
  list.replaceChildren();
  if (items.length === 0) list.append(el('li', 'empty', 'ไม่เจอเพลงที่ตรงกัน'));
  for (const item of items) {
    const { row } = songRow(item, item.channel || 'YouTube');
    const add = iconButton('plus', `เพิ่ม ${item.title} เข้าคิว`, 'icon-btn add');
    add.addEventListener('click', () => {
      onAdd(item);
      add.replaceChildren(icon('check'));
      add.classList.add('is-done');
      add.disabled = true;
    });
    row.append(add);
    list.append(row);
  }
  setPopover(true);
}

export function setPopover(open) {
  $('results-pop').hidden = !open;
}

// ---------- คิว ----------
// จำ id ที่เคยวาดแล้ว: เพลงที่เพิ่งเข้าคิวเท่านั้นที่ได้ animation เข้า (ไม่กระพริบทั้งรายการทุกครั้ง)
const seenIds = new Set();
let firstQueueRender = true;

function queueSub(item) {
  if (item.blocked) return 'เล่นในเว็บนี้ไม่ได้ — ข้ามแล้ว';
  const who = item.auto ? 'ต่อให้อัตโนมัติ' : `เพิ่มโดย ${item.addedBy}`;
  return item.channel ? `${item.channel} · ${who}` : who;
}

export function renderQueue(room, { onJump, onRemove }) {
  const list = $('queue');
  list.replaceChildren();
  if (room.queue.length === 0) {
    const empty = el('li', 'empty');
    empty.append(el('strong', '', 'คิวยังว่าง'), el('span', '', 'ค้นเพลงด้านบนแล้วกด +'));
    list.append(empty);
  }
  for (const item of room.queue) {
    const { row, meta } = songRow(item, queueSub(item));
    const isCurrent = item.id === room.currentId;
    row.classList.toggle('is-current', isCurrent);
    row.classList.toggle('is-playing', isCurrent && room.isPlaying);
    row.classList.toggle('is-blocked', Boolean(item.blocked));
    row.classList.toggle('is-auto', Boolean(item.auto));
    row.classList.toggle('is-new', !firstQueueRender && !seenIds.has(item.id));
    seenIds.add(item.id);
    if (item.auto) meta.querySelector('.song-sub').prepend(icon('spark', 'icon icon-inline'));
    if (!item.blocked && !isCurrent) {
      row.classList.add('is-clickable');
      meta.setAttribute('role', 'button');
      meta.tabIndex = 0;
      meta.setAttribute('aria-label', `เล่น ${item.title}`);
      meta.addEventListener('click', () => onJump(item.id));
      meta.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && onJump(item.id));
    }
    const remove = iconButton('x', `เอา ${item.title} ออกจากคิว`, 'icon-btn remove');
    remove.addEventListener('click', () => onRemove(item.id));
    row.append(remove);
    list.append(row);
  }
  firstQueueRender = false;
  const playable = room.queue.filter((q) => !q.blocked).length;
  $('queue-count').textContent = room.queue.length ? `${playable} เพลง` : '';
}

export function renderMode(mode) {
  for (const btn of document.querySelectorAll('.segmented [data-mode]')) {
    btn.setAttribute('aria-checked', String(btn.dataset.mode === mode));
  }
}

// ---------- กำลังเล่น ----------
export function renderNowPlaying(room) {
  const item = currentItem(room);
  $('now-eyebrow').textContent = !item ? 'ยังไม่มีเพลง' : room.isPlaying ? 'กำลังเล่น' : 'หยุดไว้';
  $('now-title').textContent = item ? item.title : 'ห้องยังเงียบอยู่';
  $('now-sub').textContent = item ? queueSub(item) : 'ค้นเพลงแล้วกด + เพื่อเริ่ม';
  $('screen-empty').hidden = Boolean(item);
  $('btn-play').setAttribute('aria-label', room.isPlaying ? 'หยุดชั่วคราว' : 'เล่น');
  document.body.classList.toggle('is-playing', room.isPlaying);
}

export function renderProgress(room, duration, now, isDragging) {
  const pos = currentItem(room) ? Math.min(expectedPosition(room, now), duration || Infinity) : 0;
  const pct = duration > 0 ? pos / duration : 0;
  $('t-now').textContent = formatTime(pos);
  $('t-total').textContent = formatTime(duration);
  const seek = $('seek');
  if (!isDragging) seek.value = String(Math.round(pct * 1000));
  seek.style.setProperty('--pct', `${(Number(seek.value) / 10).toFixed(1)}%`);
}

// ---------- คนในห้อง ----------
function hueFor(name) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

export function renderUsers(users) {
  const list = $('avatars');
  list.replaceChildren();
  for (const name of users.slice(0, AVATAR_LIMIT)) {
    const li = el('li', 'avatar', Array.from(name)[0]?.toUpperCase() ?? '?');
    li.style.setProperty('--hue', hueFor(name));
    li.title = name;
    list.append(li);
  }
  if (users.length > AVATAR_LIMIT) list.append(el('li', 'avatar avatar-more', `+${users.length - AVATAR_LIMIT}`));
  list.setAttribute('aria-label', `ฟังอยู่ ${users.length} คน: ${users.join(', ')}`);
}

// ---------- ป้ายซิงค์ ----------
export function renderSync(state, text) {
  $('sync').dataset.state = state;
  $('sync-text').textContent = text;
}

// ---------- ข้อความเด้ง ----------
function eventText(ev) {
  const by = ev.by;
  switch (ev.type) {
    case 'add': return `${by} เพิ่ม “${ev.title}”`;
    case 'play': return `${by} เล่นต่อ`;
    case 'pause': return `${by} หยุดเพลง`;
    case 'next': return `${by} ข้ามเพลง`;
    case 'prev': return `${by} ย้อนเพลง`;
    case 'seek': return `${by} เลื่อนเพลง`;
    case 'jump': return `${by} เลือกเพลงในคิว`;
    case 'remove': return `${by} เอาเพลงออกจากคิว`;
    case 'mode': return `${by} ตั้งเมื่อคิวหมด: ${MODE_LABEL[ev.mode] ?? ev.mode}`;
    case 'autofill': return `ต่อเพลงแนวเดียวกันให้ ${ev.count} เพลง`;
    case 'blocked': return 'ข้ามเพลงที่เล่นในเว็บนี้ไม่ได้';
    default: return null;
  }
}

export function toastEvent(ev) {
  const text = eventText(ev);
  if (text) toast(text, ev.type === 'autofill' ? 'spark' : null);
}

export function toast(text, iconName = null) {
  const list = $('toasts');
  const item = el('li', 'toast');
  if (iconName) item.append(icon(iconName));
  item.append(el('span', '', text));
  list.append(item);
  while (list.children.length > MAX_TOASTS) list.firstElementChild.remove();
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), TOAST_EXIT_MS);
  }, TOAST_MS);
}

// ---------- หน้าเข้าห้อง ----------
export function setGateLink(text, isError) {
  $('gate-link').textContent = text;
  $('gate-link').classList.toggle('is-error', isError);
}

export function renderLobby(rooms, onPick) {
  const list = $('lobby');
  list.replaceChildren();
  $('lobby-label').hidden = rooms.length === 0;
  for (const room of rooms) {
    const btn = el('button', 'lobby-room');
    btn.type = 'button';
    const meta = el('span', 'lobby-meta');
    meta.append(el('span', 'lobby-name', room.id), el('span', 'lobby-sub', room.nowPlaying ? `♪ ${room.nowPlaying}` : 'ยังไม่มีเพลง'));
    btn.append(meta, el('span', 'lobby-count', `${room.listeners} คน`));
    btn.addEventListener('click', () => onPick(room.id));
    const li = el('li');
    li.append(btn);
    list.append(li);
  }
}

export function setHint(text, isError = false) {
  $('search-hint').textContent = text;
  $('search-hint').classList.toggle('is-error', isError);
}
