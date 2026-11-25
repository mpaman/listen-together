// หน้าเนื้อเพลงแบบ Spotify: บรรทัดที่ร้องอยู่สว่าง จอเลื่อนตามเอง กดบรรทัดไหนห้องกระโดดไปตรงนั้น
// เวลาอ่านจากตัวเล่นของเครื่องนี้ (ไม่ใช่เวลาห้อง) เพราะคือเสียงที่หูได้ยินจริง
// วาดด้วย requestAnimationFrame เฉพาะตอนเปิดหน้านี้ — ปิดอยู่ไม่กินแบต
import { activeIndex, clampOffset, formatOffset, isMostlyThai, OFFSET_STEP, withOffset } from './lyrics-core.js';

const OFFSET_KEY = 'listen-together:lyrics-offset';
const USER_SCROLL_PAUSE_MS = 5000; // ผู้ใช้เลื่อนเอง → หยุดเลื่อนตามชั่วคราว (ไม่แย่งจอขณะกำลังอ่าน)
const WAIT_DURATION_MS = 3000; // รอตัวเล่นรู้ความยาวเพลงก่อนค้น (ใช้เลือกเวอร์ชันที่ตรง) แต่ไม่รอนานเกิน
const FOLLOW_AT = 0.38; // บรรทัดที่ร้องอยู่ค้างไว้ราวบนกลางจอ เห็นบรรทัดถัดไปหลายบรรทัด
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadOffsets() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFSET_KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

function saveOffsets(offsets) {
  try {
    localStorage.setItem(OFFSET_KEY, JSON.stringify(offsets));
  } catch {
    // จำไม่ได้ก็แค่ต้องปรับใหม่ทุกครั้ง
  }
}

// เปิดคำแปลไว้เป็นค่าเริ่มต้น · กดปิดแล้วจำไว้ในเครื่องนี้
const TH_KEY = 'listen-together:lyrics-th';
function loadShowTh() {
  try {
    return localStorage.getItem(TH_KEY) !== '0';
  } catch {
    return true;
  }
}
function saveShowTh(on) {
  try {
    localStorage.setItem(TH_KEY, on ? '1' : '0');
  } catch {
    // จำไม่ได้ก็แค่กลับเป็นค่าเริ่มต้น (เปิด)
  }
}

function noteIcon() {
  const wrap = document.createElement('span');
  wrap.className = 'lyric-gap';
  wrap.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-note"/></svg><span class="sr-only">ช่วงดนตรี</span>';
  return wrap;
}

export function createLyrics({ getTime, getDuration, onSeek, canSeek }) {
  const scroller = $('lyrics-scroll');
  const list = $('lyrics-lines');
  const status = $('lyrics-status');
  const followBtn = $('lyrics-follow');
  const offsetLabel = $('lyrics-offset');
  const thBtn = $('lyrics-th');
  const cache = new Map(); // videoId → ผลจาก server (null = ไม่มีเนื้อ)
  const thCache = new Map(); // videoId → คำแปลรายบรรทัด (null = แปลไม่ได้/ไม่ต้องแปล)
  let showTh = loadShowTh();
  let shownTexts = null; // ข้อความต้นฉบับรายบรรทัดที่วาดอยู่ (ไว้รู้ว่าเพลงนี้แปลได้ไหม)
  let thFor = null; // videoId ที่กำลังขอคำแปลอยู่ (กันยิงซ้ำ)

  let item = null;
  let songAt = 0;
  let lines = null; // [{t, text}] ของแบบซิงค์ · null = ไม่มี/ยังไม่โหลด
  let nodes = [];
  let shown = -2;
  let visible = false;
  let frame = 0;
  let fetching = false;
  let token = 0;
  let userScrollAt = -Infinity;
  let offsets = loadOffsets();

  const offset = () => (item ? offsets[item.videoId] ?? 0 : 0);
  const isFollowing = () => Date.now() - userScrollAt > USER_SCROLL_PAUSE_MS;

  function setStatus(text) {
    status.textContent = text;
    status.hidden = !text;
  }

  function renderOffset() {
    offsetLabel.textContent = formatOffset(offset());
    $('lyrics-offset-group').hidden = !lines;
  }

  function clear(text) {
    lines = null;
    nodes = [];
    shown = -2;
    list.replaceChildren();
    list.classList.remove('is-plain');
    followBtn.hidden = true;
    shownTexts = null;
    thBtn.hidden = true;
    setStatus(text);
    renderOffset();
  }

  function renderSynced(synced) {
    lines = synced;
    nodes = synced.map((line, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lyric-line';
      btn.dataset.i = String(i);
      if (line.text) btn.textContent = line.text;
      else btn.append(noteIcon());
      li.append(btn);
      return li;
    });
    list.replaceChildren(...nodes);
    shown = -2;
    setStatus('');
    renderOffset();
    syncSeekable();
  }

  // เนื้อแบบไม่มีเวลา: โชว์ได้ แต่ไฮไลต์/เลื่อนตามไม่ได้ — บอกให้รู้ จะได้ไม่คิดว่าพัง
  function renderPlain(text) {
    lines = null;
    nodes = [];
    list.classList.add('is-plain');
    list.replaceChildren(
      ...text.split(/\r?\n/).map((row) => {
        const li = document.createElement('li');
        li.className = 'lyric-plain';
        li.textContent = row || ' ';
        return li;
      }),
    );
    setStatus('เนื้อเพลงนี้ไม่มีเวลากำกับ เลยเลื่อนตามเพลงไม่ได้');
    renderOffset();
  }

  // ---------- คำแปลไทย ----------
  // ช่องใส่คำแปลของแต่ละบรรทัด: แบบซิงค์ = ในปุ่มบรรทัด · แบบธรรมดา = ใน <li>
  const thHosts = () => (nodes.length ? nodes.map((li) => li.firstChild) : [...list.children]);

  function clearTranslation() {
    for (const span of list.querySelectorAll('.lyric-th')) span.remove();
  }

  function paintTranslation(lines) {
    clearTranslation();
    if (!showTh || !lines) return;
    thHosts().forEach((host, i) => {
      // คำแปลเหมือนต้นฉบับ (ชื่อเฉพาะ/คำอุทาน) → ไม่ต้องซ้ำ
      if (!lines[i] || lines[i] === shownTexts?.[i]?.trim()) return;
      const span = document.createElement('span');
      span.className = 'lyric-th';
      span.lang = 'th';
      span.textContent = lines[i];
      host.append(span);
    });
    shown = -2; // ความสูงบรรทัดเปลี่ยน → เลื่อนจอให้บรรทัดที่ร้องอยู่ตรงตำแหน่งเดิม
  }

  async function loadTranslation(target) {
    if (thFor === target.videoId) return;
    thFor = target.videoId;
    const params = new URLSearchParams({
      v: target.videoId,
      title: target.title,
      channel: target.channel ?? '',
      d: String(Math.round(getDuration() || 0)),
    });
    let lines = null;
    let failed = false;
    try {
      const res = await fetch(`/api/lyrics/th?${params}`);
      if (res.ok) lines = (await res.json()).lines ?? null;
      else failed = true;
    } catch {
      failed = true;
    }
    if (thFor === target.videoId) thFor = null;
    if (item?.videoId !== target.videoId) return; // เปลี่ยนเพลงไปแล้ว
    if (!failed) thCache.set(target.videoId, lines); // พังชั่วคราว → ไม่จำ กดปุ่มใหม่ลองอีกได้
    if (!lines) thBtn.hidden = true; // แปลไม่ได้/ไม่ต้องแปล → ซ่อนปุ่มไปเลย ไม่ให้กดแล้วเงียบ
    paintTranslation(lines);
  }

  // เรียกหลังวาดเนื้อเพลงใหม่ทุกครั้ง · โชว์ปุ่มเฉพาะเพลงต่างประเทศ · เปิดอยู่ค่อยขอคำแปล
  function syncTranslation() {
    const foreign = Boolean(item && shownTexts?.length && !isMostlyThai(shownTexts));
    thBtn.hidden = !foreign || thCache.get(item?.videoId) === null;
    thBtn.setAttribute('aria-pressed', String(showTh));
    if (!foreign || !showTh) return clearTranslation();
    if (thCache.has(item.videoId)) return paintTranslation(thCache.get(item.videoId));
    loadTranslation(item);
  }

  function show(result) {
    list.classList.remove('is-plain');
    if (result?.synced?.length) renderSynced(result.synced);
    else if (result?.plain) renderPlain(result.plain);
    else clear('ไม่พบเนื้อเพลงนี้');
    shownTexts = result?.synced?.length ? result.synced.map((l) => l.text) : result?.plain ? result.plain.split(/\r?\n/) : null;
    scroller.scrollTop = 0;
    syncTranslation();
  }

  async function load() {
    const target = item;
    const my = ++token;
    fetching = true;
    clear('กำลังหาเนื้อเพลง…');
    const params = new URLSearchParams({
      v: target.videoId,
      title: target.title,
      channel: target.channel ?? '',
      d: String(Math.round(getDuration() || 0)),
    });
    let result = null;
    let failed = false;
    try {
      const res = await fetch(`/api/lyrics?${params}`);
      if (res.ok) result = await res.json();
      else failed = res.status !== 404;
    } catch {
      failed = true;
    }
    if (my !== token) return; // เปลี่ยนเพลงไปแล้วระหว่างรอ → ทิ้งผลเก่า
    fetching = false;
    if (failed) return clear('ดึงเนื้อเพลงไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกที');
    cache.set(target.videoId, result);
    show(result);
  }

  function scrollToLine(i) {
    const node = nodes[i];
    if (!node) return;
    const top = node.offsetTop - scroller.clientHeight * FOLLOW_AT + node.offsetHeight / 2;
    scroller.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function paint(i) {
    if (i === shown) return;
    const from = Math.max(0, Math.min(i, shown));
    const to = Math.max(i, shown);
    for (let k = from; k <= to && k < nodes.length; k += 1) {
      nodes[k].classList.toggle('is-past', k < i);
      nodes[k].classList.toggle('is-active', k === i);
      if (k === i) nodes[k].firstChild.setAttribute('aria-current', 'true');
      else nodes[k].firstChild.removeAttribute('aria-current');
    }
    shown = i;
    if (isFollowing()) scrollToLine(Math.max(0, i));
  }

  function loop() {
    frame = 0;
    if (!visible || !item) return;
    if (!fetching && !cache.has(item.videoId) && (getDuration() > 0 || Date.now() - songAt > WAIT_DURATION_MS)) load();
    if (lines) {
      paint(activeIndex(lines, getTime() - offset()));
      // หยุดตามครบเวลาแล้ว → กลับมาตามเอง และซ่อนปุ่ม
      if (!followBtn.hidden && isFollowing()) {
        followBtn.hidden = true;
        scrollToLine(Math.max(0, shown));
      }
    }
    frame = requestAnimationFrame(loop);
  }

  function start() {
    if (!frame && visible) frame = requestAnimationFrame(loop);
  }

  function markUserScroll() {
    if (!lines) return;
    userScrollAt = Date.now();
    followBtn.hidden = false;
  }

  function syncSeekable() {
    const ok = canSeek();
    for (const node of nodes) node.firstChild.disabled = !ok;
  }

  function shiftOffset(delta) {
    if (!item) return;
    offsets = withOffset(offsets, item.videoId, clampOffset(offset() + delta));
    saveOffsets(offsets);
    renderOffset();
    shown = -2; // บังคับวาดใหม่ตามเวลาที่ปรับ
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.lyric-line');
    if (!btn || btn.disabled || !lines) return;
    const line = lines[Number(btn.dataset.i)];
    userScrollAt = -Infinity; // กดบรรทัด = อยากตามต่อจากตรงนั้น
    followBtn.hidden = true;
    onSeek(Math.max(0, line.t + offset()));
  });
  scroller.addEventListener('wheel', markUserScroll, { passive: true });
  scroller.addEventListener('touchmove', markUserScroll, { passive: true });
  scroller.addEventListener('keydown', (e) => SCROLL_KEYS.has(e.key) && markUserScroll());
  followBtn.addEventListener('click', () => {
    userScrollAt = -Infinity;
    followBtn.hidden = true;
    scrollToLine(Math.max(0, shown));
  });
  thBtn.addEventListener('click', () => {
    showTh = !showTh;
    saveShowTh(showTh);
    syncTranslation();
  });
  $('lyrics-earlier').addEventListener('click', () => shiftOffset(-OFFSET_STEP));
  $('lyrics-later').addEventListener('click', () => shiftOffset(OFFSET_STEP));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return start();
    cancelAnimationFrame(frame);
    frame = 0;
  });

  return {
    // เรียกทุกครั้งที่สถานะห้องเปลี่ยน — เปลี่ยนเพลงจริงค่อยล้างของเก่า
    setSong(next) {
      if (next?.videoId === item?.videoId) return;
      item = next;
      songAt = Date.now();
      token += 1;
      fetching = false;
      userScrollAt = -Infinity;
      if (!item) return clear('ยังไม่มีเพลง');
      if (cache.has(item.videoId)) show(cache.get(item.videoId));
      else clear('กำลังหาเนื้อเพลง…');
      // loop หยุดตัวเองตอนยังไม่มีเพลง (เช่นเปิดเว็บมาในโหมดเนื้อเพลงก่อนเข้าห้อง) → ปลุกใหม่ตอนเพลงมา
      start();
    },
    setVisible(on) {
      visible = on;
      if (on) {
        shown = -2;
        start();
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    },
    // host เข้า/ออก → กดบรรทัดเพื่อ seek ได้/ไม่ได้
    refreshSeekable: syncSeekable,
  };
}
