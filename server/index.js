// server ตัวเดียว: เสิร์ฟหน้าเว็บ (public/) + API ค้นเพลง + Socket.IO คุมสถานะห้อง
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { cleanGesture, cleanLook, cleanPose, createPerSecondLimiter, randomLook, spawnPose } from './avatar.js';
import { startBotMatch, tickBot } from './duel-bot.js';
import { createItemState, drop, groundList, pickUp, spawnTick } from './items.js';
import {
  act as duelAct, attack as duelAttack, createArena, forfeit, isFighter, joinQueue, leaveQueue, swapWeapon,
  publicMatch, queueNames, setPose as setDuelPose, stepDuel, winsOf,
} from './duel.js';
import { appendChat, cleanChatText, createChatLimiter } from './chat.js';
import { createRoomState, needsAutofill, reduce } from './room.js';
import { cooldownLeftSec, decideHostStart, HOST_GRACE_MS } from './host.js';
import { cleanHostState, cleanName, isRoomId, makeQueueItem, normalizeRoomId, sanitizeAction } from './validate.js';
import { zipFolder } from './zip.js';
import { CHART_REGIONS, fetchPlaylist, fetchTopChart, isAutoMix, isVideoId, keepSongLength, parsePlaylistId, resolveLink, search, suggestCandidates } from './youtube.js';
import { isJunk, outcomeOf, recordOutcome } from './taste.js';
import { findSimilar } from './lastfm.js';
import { estimateUnits, pickAutofill } from './autofill.js';
import { findLyrics } from './lyrics.js';
import { translateLines } from './translate.js';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
// ไม่บังคับ: มี key = ต่อเพลงด้วยเพลงคล้ายจาก Last.fm (ขั้น 2) · ไม่มี = ค้นจากชื่อศิลปินอย่างเดียว (ขั้น 1)
const LASTFM_KEY = process.env.LASTFM_API_KEY ?? '';
const MAX_ROOMS = 100;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_QUERY_LEN = 100;
const RATE_LIMIT_PER_SEC = 10;

const HTTP_LIMIT_PER_MIN = 30;
const MAX_SOCKETS_PER_IP = 10;

const app = express();
app.disable('x-powered-by');

// บน Render ทุก request ผ่าน proxy 1 ชั้น → IP ที่เห็นตรงๆ เป็นของ proxy (ทุกคนจะดูเป็นคนเดียวกัน)
// TRUST_PROXY=1 = เชื่อ X-Forwarded-For ตัวขวาสุด (ตัวที่ proxy ของ Render เติมเอง ปลอมไม่ได้)
// รันในเครื่องไม่ต้องตั้ง — ไม่งั้นใครก็ส่ง header ปลอมมาหลบ rate limit ได้
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
if (TRUST_PROXY) app.set('trust proxy', 1);

function socketIp(socket) {
  if (!TRUST_PROXY) return socket.handshake.address;
  const forwarded = String(socket.handshake.headers['x-forwarded-for'] ?? '').split(',');
  return forwarded.at(-1).trim() || socket.handshake.address;
}
app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));
// Three.js (ห้อง 3D) เสิร์ฟจาก node_modules เอง — ไม่พึ่ง CDN ภายนอก
app.use('/vendor/three', express.static(fileURLToPath(new URL('../node_modules/three/build', import.meta.url)), { maxAge: '7d' }));

// แจก extension "host" ให้คนที่อยากกด "ฟังตามผม" (zip สร้างครั้งแรกที่มีคนขอ แล้วเก็บไว้ในหน่วยความจำ)
let extensionZip = null;
app.get('/extension.zip', (_req, res) => {
  try {
    extensionZip ??= zipFolder(fileURLToPath(new URL('../extension', import.meta.url)), 'listen-with-chok-host');
  } catch (err) {
    console.error('[extension.zip]', err.message);
    return res.status(500).send('สร้างไฟล์ไม่สำเร็จ');
  }
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="listen-with-chok-host.zip"' });
  return res.send(extensionZip);
});

// จำกัด /api/* ต่อ IP (กันยิงค้นจนโควต้า YouTube ทั้งวันหมด)
const httpHits = new Map(); // ip → { windowStart, count }
setInterval(() => httpHits.clear(), 10 * 60 * 1000).unref();
app.use('/api', (req, res, next) => {
  const now = Date.now();
  const hit = httpHits.get(req.ip);
  if (!hit || now - hit.windowStart >= 60_000) {
    httpHits.set(req.ip, { windowStart: now, count: 1 });
    return next();
  }
  hit.count += 1;
  return hit.count > HTTP_LIMIT_PER_MIN ? res.status(429).json({ error: 'ค้นถี่เกินไป รอสักครู่' }) : next();
});

app.get('/api/config', (_req, res) => res.json({ searchEnabled: Boolean(API_KEY) }));

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q || q.length > MAX_QUERY_LEN) return res.status(400).json({ error: 'คำค้นว่างหรือยาวเกินไป' });
  if (!API_KEY) return res.status(503).json({ error: 'ยังไม่ได้ตั้ง YOUTUBE_API_KEY — วางลิงก์เพลงแทนได้' });
  try {
    return res.json({ results: await search(q, API_KEY) });
  } catch (err) {
    console.error('[search]', err.message);
    const quota = err.status === 403;
    return res.status(quota ? 429 : 502).json({ error: quota ? 'โควต้าค้นหาวันนี้หมดแล้ว — วางลิงก์เพลงแทนได้' : 'ค้นหาไม่สำเร็จ' });
  }
});

// Top 50 เพลงมาแรงของประเทศ (TH/US/KR) · cache 3 ชม. ทั้ง server → แทบไม่กินโควตา
app.get('/api/top', async (req, res) => {
  const region = String(req.query.region ?? 'TH').toUpperCase();
  if (!CHART_REGIONS.includes(region)) return res.status(400).json({ error: 'ไม่มีชาร์ตของประเทศนี้' });
  if (!API_KEY) return res.status(503).json({ error: 'ยังไม่ได้ตั้ง YOUTUBE_API_KEY — ดูชาร์ตไม่ได้' });
  try {
    const chart = await fetchTopChart(region, API_KEY, { isJunk });
    return res.json({ region, ...chart });
  } catch (err) {
    console.error('[top]', err.message);
    const quota = err.status === 403;
    return res.status(quota ? 429 : 502).json({ error: quota ? 'โควต้าวันนี้หมดแล้ว ลองใหม่พรุ่งนี้' : 'ดึงชาร์ตไม่สำเร็จ' });
  }
});

app.get('/api/resolve', async (req, res) => {
  try {
    const item = await resolveLink(String(req.query.u ?? '').slice(0, 300));
    return item ? res.json({ item }) : res.status(400).json({ error: 'ไม่ใช่ลิงก์ YouTube / YouTube Music' });
  } catch (err) {
    console.error('[resolve]', err.message);
    return res.status(404).json({ error: 'หาเพลงจากลิงก์นี้ไม่เจอ' });
  }
});

// วางลิงก์ playlist → คืนรายการเพลง (ใช้ playlistItems: 1 หน่วยต่อ 50 เพลง ถูกกว่าค้นทีละเพลงมาก)
app.get('/api/playlist', async (req, res) => {
  const playlistId = parsePlaylistId(String(req.query.u ?? '').slice(0, 300));
  if (!playlistId) return res.status(400).json({ error: 'ไม่ใช่ลิงก์ playlist ของ YouTube' });
  if (isAutoMix(playlistId)) return res.status(400).json({ error: 'Mix ที่ YouTube สร้างให้อัตโนมัติดึงรายการไม่ได้ — ใช้ playlist ที่สร้างเองแทน' });
  if (!API_KEY) return res.status(503).json({ error: 'ยังไม่ได้ตั้ง YOUTUBE_API_KEY — ดึง playlist ไม่ได้' });
  try {
    const items = await fetchPlaylist(playlistId, API_KEY);
    return items.length ? res.json({ items }) : res.status(404).json({ error: 'playlist นี้ไม่มีเพลงที่เปิดได้' });
  } catch (err) {
    console.error('[playlist]', err.message);
    const notFound = err.status === 404 || err.status === 403;
    return res.status(notFound ? 404 : 502).json({ error: notFound ? 'หา playlist ไม่เจอ หรือเป็นแบบส่วนตัว' : 'ดึง playlist ไม่สำเร็จ' });
  }
});

// เนื้อเพลงของเพลงที่เล่นอยู่ (หน้าเว็บส่งชื่อ/ช่อง/ความยาวมา) — ไม่เจอ = 404 ให้หน้าเว็บโชว์ "ไม่มีเนื้อเพลง"
const MAX_SONG_SEC = 3 * 60 * 60;
// query ของเพลง (ใช้ทั้งเนื้อเพลงและคำแปล) · ข้อมูลไม่ครบ → null
function songQuery(query) {
  const videoId = String(query.v ?? '');
  const title = String(query.title ?? '').slice(0, 200);
  const channel = String(query.channel ?? '').slice(0, 100);
  const duration = Math.min(Math.max(Number(query.d) || 0, 0), MAX_SONG_SEC);
  return isVideoId(videoId) && title.trim() ? { videoId, title, channel, duration } : null;
}

app.get('/api/lyrics', async (req, res) => {
  const song = songQuery(req.query);
  if (!song) return res.status(400).json({ error: 'ข้อมูลเพลงไม่ครบ' });
  try {
    const lyrics = await findLyrics(song);
    return lyrics ? res.json(lyrics) : res.status(404).json({ error: 'ไม่พบเนื้อเพลงนี้' });
  } catch (err) {
    console.error('[lyrics]', err.message);
    return res.status(502).json({ error: 'ดึงเนื้อเพลงไม่สำเร็จ ลองใหม่อีกที' });
  }
});

// คำแปลไทยของเนื้อเพลงเดียวกับ /api/lyrics (ดึงเนื้อจาก cache ไม่ยิง LRCLIB ซ้ำ)
// คืน { lang, lines } ยาวเท่าบรรทัดเนื้อเพลง · เพลงไทย/ไม่มีเนื้อ/แปลจับคู่ไม่ได้ → { lines: null }
app.get('/api/lyrics/th', async (req, res) => {
  const song = songQuery(req.query);
  if (!song) return res.status(400).json({ error: 'ข้อมูลเพลงไม่ครบ' });
  try {
    const lyrics = await findLyrics(song);
    const texts = lyrics?.synced ? lyrics.synced.map((l) => l.text) : lyrics?.plain?.split(/\r?\n/);
    if (!texts) return res.json({ lines: null });
    const key = `${song.videoId}:${Math.round(song.duration / 10)}:${lyrics.synced ? 's' : 'p'}`;
    return res.json((await translateLines(key, texts)) ?? { lines: null });
  } catch (err) {
    console.error('[translate]', err.message);
    return res.status(502).json({ error: 'แปลเนื้อเพลงไม่สำเร็จ' });
  }
});

const httpServer = createServer(app);
const io = new Server(httpServer);

// rooms: roomId → { state, users: Map<socketId, {name, look, pose, held}>, items, cleanupTimer, event, fillingFor, chat, chatSeq }
const rooms = new Map();
const AUTO_ADDED_BY = 'ต่อให้อัตโนมัติ';
const LOBBY_LIMIT = 20;

// ห้องที่มีคนฟังอยู่ตอนนี้ (หน้าเข้าห้องใช้แสดงให้กดเข้าร่วม)
// ⚠️ ใครเปิดเว็บก็เห็นชื่อห้อง — เหมาะกับใช้ในกลุ่มเพื่อน ถ้าจะเปิดสาธารณะให้ลบ route นี้
app.get('/api/rooms', (_req, res) => {
  const list = [...rooms.entries()]
    .filter(([, room]) => room.users.size > 0)
    .map(([id, room]) => ({
      id,
      listeners: room.users.size,
      nowPlaying: room.state.queue.find((item) => item.id === room.state.currentId)?.title ?? null,
    }))
    .sort((a, b) => b.listeners - a.listeners)
    .slice(0, LOBBY_LIMIT);
  res.json({ rooms: list });
});

// event = "ใครทำอะไรล่าสุด" ให้หน้าเว็บเด้งข้อความบอกคนอื่น (ไม่ใช่ส่วนของ reducer เพราะเป็นแค่การแจ้งเตือน)
const snapshot = (room) => ({ ...room.state, event: room.event ?? null, serverTime: Date.now() });
const userList = (room) => [...room.users.values()].map((user) => user.name);
const avatarOf = (id, user) => ({ id, name: user.name, look: user.look, pose: user.pose, held: user.held });
const avatarList = (room) => [...room.users.entries()].map(([id, user]) => avatarOf(id, user));
const POSE_LIMIT_PER_SEC = 15;
const ITEM_TICK_MS = 1000;

// ของในลาน: ทุกวินาทีเช็คว่าห้องไหนถึงเวลาวางของใหม่ (เฉพาะห้องที่มีคนอยู่)
const emitItems = (roomId, room) => io.to(roomId).emit('items', groundList(room.items));
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.users.size > 0 && spawnTick(room.items, now)) emitItems(roomId, room);
  }
}, ITEM_TICK_MS).unref();
const GESTURE_LIMIT_PER_SEC = 4;

// ---------- ลานประลอง 1v1 ----------
// ทุก 50 ms เดินเวลาให้ห้องที่มีแมตช์: ท่าที่ง้างเสร็จ ลูกยิง หมดเวลา แล้วกระจายผลตามประเภท
// ลูกยิง/ตำแหน่งส่งเฉพาะสองคนในลาน (คนดูข้างนอกไม่ได้วาดลาน) · เลือด/ผลแพ้ชนะส่งทั้งห้อง (แถบเลือดคนดู)
const DUEL_TICK_MS = 50;
const ATTACK_LIMIT_PER_SEC = 12; // ตี + บล็อก/กลิ้ง/แดช รวมกัน
const STAMINA_SEND_MS = 200;
const emitDuelQueue = (roomId, room) => io.to(roomId).emit('duel:queue', queueNames(room.arena));
const fightersOf = (match) => match.order;

function emitDuelEvents(roomId, room, events, now) {
  for (const ev of events) {
    const match = room.arena.match;
    if (ev.type === 'start') {
      io.to(roomId).emit('duel:start', publicMatch(ev.match, now));
      emitDuelQueue(roomId, room);
    } else if (ev.type === 'phase') io.to(roomId).emit('duel:state', publicMatch(match, now));
    else if (ev.type === 'hit') io.to(roomId).emit('duel:hit', ev);
    else if (ev.type === 'shot' || ev.type === 'shotEnd') io.to(fightersOf(match)).emit(`duel:${ev.type}`, ev);
    else if (ev.type === 'end') {
      const names = fightersOf(match).map((id) => match.fighters[id].name);
      io.to(roomId).emit('duel:end', { winner: ev.winner, winnerId: ev.winnerId, reason: ev.reason, wins: match.brain ? {} : winsOf(room.arena, names) }); // แมตช์ NPC ไม่นับสถิติ
    } else if (ev.type === 'close') io.to(roomId).emit('duel:close');
    else if (ev.type === 'swing') io.to(fightersOf(match)).emit('duel:swing', ev);
    else if (ev.type === 'state') io.to(roomId).emit('duel:state', publicMatch(match, now));
    else if (ev.type === 'pose') io.to(fightersOf(match)).volatile.emit('duel:pose', { id: ev.id, ...ev.pose });
    else if (ev.type === 'act') io.to(fightersOf(match)).emit('duel:act', { id: ev.id, act: ev.act, on: ev.on, ms: ev.ms });
    else if (ev.type === 'dodge') io.to(roomId).emit('duel:dodge', ev);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (!room.arena.match) continue;
    const dt = DUEL_TICK_MS / 1000;
    emitDuelEvents(roomId, room, [...tickBot(room.arena, now, dt), ...stepDuel(room.arena, now, dt)], now);
    const match = room.arena.match;
    if (match?.phase === 'fight' && now - (match.staminaSentAt ?? 0) >= STAMINA_SEND_MS) {
      match.staminaSentAt = now;
      const values = Object.fromEntries(match.order.map((id) => [id, Math.round(match.fighters[id].stamina)]));
      // ไม่ใช้ volatile: ส่งต่อจาก duel:pose (volatile) ใน tick เดียวกัน ช่องยังเขียนไม่เสร็จ → volatile ถูกทิ้งทุกรอบ
      // (เจอ 2026-11-27: สตามินาไม่เคยถึงหน้าเว็บเลย ค้างค่าที่เครื่องลดเอง) · 5 ครั้ง/วิ ข้อความเล็ก ส่งแบบรับประกันได้
      io.to(match.order).emit('duel:stamina', values);
    }
  }
}, DUEL_TICK_MS).unref();

function describeEvent(action, actor, seq, state) {
  const event = { seq, type: action.type, by: actor.name, bySocket: actor.socketId };
  if (action.type === 'add') event.title = action.item.title;
  if (action.type === 'autofill' || action.type === 'addMany') event.count = action.items.length;
  if (action.type === 'mode') event.mode = action.mode;
  if (action.type === 'move') event.title = state.queue.find((item) => item.id === action.id)?.title;
  if (action.type === 'hostStart' && action.prev) event.prev = action.prev;
  if (action.type === 'hostStop') event.reason = action.reason;
  return event;
}

// จุดเดียวที่เปลี่ยนสถานะห้อง: reduce → จำ event → กระจายให้ทุกคน → เช็คว่าต้องเติมเพลงไหม
function dispatch(roomId, room, action, actor) {
  const now = Date.now();
  const next = reduce(room.state, action, now);
  if (next === room.state) return;
  // จำว่าเพลงที่เพิ่งจบรอบ ห้องฟังจบหรือข้าม (ใช้ตอนเลือกเพลงต่อให้ · ไม่ส่งให้หน้าเว็บ)
  const outcome = outcomeOf(room.state, next, action, now);
  if (outcome) room.history = recordOutcome(room.history ?? [], outcome.item, outcome.playedSec, outcome.ended);
  room.state = next;
  room.event = describeEvent(action, actor, next.version, next);
  io.to(roomId).emit('state', snapshot(room));
  maybeAutofill(roomId, room);
}

// งบการเติมเพลง นับเป็น "หน่วยโควตา YouTube" (วันละ 10,000): ขั้น 1 = 101 ต่อรอบ · ขั้น 2 = ~302 (ค้นคลิปทีละเพลง)
// ทุกครั้งที่มีคนเพิ่มเพลงในห้องว่างจะเรียกการเติมเพลง (ผ่าน socket ไม่ติด limit ของ /api) จึงต้องคุมแยก
const AUTOFILL_ROOM_COOLDOWN_MS = 30_000;
const AUTOFILL_COUNT = 3;
const AUTOFILL_DAILY_UNITS = 4000; // ~40% ของโควต้า เหลือให้คนค้นเอง
const DAY_MS = 24 * 60 * 60 * 1000;
const autofillLog = []; // { at, units } ของการเติมเพลง (ทั้ง server) ย้อนหลัง 24 ชม.

// จองงบตามที่คาดว่าจะใช้ก่อนเริ่ม (กันหลายห้องเติมพร้อมกันจนเกิน) แล้วค่อยแก้เป็นค่าจริงตอนจบ
// งบเหลือไม่พอขั้น 2 แต่พอขั้น 1 → ลดเหลือขั้น 1 แทนการไม่เติมเลย
function takeAutofillBudget(room, now) {
  while (autofillLog.length && now - autofillLog[0].at > DAY_MS) autofillLog.shift();
  if (now - (room.lastFillAt ?? 0) < AUTOFILL_ROOM_COOLDOWN_MS) return null;
  const used = autofillLog.reduce((sum, entry) => sum + entry.units, 0);
  const useLastfm = Boolean(LASTFM_KEY) && used + estimateUnits(true) <= AUTOFILL_DAILY_UNITS;
  const units = estimateUnits(useLastfm);
  if (used + units > AUTOFILL_DAILY_UNITS) return null;
  const entry = { at: now, units };
  autofillLog.push(entry);
  room.lastFillAt = now;
  return { entry, useLastfm };
}

// ระหว่างรอผลค้น ห้องอาจเปลี่ยนไปแล้ว (เปลี่ยนโหมด / เปลี่ยนเพลง / มีคนเพิ่มเพลงเอง) → เติมเฉพาะถ้ายังต้องเติมจริง
const stillNeedsFill = (room, seedId) =>
  room.state.whenEmpty === 'similar' && room.state.currentId === seedId && needsAutofill(room.state);

// เล่นถึงเพลงสุดท้ายในคิว → ค้นเพลงแนวเดียวกันมาเติมล่วงหน้า (ไม่รอให้เงียบ)
// fillingFor กันยิงซ้ำต่อเพลงเดิม (ทั้งตอนกำลังค้น และเมื่อค้นแล้วไม่เจอ) — ถ้าไม่ได้ผล ตอนจบเพลง reducer จะวนคิวแทน
async function maybeAutofill(roomId, room) {
  if (!API_KEY || !needsAutofill(room.state)) return;
  const seed = room.state.queue.find((item) => item.id === room.state.currentId);
  if (!seed || room.fillingFor === seed.id) return;
  const budget = takeAutofillBudget(room, Date.now());
  if (!budget) return;
  room.fillingFor = seed.id;
  try {
    // เพลงตั้งต้นเลือกจากรสนิยมห้อง (taste.js) · มี Last.fm = เพิ่มศิลปินใหม่ที่คล้ายกัน (autofill.js)
    const result = await pickAutofill(
      { seed, history: room.history ?? [], queue: room.state.queue, lastSeedArtist: room.lastSeedArtist, count: AUTOFILL_COUNT },
      {
        useLastfm: budget.useLastfm,
        search: (q) => search(q, API_KEY),
        keepSongLength: (items) => keepSongLength(items, API_KEY),
        suggestCandidates: (query, exclude) => suggestCandidates(query, exclude, API_KEY),
        findSimilar: (item) => findSimilar(item, LASTFM_KEY),
        onError: (err) => console.error('[autofill:lastfm]', err.message),
      },
    );
    budget.entry.units = result.units;
    room.lastSeedArtist = result.seedArtist;
    const { picks } = result;
    if (rooms.get(roomId) !== room || !stillNeedsFill(room, seed.id)) return;
    const inQueue = new Set(room.state.queue.map((item) => item.videoId));
    const items = picks.filter((p) => !inQueue.has(p.videoId)).map((p) => makeQueueItem(p, AUTO_ADDED_BY, true));
    if (items.length === 0) return;
    room.fillingFor = null; // เติมสำเร็จ → ถ้าคนลบเพลงที่เติมทิ้ง จะเติมใหม่ได้ (ยังติดงบ/cooldown)
    dispatch(roomId, room, { type: 'autofill', items }, { name: AUTO_ADDED_BY, socketId: null });
  } catch (err) {
    console.error('[autofill]', err.message);
  }
}

// ---------- โหมด host ("ฟังตามผม") ----------
// ข้อมูลประกอบที่ไม่ต้องอยู่ใน state ที่ส่งให้ทุกคน: hostSince (ได้เป็น host เมื่อไร), hostActiveAt (เล่นเพลงล่าสุดเมื่อไร)
function startHost(roomId, room, socketId, name, prevName) {
  const now = Date.now();
  clearTimeout(room.hostTimer);
  room.hostSince = now;
  room.hostActiveAt = now; // host ใหม่ได้เวลาตั้งตัว (ไปเปิด YouTube Music) ก่อนจะถูกแย่งโดยไม่ถาม
  dispatch(roomId, room, { type: 'hostStart', host: { socketId, name }, prev: prevName }, { name, socketId });
}

function stopHost(roomId, room, reason) {
  const host = room.state.host;
  if (!host) return;
  clearTimeout(room.hostTimer);
  dispatch(roomId, room, { type: 'hostStop', socketId: host.socketId, reason }, { name: host.name, socketId: host.socketId });
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = { state: createRoomState(Date.now()), users: new Map(), items: createItemState(), arena: createArena(), cleanupTimer: null, chat: [], chatSeq: 0 };
    rooms.set(roomId, room);
  }
  clearTimeout(room.cleanupTimer);
  return room;
}

// กันคนกดรัวๆ: แต่ละ socket ส่ง action ได้ไม่เกิน N ครั้งต่อวินาที
function createRateLimiter() {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= 1000) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= RATE_LIMIT_PER_SEC;
  };
}

const socketsPerIp = new Map();

io.on('connection', (socket) => {
  const ip = socketIp(socket);
  const open = (socketsPerIp.get(ip) ?? 0) + 1;
  if (open > MAX_SOCKETS_PER_IP) return socket.disconnect(true);
  socketsPerIp.set(ip, open);
  socket.on('disconnect', () => {
    const left = (socketsPerIp.get(ip) ?? 1) - 1;
    if (left <= 0) socketsPerIp.delete(ip);
    else socketsPerIp.set(ip, left);
  });

  let roomId = null;
  let userName = '';
  const allow = createRateLimiter();
  const allowChat = createChatLimiter();
  const allowPose = createPerSecondLimiter(POSE_LIMIT_PER_SEC);
  const allowGesture = createPerSecondLimiter(GESTURE_LIMIT_PER_SEC);
  const me = () => roomId && rooms.get(roomId)?.users.get(socket.id);

  // ใช้ให้หน้าเว็บวัดว่านาฬิกาเครื่องตัวเองต่างจาก server เท่าไร
  socket.on('time', (ack) => typeof ack === 'function' && allow() && ack(Date.now()));

  socket.on('join', (payload, ack) => {
    if (typeof ack !== 'function' || roomId || !allow()) return;
    const requested = normalizeRoomId(payload?.room);
    if (!isRoomId(requested)) return ack({ error: 'ชื่อห้องไม่ถูกต้อง' });
    const room = getOrCreateRoom(requested);
    if (!room) return ack({ error: 'ห้องเต็มแล้ว ลองใหม่ภายหลัง' });

    roomId = requested;
    userName = cleanName(payload?.name);
    const user = { name: userName, look: cleanLook(payload?.look), pose: spawnPose(), held: null };
    room.users.set(socket.id, user);
    socket.join(roomId);
    const duel = room.arena.match ? publicMatch(room.arena.match, Date.now()) : null;
    ack({ state: snapshot(room), users: userList(room), chat: room.chat, avatars: avatarList(room), items: groundList(room.items), you: socket.id, duel, duelQueue: queueNames(room.arena) });
    socket.to(roomId).emit('users', userList(room));
    socket.to(roomId).emit('avatar:join', avatarOf(socket.id, user));
  });

  socket.on('action', (raw) => {
    const room = roomId && rooms.get(roomId);
    if (!room || !allow()) return;
    const action = sanitizeAction(raw, userName);
    if (action) dispatch(roomId, room, action, { name: userName, socketId: socket.id });
  });

  // กด "ฟังตามผม": ตอบ { ok } / { confirm, host } (host เดิมกำลังเปิดเพลง ต้องถามก่อน) / { error }
  socket.on('host:start', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomId && rooms.get(roomId);
    if (!room) return reply({ error: 'ยังไม่ได้เข้าห้อง' });
    if (!allow()) return reply({ error: 'กดถี่ไป รอแป๊บนึง' });
    const host = room.state.host;
    const now = Date.now();
    const decision = decideHostStart({
      host,
      socketId: socket.id,
      hostConnected: Boolean(host && room.users.has(host.socketId)),
      since: room.hostSince ?? 0,
      activeAt: room.hostActiveAt ?? 0,
      now,
      force: payload?.force === true,
    });
    if (decision === 'same') return reply({ ok: true });
    if (decision === 'confirm') return reply({ confirm: true, host: host.name });
    if (decision === 'cooldown') return reply({ error: `${host.name} เพิ่งเป็น host รออีก ${cooldownLeftSec(room.hostSince, now)} วิ` });
    // ถูกแย่ง → บอก host เดิมให้หยุดส่งเพลงและเปิดเสียงเว็บกลับ
    if (host) io.to(host.socketId).emit('host:kicked', { by: userName });
    startHost(roomId, room, socket.id, userName, host?.name);
    return reply({ ok: true });
  });

  socket.on('host:stop', () => {
    const room = roomId && rooms.get(roomId);
    if (room?.state.host?.socketId === socket.id) stopHost(roomId, room, 'stop');
  });

  // สถานะจาก YouTube Music ของ host (extension → หน้าเว็บ host → ที่นี่) · รับเฉพาะจาก host ตัวจริง
  socket.on('host:state', (raw) => {
    const room = roomId && rooms.get(roomId);
    if (!room || room.state.host?.socketId !== socket.id || !allow()) return;
    const now = Date.now();
    const clean = cleanHostState(raw, now);
    if (!clean) return;
    if (clean.isPlaying) room.hostActiveAt = now;
    dispatch(roomId, room, { type: 'hostSync', ...clean, item: makeQueueItem(clean, userName) }, { name: userName, socketId: socket.id });
  });

  // แชท: ตอบ ack ว่าส่งได้ไหม (หน้าเว็บจะได้บอกว่า "ส่งถี่ไป" แทนการเงียบหาย)
  socket.on('chat', (raw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomId && rooms.get(roomId);
    if (!room) return reply({ error: 'ยังไม่ได้เข้าห้อง' });
    const text = cleanChatText(raw);
    if (!text) return reply({ error: 'ข้อความว่าง' });
    if (!allowChat(Date.now())) return reply({ error: 'ส่งถี่ไป รอแป๊บนึง' });
    room.chatSeq += 1;
    const message = { id: room.chatSeq, name: userName, text, at: Date.now(), bySocket: socket.id };
    room.chat = appendChat(room.chat, message);
    io.to(roomId).emit('chat', message);
    return reply({ ok: true });
  });

  // ห้อง 3D: ตำแหน่งส่งแบบ volatile (หลุดบางแพ็กเก็ตได้ ตัวถัดไปมาแทน) · ท่าทาง/หน้าตาส่งปกติ
  socket.on('pose', (raw) => {
    const user = me();
    const pose = user && allowPose(Date.now()) && cleanPose(raw);
    if (!pose) return;
    user.pose = pose;
    socket.to(roomId).volatile.emit('pose', { id: socket.id, ...pose });
  });

  socket.on('gesture', (raw) => {
    const type = me() && allowGesture(Date.now()) && cleanGesture(raw);
    if (type) socket.to(roomId).emit('gesture', { id: socket.id, type });
  });

  socket.on('look', (raw) => {
    const user = me();
    if (!user || !allowGesture(Date.now())) return;
    user.look = cleanLook(raw);
    socket.to(roomId).emit('avatar:look', { id: socket.id, look: user.look });
  });

  // ไอเทม: client บอกว่าเดินทับของชิ้นไหน → server เช็คระยะ/ว่ายังมีของ แล้วบอกทุกคน
  socket.on('item:pick', (rawId) => {
    const room = roomId && rooms.get(roomId);
    const user = me();
    if (!user || !allowGesture(Date.now())) return;
    const res = pickUp(room.items, user, rawId);
    if (!res) return;
    emitItems(roomId, room);
    io.to(roomId).emit('avatar:held', { id: socket.id, kind: res.held });
  });

  socket.on('item:drop', () => {
    const room = roomId && rooms.get(roomId);
    const user = me();
    if (!user || !allowGesture(Date.now()) || !drop(room.items, user)) return;
    emitItems(roomId, room);
    io.to(roomId).emit('avatar:held', { id: socket.id, kind: null });
  });

  // ---------- ลานประลอง ----------
  // กดปุ่มประลอง: อยู่ในคิว = ยกเลิก · ไม่อยู่ = เข้าคิว (มีคนรออยู่ = เริ่มเลย) · ตอบ { queued } ให้ปุ่มเปลี่ยนสถานะ
  const allowDuelPose = createPerSecondLimiter(POSE_LIMIT_PER_SEC);
  const allowAttack = createPerSecondLimiter(ATTACK_LIMIT_PER_SEC);
  socket.on('duel:join', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomId && rooms.get(roomId);
    if (!room || !allowGesture(Date.now())) return reply({ error: 'กดถี่ไป รอแป๊บนึง' });
    const arena = room.arena;
    if (leaveQueue(arena, socket.id)) {
      emitDuelQueue(roomId, room);
      return reply({ queued: false });
    }
    const now = Date.now();
    const res = joinQueue(arena, socket.id, userName, now, payload?.loadout);
    if (res.error) return reply(res);
    if (res.match) emitDuelEvents(roomId, room, [{ type: 'start', match: res.match }], now);
    else emitDuelQueue(roomId, room);
    return reply({ queued: Boolean(res.queued) });
  });

  // ซ้อมกับ NPC (ง่าย/กลาง/ยาก) · ได้เฉพาะตอนลานว่าง
  socket.on('duel:npc', (raw, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const room = roomId && rooms.get(roomId);
    if (!room || !allowGesture(Date.now())) return reply({ error: 'กดถี่ไป รอแป๊บนึง' });
    const now = Date.now();
    const res = startBotMatch(room.arena, socket.id, userName, raw?.level, now, randomLook(), Math.random, raw?.loadout);
    if (res.error) return reply(res);
    emitDuelEvents(roomId, room, [{ type: 'start', match: res.match }], now);
    return reply({ ok: true });
  });

  // ยอมแพ้/ออกจากลานกลางคัน → อีกฝ่ายชนะ
  socket.on('duel:quit', () => {
    const room = roomId && rooms.get(roomId);
    if (!room || !isFighter(room.arena, socket.id)) return;
    const now = Date.now();
    emitDuelEvents(roomId, room, forfeit(room.arena, socket.id, now), now);
  });

  // ตำแหน่งในลาน (พิกัดในลาน) → ส่งต่อให้คู่ต่อสู้คนเดียว
  socket.on('duel:pose', (raw) => {
    const room = roomId && rooms.get(roomId);
    const match = room?.arena.match;
    if (!match || !allowDuelPose(Date.now())) return;
    const pose = setDuelPose(match, socket.id, raw);
    if (!pose) return;
    const other = match.order.find((id) => id !== socket.id);
    io.to(other).volatile.emit('duel:pose', { id: socket.id, ...pose });
  });

  socket.on('duel:attack', (raw) => {
    const room = roomId && rooms.get(roomId);
    const match = room?.arena.match;
    const now = Date.now();
    if (!match || !allowAttack(now)) return;
    const swing = duelAttack(match, socket.id, raw?.ry, now);
    if (swing) io.to(match.order).emit('duel:swing', { id: socket.id, ...swing });
  });

  // สลับอาวุธหลัก/รอง (slot 0/1 · ไม่ส่ง = สลับไปอีกอัน)
  socket.on('duel:swap', (raw) => {
    const room = roomId && rooms.get(roomId);
    const match = room?.arena.match;
    const now = Date.now();
    if (!match || !allowGesture(now)) return;
    if (swapWeapon(match, socket.id, raw?.slot, now)) io.to(roomId).emit('duel:state', publicMatch(match, now));
  });

  // ท่าป้องกัน/หลบ: block (ยก/ลดการ์ด) · roll (· dash ปิดไว้) → server เช็คสตามินา แล้วบอกทั้งสองคนให้เล่นท่า
  socket.on('duel:act', (raw) => {
    const room = roomId && rooms.get(roomId);
    const match = room?.arena.match;
    const now = Date.now();
    if (!match || !allowAttack(now)) return;
    const res = duelAct(match, socket.id, raw?.type, now, raw?.on);
    if (res) io.to(match.order).emit('duel:act', { id: socket.id, ...res, stamina: Math.round(match.fighters[socket.id].stamina) });
    else if (raw?.type === 'roll' || raw?.type === 'dash') socket.emit('duel:act', { id: socket.id, act: 'denied', stamina: Math.round(match.fighters[socket.id]?.stamina ?? 0) });
  });

  socket.on('disconnect', () => {
    const room = roomId && rooms.get(roomId);
    if (!room) return;
    const wasQueued = queueNames(room.arena).length;
    const fighter = isFighter(room.arena, socket.id);
    const duelEvents = forfeit(room.arena, socket.id, Date.now());
    if (duelEvents.length) emitDuelEvents(roomId, room, duelEvents, Date.now());
    if (!fighter && wasQueued !== queueNames(room.arena).length) emitDuelQueue(roomId, room);
    const leaving = room.users.get(socket.id);
    if (leaving && drop(room.items, leaving)) emitItems(roomId, room); // ออกไปแล้วของหล่นไว้ตรงนั้น
    room.users.delete(socket.id);
    // host หลุด: รอต่อกลับ (หน้าเว็บกด host:start ให้เองตอน join ใหม่) ถ้าไม่กลับมา → คืนห้องให้ทุกคนคุม
    if (room.state.host?.socketId === socket.id) {
      const id = roomId;
      clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(() => {
        if (rooms.get(id) === room && room.state.host?.socketId === socket.id) stopHost(id, room, 'left');
      }, HOST_GRACE_MS);
    }
    io.to(roomId).emit('users', userList(room));
    io.to(roomId).emit('avatar:leave', { id: socket.id });
    if (room.users.size === 0) {
      const id = roomId;
      room.cleanupTimer = setTimeout(() => rooms.delete(id), EMPTY_ROOM_TTL_MS);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🎧 listen-together พร้อมที่ http://localhost:${PORT}`);
  if (!API_KEY) console.log('   (ยังไม่มี YOUTUBE_API_KEY — ค้นหาปิดอยู่ ใช้การวางลิงก์แทนได้)');
  if (API_KEY) console.log(`   ต่อเพลงแนวเดียวกัน: ${LASTFM_KEY ? 'ใช้ Last.fm หาเพลงคล้าย' : 'ค้นจากชื่อศิลปิน (ไม่มี LASTFM_API_KEY)'}`);
});
