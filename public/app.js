// หน้าเว็บหลัก: ต่อ socket → รับสถานะห้อง → ให้ sync.js คุมตัวเล่น → ให้ ui.js วาด
// ทุกปุ่ม (play/pause/skip/เพิ่มเพลง) ไม่ได้สั่งตัวเล่นตรงๆ แต่ส่ง action ไป server
// แล้วรอ server กระจายสถานะใหม่กลับมาให้ทุกเครื่อง (รวมเครื่องเราด้วย) → ทุกคนเห็นเหมือนกัน
import { createClock } from './clock.js';
import { createPlayer } from './player.js';
import { isRoomId, normalizeRoomId, suggestRoomName } from './room-name.js';
import { createSyncer, currentItem, expectedPosition } from './sync.js';
import { createQueueDrag } from './queue-drag.js';
import { createNotifier } from './notify.js';
import { randomLook } from './lounge-avatar.js';
import { createPanels, isDesktop } from './lounge-panels.js';
import { createHostLink } from './host-link.js';
import { createLyrics } from './lyrics.js';
import { createStageView } from './stage-view.js';
import { createMediaSession, registerServiceWorker } from './pwa.js';
import * as ui from './ui.js';
import { quadInside, quadMatrix } from './lounge-screen.js';

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
const notifier = createNotifier();
let lounge = null; // ห้อง 3D (null = เครื่องนี้เปิด WebGL ไม่ได้ → ใช้แบบไม่มีห้อง 3D)
let myLook = loadLook();
let lyrics = null;
let panels = null; // แผงวิธีเล่น / แต่งตัว / เมนูประลอง
let stageView = null;
let wakeLock = null;
let mediaSession = null;

function loadLook() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOOK_KEY));
    // server กรองค่าซ้ำอีกชั้น · ตัวที่บันทึกไว้ก่อนมีของบนหลัง/ลายชุด → สุ่มเติมส่วนที่ขาดแล้วจำไว้ (หน้าตาเดิมไม่เปลี่ยน)
    if (saved && typeof saved === 'object') return 'back' in saved && 'outfit' in saved ? saved : saveLook({ ...randomLook(), ...saved });
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
    lounge?.reset(res.avatars ?? [], res.you, res.items ?? [], res.duel ?? null);
    duelQueued = false;
    renderDuelButton(res.duelQueue ?? [], Boolean(res.duel));
    lastEventSeq = res.state.event?.seq ?? 0; // เหตุการณ์ก่อนเราเข้าห้อง ไม่ต้องเด้ง
    applyState(res.state, true);
    renderUsers(res.users);
    ui.renderChatHistory(res.chat ?? [], isMine);
    if (wantHost) requestHost({ silent: true }); // หลุดแล้วต่อใหม่ระหว่างเป็น host → ขอคืน (server รอไว้ 30 วิ)
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
  // host ของห้องไม่ใช่ socket ไหนของเราแล้ว (ถูกแย่ง/หมดเวลารอ) → เลิกทำตัวเป็น host
  // เช็คกับ mySocketIds เพราะตอนต่อใหม่ host ยังเป็น socket เก่าของเราอยู่ (กำลังขอคืน)
  if (isHosting && !mySocketIds.has(room.host?.socketId)) {
    wantHost = false;
    setHosting(false);
  }
  renderHost();
  renderQueue();
  ui.renderNowPlaying(room);
  renderStage();
  ui.renderMode(room.whenEmpty);
  lounge?.setScreen(currentItem(room)?.title ?? null, room.isPlaying);
  $('game-song').textContent = currentItem(room)?.title ?? 'ยังไม่มีเพลง';
  placeStageMv();
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
socket.on('items', (items) => lounge?.setItems(items));
socket.on('avatar:held', ({ id, kind }) => lounge?.setHeld(id, kind));

// ---------- ลานประลอง 1v1 ----------
// ปุ่ม ⚔️: กด = เข้าคิว (มีคนรออยู่ = เริ่มเลย) · กดอีกที = ยกเลิก · server ตอบ { queued }
let duelQueued = false;
let duelWaiting = [];
let duelBusy = false; // มีคนประลองอยู่ (กดได้ = ต่อคิวรอแมตช์ถัดไป)
function renderDuelButton(waiting = duelWaiting, busy = duelBusy) {
  duelWaiting = waiting;
  duelBusy = busy;
  const btn = document.querySelector('.lounge-actions [data-act="duel"]');
  if (!btn) return;
  const others = waiting.filter((name) => !(duelQueued && name === $('gate-name').value.trim())).length;
  const label = btn.querySelector('span');
  const fighting = Boolean(lounge?.duel.inArena());
  if (fighting) label.textContent = 'ออกจากลาน';
  else if (duelQueued) label.textContent = busy ? 'รอคิว… (ยกเลิก)' : 'รอคู่… (ยกเลิก)';
  else if (others > 0 && !busy) label.textContent = `รับคำท้า (${others})`;
  else label.textContent = busy ? 'ต่อคิวประลอง' : 'ประลอง';
  btn.classList.toggle('is-active', duelQueued || fighting);
  btn.classList.toggle('is-callout', !duelQueued && !fighting && others > 0 && !busy);
  // เมนู: หัวข้อหาคู่เปลี่ยนตามสถานะ · NPC/ลองอาวุธใช้ได้เฉพาะตอนลานว่าง
  const sub = $('duel-queue-sub');
  if (!sub) return;
  $('duel-queue-label').textContent = others > 0 && !busy ? `รับคำท้า (${others} คนรอ)` : busy ? 'ต่อคิวรอแมตช์ถัดไป' : 'หาคู่ (คนจริง)';
  sub.textContent = busy ? 'มีคนประลองอยู่ จะได้ลงสนามแมตช์ถัดไป' : others > 0 ? `${waiting.join(', ')} รออยู่ กดแล้วเข้าลานเลย` : 'รอเพื่อนในห้องกดประลองด้วย แล้วเข้าลาน 1v1';
  sub.closest('button').title = sub.textContent;
  for (const opt of document.querySelectorAll('#duel-panel [data-duel="npc"], #duel-panel [data-duel="dummy"]')) {
    opt.disabled = busy;
    opt.title = busy ? 'ลานไม่ว่าง รอคนที่ประลองอยู่จบก่อน' : opt.querySelector('small').textContent; // ปุ่มย่อ: คำอธิบายอยู่ใน tooltip
  }
}
// ปุ่มประลอง: ในลาน = ออก · รอคิวอยู่ = ยกเลิก · นอกนั้น = เปิดเมนู (หาคู่ / NPC / ลองอาวุธ)
function onDuelButton() {
  if (!joined) return;
  if (!isDesktop()) return ui.toast('ลานประลองเล่นได้บนคอมเท่านั้น (ต้องใช้คีย์บอร์ด)');
  if (lounge?.duel.inArena()) {
    socket.emit('duel:quit');
    return;
  }
  if (duelQueued) return joinDuelQueue();
  panels.open('duel');
}
function joinDuelQueue() {
  // ส่งอาวุธหลัก/รองที่เลือกในเมนูไปด้วย (server เช็คซ้ำ ผิดรูป = ใช้ชุดเริ่มต้น)
  socket.emit('duel:join', { loadout: panels.loadout() }, (res) => {
    if (res?.error) return ui.toast(res.error);
    duelQueued = Boolean(res?.queued);
    renderDuelButton();
    if (duelQueued) ui.toast(duelBusy ? 'ต่อคิวแล้ว จะได้ลงสนามแมตช์ถัดไป' : 'รอคู่ประลอง… ให้เพื่อนกดปุ่มประลองด้วย');
  });
}
function onDuelMenu(kind) {
  panels.close();
  if (kind === 'queue') return joinDuelQueue();
  socket.emit('duel:npc', { level: kind === 'dummy' ? 'dummy' : 'normal', loadout: panels.loadout() }, (res) => res?.error && ui.toast(res.error));
}
socket.on('duel:queue', (names) => {
  const before = duelWaiting.length;
  renderDuelButton(names);
  // มีคนเพิ่งท้า และเราไม่ได้อยู่ในคิว → เด้งบอก
  if (names.length > before && !duelQueued && !duelBusy) ui.toast(`⚔️ ${names[names.length - 1]} อยากประลอง! กดปุ่มประลองเพื่อรับคำท้า`);
});
socket.on('duel:start', (match) => {
  if (match.fighters.some((f) => f.id === socket.id)) {
    duelQueued = false;
    setGameOpen(true); // โดนจับคู่ตอนปิดเกมอยู่ → เปิดลานให้เลย
  }
  lounge?.duel.start(match);
  renderDuelButton(duelWaiting, true);
});
socket.on('duel:state', (match) => lounge?.duel.state(match));
socket.on('duel:pose', (pose) => lounge?.duel.pose(pose));
socket.on('duel:swing', (ev) => lounge?.duel.swing(ev));
socket.on('duel:shot', (ev) => lounge?.duel.shot(ev));
socket.on('duel:shotEnd', (ev) => lounge?.duel.shotEnd(ev));
socket.on('duel:hit', (ev) => lounge?.duel.hit(ev));
socket.on('duel:end', (ev) => lounge?.duel.end(ev));
socket.on('duel:act', (ev) => lounge?.duel.act(ev));
socket.on('duel:stamina', (values) => lounge?.duel.stamina(values));
socket.on('duel:dodge', (ev) => lounge?.duel.dodge(ev));
socket.on('duel:close', () => {
  lounge?.duel.close();
  renderDuelButton(duelWaiting, false);
});
// ถูกแย่ง host: ไม่ต้องเด้งข้อความเอง — event hostStart ของห้อง ("X แย่ง host จาก Y") เด้งให้อยู่แล้ว
socket.on('host:kicked', () => {
  wantHost = false;
  setHosting(false);
});

// ---------- ฟังตามผม (host) ----------
// เครื่อง host: extension อ่านเพลงจากแท็บ YouTube Music → ส่งเข้าหน้านี้ → หน้านี้ส่งต่อ server ด้วย socket ที่มีอยู่
// (ใช้ socket ของหน้าเว็บ ไม่ให้ extension ต่อ server เอง — server รู้ตัว host จาก socket.id ตรงๆ ไม่ต้องมีรหัสลับ)
const YTM_STALE_MS = 4000;
let isHosting = false; // server ยืนยันแล้วว่าเครื่องนี้เป็น host
let wantHost = false; // ผู้ใช้กดเป็น host ไว้ — ใช้ขอคืนเองตอนต่อใหม่
let lastYtmAt = 0;
let lastHostSong = null; // { videoId, position } ล่าสุดที่ไม่ใช่โฆษณา
const hostLink = createHostLink({ onYtm: onYtmState });
const isYtmLive = () => Date.now() - lastYtmAt < YTM_STALE_MS;

function onYtmState(s) {
  if (!isHosting || !joined || typeof s.videoId !== 'string') return;
  const wasLive = isYtmLive();
  lastYtmAt = Date.now();
  if (!wasLive) renderHost();
  let position = Number(s.position) || 0;
  let isPlaying = s.isPlaying === true;
  if (s.isAd) {
    // host ติดโฆษณา → ให้ห้องหยุดรอที่จุดเดิมของเพลง (ไม่งั้นเพื่อนจะเล่นนำไปก่อน)
    isPlaying = false;
    position = lastHostSong?.videoId === s.videoId ? lastHostSong.position : 0;
  } else {
    lastHostSong = { videoId: s.videoId, position };
  }
  // s.at = เวลาเครื่องเรา ตอนที่ extension อ่านค่า → แปลงเป็นเวลา server ด้วย offset ของ clock.js
  const sampledAt = clock.serverNow() - (Date.now() - (Number(s.at) || Date.now()));
  socket.emit('host:state', { videoId: s.videoId, title: s.title, channel: s.channel, position, isPlaying, sampledAt });
}

// host ได้ยินเพลงจาก YouTube Music อยู่แล้ว → ปิดเสียงตัวเล่นในเว็บ กันได้ยินสองชั้น
function setHosting(on) {
  if (isHosting === on) return;
  isHosting = on;
  if (on) player?.mute();
  else player?.unmute();
  renderHost();
}

function renderHost() {
  ui.renderHost(room?.host ?? null, { isMe: isHosting, ytmLive: isYtmLive() });
  lyrics?.refreshSeekable(); // มี host = ห้ามกดบรรทัดเนื้อเพลงเพื่อเลื่อนเพลง (เหมือนปุ่มคุมเพลงอื่น)
}

// ปก/เนื้อเพลง/แถบแจ้งเตือนของมือถือ ตามเพลงที่เล่นอยู่
function renderStage() {
  const item = currentItem(room);
  stageView?.setItem(item);
  lyrics?.setSong(item);
  mediaSession?.update(item, room.isPlaying);
}

// ---------- จอ (MV / ฟังอย่างเดียว / เนื้อเพลง) + เปิดค้างแบบแอป ----------
function initStage() {
  lyrics = createLyrics({
    getTime: () => player?.currentTime() ?? 0,
    getDuration: () => player?.duration() ?? 0,
    onSeek: (position) => send({ type: 'seek', position }),
    canSeek: () => joined && !room?.host,
  });
  stageView = createStageView({ onChange: (view) => lyrics.setVisible(view === 'lyrics') });
  mediaSession = createMediaSession({
    // ปุ่มบนหน้าจอล็อกส่งคำสั่งเข้าห้อง เหมือนกดปุ่มในเว็บ (ทุกคนในห้องเห็นตาม)
    onAction: ({ type }) => {
      if (room?.host) return;
      if (type === 'play' || type === 'pause') send({ type: room?.isPlaying ? 'pause' : 'play' });
      else send({ type });
    },
  });
  // ปุ่ม "จอไม่ดับ" ปิดไว้ก่อน (ดูคอมเมนต์ใน index.html) — wakeLock เป็น null แล้ว wakeLock?.resume() เลยไม่ทำอะไร
  // wakeLock = createWakeLock($('wake-toggle'), { onNotice: (text) => ui.toast(text) });
  registerServiceWorker();
}

async function requestHost({ force = false, silent = false } = {}) {
  let res;
  try {
    res = await socket.timeout(5000).emitWithAck('host:start', { force });
  } catch {
    res = { error: 'เชื่อมต่อ server ไม่ได้ ลองใหม่อีกที' };
  }
  if (res?.confirm && !silent) {
    const ok = await ui.askDialog({
      title: 'แย่งเป็น host?',
      body: `${res.host} กำลังเปิดเพลงให้ห้องฟังอยู่ ถ้าแย่ง ห้องจะเปลี่ยนมาเล่นตาม YouTube Music ของคุณทันที และ ${res.host} จะได้ข้อความแจ้ง`,
      ok: 'แย่งเลย',
      cancel: 'ไม่แย่ง',
    });
    return ok ? requestHost({ force: true }) : undefined;
  }
  if (!res?.ok) {
    wantHost = false;
    setHosting(false);
    if (res?.confirm) return ui.toast(`${res.host} เป็น host แทนแล้วระหว่างที่หลุด`);
    return ui.toast(res?.error ?? 'เป็น host ไม่สำเร็จ');
  }
  wantHost = true;
  setHosting(true);
  if (!silent && !(await hostLink.poll())) ui.toast('เปิด music.youtube.com แล้วเล่นเพลงได้เลย ห้องจะเล่นตาม');
}

async function showInstallGuide() {
  const download = await ui.askDialog({
    title: 'ต้องติดตั้ง extension ก่อน',
    body: [
      'กดปุ่มด้านล่างเพื่อดาวน์โหลด แล้วแตกไฟล์ zip ไว้ในโฟลเดอร์ที่จะไม่ลบทิ้ง',
      'เปิด chrome://extensions แล้วเปิด "Developer mode" ที่มุมขวาบน',
      'กด "Load unpacked" แล้วเลือกโฟลเดอร์ที่แตกไว้',
      'รีเฟรชหน้านี้ เปิด music.youtube.com แล้วกด "ฟังตามผม" อีกครั้ง',
    ],
    ok: 'ดาวน์โหลด extension',
    cancel: 'ไว้ก่อน',
  });
  if (download) location.href = '/extension.zip';
}

async function onHostClick() {
  if (!joined) return;
  if (isHosting) {
    wantHost = false;
    socket.emit('host:stop');
    setHosting(false);
    return;
  }
  if (!(await hostLink.detect())) return showInstallGuide();
  requestHost();
}

// ---------- แชท ----------
function onChat(msg) {
  const mine = isMine(msg);
  ui.appendChatMessage(msg, mine);
  lounge?.say(msg.bySocket, msg.text);
  if (!mine) notifier.chat(); // อยู่แท็บอื่น → ติ๊ง + ตัวเลขบนชื่อแท็บ
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
  const soundBtn = $('chat-sound');
  const renderSound = () => soundBtn.setAttribute('aria-pressed', String(notifier.isEnabled()));
  soundBtn.addEventListener('click', () => {
    notifier.setEnabled(!notifier.isEnabled());
    renderSound();
    ui.toast(notifier.isEnabled() ? 'เปิดเสียงเตือนแชทแล้ว (ดังตอนอยู่แท็บอื่น)' : 'ปิดเสียงเตือนแชทแล้ว');
  });
  renderSound();
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

// ---------- มินิเกม (ลาน 3D แบบเปิดทับจอ) ----------
// ไม่ย้าย/ซ่อนตัวเล่น YouTube → เพลงเล่นต่อตลอด · ปิดแล้วลานหยุดวาด (IntersectionObserver ใน lounge.js) ประหยัดแบต
function setGameOpen(open) {
  const game = $('game');
  if (game.hidden === !open) return;
  game.hidden = !open;
  document.body.classList.toggle('is-gaming', open);
  if (open) $('lounge').focus({ preventScroll: true });
  else $('game-open').focus();
  placeStageMv();
}

function bindGame() {
  $('game-open').addEventListener('click', () => setGameOpen(true));
  $('game-close').addEventListener('click', () => setGameOpen(false));
  $('game-play').addEventListener('click', () => $('btn-play').click());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('game').hidden) setGameOpen(false);
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
      onPick: (id) => joined && socket.emit('item:pick', id),
      onDrop: () => joined && socket.emit('item:drop'),
      onScreenQuad: onStageQuad,
      onDuelPose: (pose) => joined && socket.emit('duel:pose', pose),
      onDuelAttack: (aim) => joined && socket.emit('duel:attack', aim),
      onDuelSwap: (slot) => joined && socket.emit('duel:swap', slot),
      onDuelAct: (act) => joined && socket.emit('duel:act', act),
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
  document.querySelector('.lounge-actions [data-act="drop"]').addEventListener('click', () => lounge.dropHeld());
  document.querySelector('.lounge-actions [data-act="duel"]').addEventListener('click', onDuelButton);
  // ปุ่มเต็มจอ (คอม): ทั้งหน้าลานเล่นเต็มจอ · อยู่ในลานประลองด้วย = ล็อกเมาส์ให้เลย
  $('fullscreen-btn').addEventListener('click', () => lounge?.toggleFullscreen());
  document.addEventListener('fullscreenchange', () => $('fullscreen-btn').setAttribute('aria-pressed', String(Boolean(document.fullscreenElement))));
  for (const opt of document.querySelectorAll('#duel-panel [data-duel]')) opt.addEventListener('click', () => onDuelMenu(opt.dataset.duel));
  renderDuelButton();
  for (const btn of document.querySelectorAll('.lounge-zoom [data-zoom]')) {
    btn.addEventListener('click', () => lounge.zoomBy(btn.dataset.zoom === 'in' ? 1 / 1.15 : 1.15));
  }
  // ส่งชุดใหม่ให้ห้องแบบหน่วงนิดนึง (กด ◀ ▶ รัวๆ ในหน้าแต่งตัวไม่ต้องส่งทุกครั้ง)
  let lookTimer = null;
  const applyLook = (look) => {
    myLook = saveLook(look);
    lounge.setMyLook(myLook);
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => joined && socket.emit('look', myLook), 250);
  };
  panels = createPanels({ getLook: () => myLook, setLook: applyLook, randomLook });
  $('reroll').addEventListener('click', () => {
    applyLook(randomLook());
    panels.refreshWardrobe();
  });
  $('say-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendChat($('say-input'));
  });
  if (room) lounge.setScreen(currentItem(room)?.title ?? null, room.isPlaying);
}

// ---------- จอ MV บนเวที 3D ----------
// ยกตัวเล่น YouTube ตัวเดิมไปวางทับจอบนเวทีด้วย CSS (ไม่ย้ายใน DOM — ย้ายแล้ว iframe โหลดใหม่ เพลงสะดุด)
// ได้ภาพเดียวกับที่ห้องเล่นอยู่ ไม่กินเน็ตเพิ่ม · ข้อเสีย: ตัวละครที่เดินผ่านหน้าจอจะโดนวิดีโอบัง
const MV_W = 640;
const MV_H = 360;
let stageQuad = null; // มุมจอเวทีบนหน้าจอ (px ในกรอบลาน) ล่าสุดจาก lounge
let stageSize = null;
let stageTransform = null; // ค่าที่ตั้งไปล่าสุด (เหมือนเดิม = ไม่แตะ DOM)

// เรียกได้บ่อย: ตอนกล้องขยับ / สถานะห้องเปลี่ยน / ทุกครึ่งวิระหว่างเปิดเกม (ตัวเล่นโหลดเพลงเสร็จไม่มี event มาบอก)
function placeStageMv() {
  const screen = document.querySelector('.screen');
  const matrix =
    !$('game').hidden && loadedCurrentItem() && stageQuad && quadInside(stageQuad, stageSize.w, stageSize.h)
      ? quadMatrix(MV_W, MV_H, stageQuad)
      : null;
  let transform = '';
  if (matrix) {
    const rect = $('lounge').getBoundingClientRect();
    transform = `translate(${rect.left}px, ${rect.top}px) matrix3d(${matrix.join(',')})`;
  }
  if (transform === stageTransform) return;
  stageTransform = transform;
  screen.classList.toggle('is-on-stage', Boolean(matrix));
  screen.style.transform = transform;
  lounge?.setMv(Boolean(matrix));
}
setInterval(() => !$('game').hidden && placeStageMv(), 500);

function onStageQuad(quad, w, h) {
  stageQuad = quad;
  stageSize = { w, h };
  placeStageMv();
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
  if (isHosting) player.mute(); // กดเป็น host ก่อนตัวเล่นโหลดเสร็จ
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
  if (isHosting) {
    return isYtmLive() ? ui.renderSync('live', 'คุณเป็น host') : ui.renderSync('catching', 'รอ YouTube Music…');
  }
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
  // แท็บ YouTube Music เงียบไป (ปิดแท็บ) / กลับมาส่ง → เปลี่ยนข้อความบนป้าย host
  const live = isYtmLive();
  if (isHosting && live !== shownYtmLive) {
    shownYtmLive = live;
    renderHost();
  }
}
let shownYtmLive = false;

// ---------- ค้นเพลง ----------
const looksLikeLink = (text) => /youtu\.?be|youtube\.com|^[A-Za-z0-9_-]{11}$/.test(text);

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'เกิดข้อผิดพลาด');
  return body;
}

const songOf = (item) => ({ videoId: item.videoId, title: item.title, channel: item.channel });
// เพลงที่กำลังเล่น + รอเล่น (ตรงกับที่ server ใช้กันเพิ่มซ้ำใน room.js) — เช็คก่อนส่งเพื่อบอกคนกดว่าทำไมไม่เข้าคิว
function upcomingVideoIds() {
  if (!room || room.finished) return new Set();
  const from = Math.max(0, room.queue.findIndex((q) => q.id === room.currentId));
  return new Set(room.queue.slice(from).map((q) => q.videoId));
}

function addToQueue(item) {
  if (upcomingVideoIds().has(item.videoId)) return ui.toast('เพลงนี้อยู่ในคิวแล้ว');
  send({ type: 'add', item: songOf(item) });
}

// ส่งทั้งชุดเป็น action เดียว (server เพิ่มรวดเดียว คิวไม่กระพริบทีละเพลง) · server ตัดเพลงซ้ำเองด้วย
function addAllToQueue(items) {
  const upcoming = upcomingVideoIds();
  const dup = items.filter((item) => upcoming.has(item.videoId)).length;
  if (dup === items.length) return ui.toast('ทุกเพลงอยู่ในคิวแล้ว');
  if (dup > 0) ui.toast(`ข้าม ${dup} เพลงที่อยู่ในคิวแล้ว`);
  send({ type: 'addMany', items: items.map(songOf) });
}
const hasPlaylist = (text) => /[?&]list=[A-Za-z0-9_-]{10,}/.test(text);

// ลิงก์ที่มี list= → แสดงทั้ง playlist ให้กด "เพิ่มทั้งหมด" ได้
// ถ้าดึงไม่ได้ (Mix อัตโนมัติ / ส่วนตัว) แต่ลิงก์มีเพลงเดี่ยวอยู่ด้วย → ถอยไปเพิ่มเพลงเดี่ยวนั้นแทน
async function showPlaylist(q) {
  try {
    const { items } = await getJson(`/api/playlist?u=${encodeURIComponent(q)}`);
    ui.renderResults(items, `Playlist · ${items.length} เพลง`, addToQueue, { onAddAll: () => addAllToQueue(items) });
    return '';
  } catch (err) {
    if (!/[?&]v=/.test(q)) throw err;
    const { item } = await getJson(`/api/resolve?u=${encodeURIComponent(q)}`);
    ui.renderResults([item], 'จากลิงก์ (เพลงเดียว)', addToQueue);
    return `${err.message} — แสดงเฉพาะเพลงในลิงก์`;
  }
}

async function runSearch(text) {
  const q = text.trim();
  if (!q) return;
  ui.setHint('กำลังค้น…');
  try {
    if (hasPlaylist(q)) {
      return ui.setHint(await showPlaylist(q));
    } else if (looksLikeLink(q)) {
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

// ---------- ชาร์ต Top 50 ----------
// server cache ไว้ 3 ชม. อยู่แล้ว · ฝั่งเว็บจำไว้อีก 10 นาที กดสลับประเทศไปมาไม่ต้องรอโหลดซ้ำ
const CHART_REGIONS = [
  { id: 'TH', label: 'ไทย' },
  { id: 'US', label: 'สากล' },
  { id: 'KR', label: 'เกาหลี' },
];
const CHART_STORE_KEY = 'listen-together:chart-region';
const CHART_CLIENT_TTL_MS = 10 * 60 * 1000;
const chartCache = new Map();
let chartRegion = CHART_REGIONS.some((r) => r.id === localStorage.getItem(CHART_STORE_KEY)) ? localStorage.getItem(CHART_STORE_KEY) : 'TH';

const chartHandlers = { onAdd: addToQueue, onAddMany: addAllToQueue, onRegion: (id) => showChart(id) };

async function showChart(region = chartRegion) {
  chartRegion = region;
  localStorage.setItem(CHART_STORE_KEY, region);
  ui.setHint('');
  const base = { region, regions: CHART_REGIONS };
  const hit = chartCache.get(region);
  if (hit && Date.now() - hit.at < CHART_CLIENT_TTL_MS) return ui.renderChart({ ...base, items: hit.items }, chartHandlers);
  ui.renderChart({ ...base, loading: true }, chartHandlers);
  try {
    const { items } = await getJson(`/api/top?region=${region}`);
    chartCache.set(region, { at: Date.now(), items });
    // กดสลับประเทศเร็วๆ → วาดเฉพาะประเทศที่เลือกล่าสุด
    if (chartRegion === region) ui.renderChart({ ...base, items }, chartHandlers);
  } catch (err) {
    if (chartRegion === region) ui.renderChart({ ...base, error: err.message }, chartHandlers);
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
  wakeLock?.resume(); // ขอกันจอดับได้เฉพาะจังหวะที่ผู้ใช้เพิ่งกด
  notifier.unlock(); // จังหวะนี้มีการกดของผู้ใช้ → browser ยอมให้เสียงเตือนแชทดังได้
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
  $('chart-open').addEventListener('click', () => showChart());
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
  bindGame();
  initStage();
  $('host-toggle').addEventListener('click', onHostClick);
  initLounge();
  getJson('/api/config')
    .then((cfg) => {
      searchEnabled = cfg.searchEnabled;
      // ชาร์ตใช้ YouTube API เหมือนการค้น → ไม่มี key ก็ไม่โชว์ปุ่ม
      $('chart-open').hidden = !searchEnabled;
      if (!searchEnabled) ui.setHint('ยังไม่มี API key: วางลิงก์จาก YouTube Music แทนได้');
    })
    .catch(() => {});
  await initPlayer();
  setInterval(tick, TICK_MS);
}

main();
