// หน้าเว็บหลัก: ต่อ socket → รับสถานะห้อง → ให้ sync.js คุมตัวเล่น → ให้ ui.js วาด
// ทุกปุ่ม (play/pause/skip/เพิ่มเพลง) ไม่ได้สั่งตัวเล่นตรงๆ แต่ส่ง action ไป server
// แล้วรอ server กระจายสถานะใหม่กลับมาให้ทุกเครื่อง (รวมเครื่องเราด้วย) → ทุกคนเห็นเหมือนกัน
import { createClock } from './clock.js';
import { createPlayer } from './player.js';
import { isRoomId, normalizeRoomId, suggestRoomName } from './room-name.js';
import { createSyncer, currentItem, expectedPosition } from './sync.js';
import { createQueueDrag } from './queue-drag.js';
import { randomLook } from './lounge-avatar.js';
import * as ui from './ui.js';

const TICK_MS = 400;
const NAME_KEY = 'listen-together:name';
const LOOK_KEY = 'listen-together:look';
const IN_SYNC_SEC = 0.3;
const DRIFT_SMOOTHING = 0.3; // ค่าที่โชว์บนป้ายเฉลี่ยแบบนุ่ม จะได้ไม่กระพริบทุก tick
const $ = (id) => document.getElementById(id);

let roomId = roomFromUrl(); // null = เปิดเว็บเปล่าๆ → ให้ตั้งชื่อห้อง/เลือกห้องในหน้าเข้าห้อง
const socket = window.io({ autoConnect: true });
const clock = createClock(socket);

let room = null; // สถานะล่าสุดจาก server
let joined = false;
let player = null;
let syncer = null;
let isDragging = false;
// กันส่ง 'ended' ซ้ำ: ผูกกับ id + refTime เพราะเพลงเดิมถูกสั่งเล่นใหม่ได้ (กด play หลังคิวจบ / วนคิว)
let reportedEndKey = null;
let lastEventSeq = 0;
let smoothDrift = 0;
let searchEnabled = false;
let activeTab = 'queue';
let unread = 0;
// socket.id เปลี่ยนทุกครั้งที่ต่อใหม่ → จำไว้ทุกตัว ข้อความเก่าของเราจะยังเป็น "คุณ"
const mySocketIds = new Set();
const isMine = (msg) => mySocketIds.has(msg.bySocket);
const CHAT_TOAST_LEN = 60;
let lounge = null; // ห้อง 3D (null = เครื่องนี้เปิด WebGL ไม่ได้ → ใช้แบบไม่มีห้อง 3D)
let myLook = loadLook();

function loadLook() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_KEY));
    if (saved && typeof saved === 'object') return saved; // server กรองค่าซ้ำอีกชั้น
  } catch {
    // ไม่มี/อ่านไม่ได้ → สุ่มใหม่
  }
  return saveLook(randomLook());
}

function saveLook(look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
    // จำไม่ได้ก็แค่ได้ตัวใหม่ทุกครั้ง
  }
  return look;
}

// ---------- ห้อง ----------
function roomFromUrl() {
  const id = normalizeRoomId(new URLSearchParams(location.search).get('room'));
  return isRoomId(id) ? id : null;
}

// ใส่ชื่อห้องลง URL ให้คัดลอกลิงก์ไปชวนเพื่อนได้ตรงห้อง
function enterRoom(id) {
  roomId = id;
  const params = new URLSearchParams(location.search);
  params.set('room', id);
  history.replaceState(null, '', `${location.pathname}?${params}`);
  $('room-id').textContent = id;
}

const send = (action) => joined && socket.emit('action', action);

function join() {
  socket.emit('join', { room: roomId, name: $('gate-name').value, look: myLook }, (res) => {
    if (res?.error) return ui.toast(res.error);
    joined = true;
    lounge?.reset(res.avatars ?? [], res.you);
    lastEventSeq = res.state.event?.seq ?? 0; // เหตุการณ์ก่อนเราเข้าห้อง ไม่ต้องเด้ง
    applyState(res.state, true);
    renderUsers(res.users);
    ui.renderChatHistory(res.chat ?? [], isMine);
  });
}

function applyState(next, force = false) {
  if (!force && room && next.version <= room.version) return; // ข้อความเก่ามาช้า → ทิ้ง
  room = next;
  const ev = room.event;
  if (ev && ev.seq > lastEventSeq) {
    lastEventSeq = ev.seq;
    if (ev.bySocket !== socket.id) ui.toastEvent(ev); // ของที่เรากดเองไม่ต้องเด้งบอกตัวเอง
  }
  renderQueue();
  ui.renderNowPlaying(room);
  ui.renderMode(room.whenEmpty);
  lounge?.setScreen(currentItem(room)?.title ?? null, room.isPlaying);
  syncer?.reconcile(room, clock.serverNow());
}

// ระหว่างลากเรียงคิว ห้ามวาดคิวใหม่ (แถวที่ถืออยู่จะหลุดมือ) → จำไว้ แล้ววาดตอนปล่อย
let queueDrag = null;
let queueDirty = false;
function renderQueue() {
  if (queueDrag?.isDragging()) {
    queueDirty = true;
    return;
  }
  queueDirty = false;
  ui.renderQueue(room, { onJump: (id) => send({ type: 'jump', id }), onRemove: (id) => send({ type: 'remove', id }) });
  queueDrag?.restoreFocus();
}

socket.on('connect', () => {
  mySocketIds.add(socket.id);
  if (joined) join();
}); // หลุดแล้วต่อใหม่ → server ลืมเราแล้ว ต้อง join ซ้ำ
socket.on('state', (state) => applyState(state));
const renderUsers = (users) => ui.renderUsers(users, $('gate-name').value.trim());
socket.on('users', renderUsers);
socket.on('chat', onChat);
socket.on('avatar:join', (av) => lounge?.add(av));
socket.on('avatar:leave', ({ id }) => lounge?.remove(id));
socket.on('avatar:look', ({ id, look }) => lounge?.look(id, look));
socket.on('pose', (pose) => lounge?.pose(pose));
socket.on('gesture', ({ id, type }) => lounge?.remoteGesture(id, type));

// ---------- แชท ----------
function onChat(msg) {
  const mine = isMine(msg);
  ui.appendChatMessage(msg, mine);
  lounge?.say(msg.bySocket, msg.text);
  if (mine || (activeTab === 'chat' && !document.hidden)) return;
  unread += 1;
  ui.setUnread(unread);
  if (activeTab !== 'chat') {
    const text = msg.text.length > CHAT_TOAST_LEN ? `${msg.text.slice(0, CHAT_TOAST_LEN)}…` : msg.text;
    ui.toast(`${msg.name}: ${text}`, 'chat');
  }
}

function showTab(name) {
  activeTab = name;
  ui.setTab(name);
  if (name === 'chat') {
    unread = 0;
    ui.setUnread(0);
    ui.scrollChatToEnd();
  }
}

function bindChat() {
  for (const tab of document.querySelectorAll('.tabs [data-tab]')) {
    tab.addEventListener('click', () => {
      showTab(tab.dataset.tab);
      if (tab.dataset.tab === 'chat') $('chat-input').focus();
    });
  }
  // ลูกศรซ้าย/ขวาสลับแท็บ (แบบ tablist มาตรฐาน)
  $('tab-queue').parentElement.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = activeTab === 'queue' ? 'chat' : 'queue';
    showTab(next);
    $(`tab-${next}`).focus();
  });
  // กลับมาที่แท็บเบราว์เซอร์ขณะเปิดแชทอยู่ = อ่านแล้ว
  document.addEventListener('visibilitychange', () => !document.hidden && activeTab === 'chat' && showTab('chat'));
  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('chat-input'));
  });
}

// ช่องแชท กับ ช่อง "พูด" ใต้ห้อง 3D ส่งข้อความเดียวกัน (ขึ้นบนหัว + ในแชท)
function sendChat(input) {
  const text = input.value.trim();
  if (!text || !joined) return;
  input.value = '';
  socket.emit('chat', text, (res) => {
    if (!res?.error) return;
    if (!input.value) input.value = text; // ส่งไม่ผ่าน → คืนข้อความให้ ไม่ต้องพิมพ์ใหม่
    ui.toast(res.error);
  });
}

// ---------- ห้อง 3D ----------
// โหลดแยก (dynamic import) — ถ้า WebGL/Three.js พัง เว็บฟังเพลงยังใช้ได้ปกติ
async function initLounge() {
  try {
    const { createLounge } = await import('./lounge.js');
    lounge = createLounge($('lounge'), {
      onPose: (pose) => joined && socket.emit('pose', pose),
      onGesture: (type) => joined && socket.emit('gesture', type),
      onNotice: (text) => ui.toast(text),
    });
    if (new URLSearchParams(location.search).has('debug')) window.__lounge = lounge;
  } catch (err) {
    console.error('[lounge]', err);
    $('lounge-section').hidden = true;
    return;
  }
  for (const btn of document.querySelectorAll('.lounge-actions [data-gesture]')) {
    btn.addEventListener('click', () => lounge.gesture(btn.dataset.gesture));
  }
  document.querySelector('.lounge-actions [data-act="sit"]').addEventListener('click', () => lounge.toggleSit());
  $('reroll').addEventListener('click', () => {
    myLook = saveLook(randomLook());
    lounge.setMyLook(myLook);
    if (joined) socket.emit('look', myLook);
  });
  $('say-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('say-input'));
  });
  if (room) lounge.setScreen(currentItem(room)?.title ?? null, room.isPlaying);
}

// ---------- ตัวเล่น ----------
// คืนเพลงปัจจุบัน เฉพาะเมื่อตัวเล่นเครื่องนี้โหลดเพลงนั้นอยู่จริง
// (กัน event ของเพลงเก่าที่มาช้า ไปทำให้เพลงใหม่ถูกข้าม)
function loadedCurrentItem() {
  const item = room && currentItem(room);
  return item && syncer?.loadedItemId() === item.id ? item : null;
}

function reportEnd() {
  const item = loadedCurrentItem();
  const key = item && `${item.id}:${room.refTime}`;
  if (!item || !room.isPlaying || reportedEndKey === key) return;
  reportedEndKey = key;
  send({ type: 'ended', id: item.id });
}

function reportBlocked() {
  const item = loadedCurrentItem();
  if (item) send({ type: 'blocked', id: item.id });
}

async function initPlayer() {
  player = await createPlayer('player', { onEnded: reportEnd, onBlocked: reportBlocked });
  syncer = createSyncer(player);
  // เปิด ?debug=1 แล้วพิมพ์ __lt.drift() ใน console เพื่อดูว่าเครื่องนี้คลาดจากห้องกี่วินาที
  if (new URLSearchParams(location.search).has('debug')) {
    window.__lt = {
      drift: () => (room ? player.currentTime() - expectedPosition(room, clock.serverNow()) : null),
      playerState: () => player.state(),
    };
  }
}

function updateSyncBadge(now) {
  if (!socket.connected) return ui.renderSync('off', 'หลุดการเชื่อมต่อ…');
  if (!currentItem(room)) return ui.renderSync('idle', 'รอเพลงแรก');
  if (!room.isPlaying) return ui.renderSync('idle', 'พักเพลงอยู่');
  const drift = player.currentTime() - expectedPosition(room, now);
  smoothDrift += (drift - smoothDrift) * DRIFT_SMOOTHING;
  const inSync = player.state() === player.states.PLAYING && Math.abs(smoothDrift) <= IN_SYNC_SEC;
  if (inSync) return ui.renderSync('live', `ตรงกับห้อง ±${Math.abs(smoothDrift).toFixed(2)} วิ`);
  return ui.renderSync('catching', 'กำลังตามห้อง…');
}

function tick() {
  if (!room || !player || !joined) return;
  const now = clock.serverNow();
  syncer.reconcile(room, now);
  // กันกรณีพลาด event ENDED (เช่นแท็บอยู่เบื้องหลัง) → ดูจากเวลาที่ควรจะเล่นถึงแทน
  const duration = player.duration();
  if (room.isPlaying && duration > 0 && expectedPosition(room, now) > duration + 1) reportEnd();
  ui.renderProgress(room, duration, now, isDragging);
  updateSyncBadge(now);
}

// ---------- ค้นเพลง ----------
const looksLikeLink = (text) => /youtu\.?be|youtube\.com|^[A-Za-z0-9_-]{11}$/.test(text);

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'เกิดข้อผิดพลาด');
  return body;
}

const addToQueue = (item) => send({ type: 'add', item: { videoId: item.videoId, title: item.title, channel: item.channel } });

async function runSearch(text) {
  const q = text.trim();
  if (!q) return;
  ui.setHint('กำลังค้น…');
  try {
    if (looksLikeLink(q)) {
      const { item } = await getJson(`/api/resolve?u=${encodeURIComponent(q)}`);
      ui.renderResults([item], 'จากลิงก์', addToQueue);
    } else if (searchEnabled) {
      const { results } = await getJson(`/api/search?q=${encodeURIComponent(q)}`);
      ui.renderResults(results, `ผลการค้นหา “${q}”`, addToQueue);
    } else {
      throw new Error('ระบบค้นหายังไม่เปิด — คัดลอกลิงก์เพลงจาก YouTube Music มาวางแทน');
    }
    ui.setHint('');
  } catch (err) {
    ui.setPopover(false);
    ui.setHint(err.message, true);
  }
}

// ---------- ผูกปุ่ม ----------
// หน้าหลัก (เปิดเว็บเปล่าๆ): รายการห้องที่เปิดอยู่ กดแล้วเข้าเลย + ช่องสร้างห้องใหม่
function setupRoomPicker() {
  const input = $('gate-room-input');
  $('gate-room-field').hidden = false;
  $('gate').classList.add('is-home');
  $('gate-submit').textContent = 'สร้างห้อง';
  input.value = suggestRoomName();
  const preview = () => {
    const ok = isRoomId(normalizeRoomId(input.value));
    ui.setGateLink(ok ? '' : 'ชื่อห้องต้องมีตัวอักษรหรือตัวเลขอย่างน้อย 2 ตัว', !ok);
  };
  input.addEventListener('input', preview);
  preview();
  getJson('/api/rooms')
    .then(({ rooms }) =>
      ui.renderLobby(rooms, (id) => {
        if (!$('gate-name').value.trim()) {
          input.value = id;
          return $('gate-name').focus();
        }
        enterGate(id);
      }),
    )
    .catch(() => ui.renderLobby([], () => {}));
}

// ผ่านหน้าเข้าห้อง: จำชื่อ → ปลดเสียง (ต้องมาจากการกดของผู้ใช้) → join
function enterGate(pickedId = null) {
  if (!$('gate-name').value.trim()) return $('gate-name').focus();
  if (!roomId) {
    const id = normalizeRoomId(pickedId ?? $('gate-room-input').value);
    if (!isRoomId(id)) return $('gate-room-input').focus();
    enterRoom(id);
  }
  try {
    localStorage.setItem(NAME_KEY, $('gate-name').value);
  } catch {
    // ไม่เป็นไร
  }
  player?.unmute();
  $('gate').classList.add('is-leaving');
  setTimeout(() => ($('gate').hidden = true), 200);
  join();
}

function bindGate() {
  if (roomId) {
    $('gate-title').textContent = `เข้าห้อง ${roomId}`;
    enterRoom(roomId); // เขียน URL เป็นชื่อมาตรฐาน ("ห้อง แก๊งค์" → "ห้อง-แก๊งค์") ลิงก์ที่คัดลอกจะได้สะอาด
  } else {
    setupRoomPicker();
  }
  try {
    $('gate-name').value = localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    // บางโหมด (เช่น private) อ่าน localStorage ไม่ได้ → แค่จำชื่อไม่ได้
  }
  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    enterGate();
  });
}

function bindTransport() {
  $('btn-play').addEventListener('click', () => send({ type: room?.isPlaying ? 'pause' : 'play' }));
  $('btn-next').addEventListener('click', () => send({ type: 'next' }));
  $('btn-prev').addEventListener('click', () => send({ type: 'prev' }));
  const seek = $('seek');
  seek.addEventListener('input', () => {
    isDragging = true;
    seek.style.setProperty('--pct', `${Number(seek.value) / 10}%`);
  });
  seek.addEventListener('change', () => {
    isDragging = false;
    const duration = player?.duration() ?? 0;
    if (duration > 0) send({ type: 'seek', position: (Number(seek.value) / 1000) * duration });
  });
  for (const btn of document.querySelectorAll('.segmented [data-mode]')) {
    btn.addEventListener('click', () => send({ type: 'mode', mode: btn.dataset.mode }));
  }
}

function bindSearch() {
  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch($('search-input').value);
  });
  $('results-close').addEventListener('click', () => ui.setPopover(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && ui.setPopover(false));
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.search-wrap')) ui.setPopover(false);
  });
}

function bindPeople() {
  const btn = $('people-btn');
  btn.addEventListener('click', () => ui.setPeoplePopover(btn.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && ui.setPeoplePopover(false));
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.people')) ui.setPeoplePopover(false);
  });
}

function bindRoomLink() {
  $('copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href.replace(/[?&]debug=1/, ''));
      $('copy-hint').textContent = 'คัดลอกแล้ว';
      setTimeout(() => ($('copy-hint').textContent = 'ชวนเพื่อน'), 1800);
    } catch {
      prompt('คัดลอกลิงก์นี้ส่งให้เพื่อน', location.href);
    }
  });
}

async function main() {
  bindGate();
  bindTransport();
  bindSearch();
  bindPeople();
  bindChat();
  queueDrag = createQueueDrag($('queue'), {
    onMove: (id, to) => send({ type: 'move', id, to }),
    onEnd: () => queueDirty && room && renderQueue(),
  });
  bindRoomLink();
  initLounge();
  getJson('/api/config')
    .then((cfg) => {
      searchEnabled = cfg.searchEnabled;
      if (!searchEnabled) ui.setHint('ยังไม่มี API key: วางลิงก์จาก YouTube Music แทนได้');
    })
    .catch(() => {});
  await initPlayer();
  setInterval(tick, TICK_MS);
}

main();
