// server ตัวเดียว: เสิร์ฟหน้าเว็บ (public/) + API ค้นเพลง + Socket.IO คุมสถานะห้อง
import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { cleanGesture, cleanLook, cleanPose, createPerSecondLimiter, spawnPose } from './avatar.js';
import { createItemState, drop, groundList, pickUp, spawnTick } from './items.js';
import { appendChat, cleanChatText, createChatLimiter } from './chat.js';
import { createRoomState, needsAutofill, reduce } from './room.js';
import { cleanName, isRoomId, makeQueueItem, normalizeRoomId, sanitizeAction } from './validate.js';
import { fetchPlaylist, isAutoMix, parsePlaylistId, resolveLink, search, suggest } from './youtube.js';

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
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

function describeEvent(action, actor, seq, state) {
  const event = { seq, type: action.type, by: actor.name, bySocket: actor.socketId };
  if (action.type === 'add') event.title = action.item.title;
  if (action.type === 'autofill' || action.type === 'addMany') event.count = action.items.length;
  if (action.type === 'mode') event.mode = action.mode;
  if (action.type === 'move') event.title = state.queue.find((item) => item.id === action.id)?.title;
  return event;
}

// จุดเดียวที่เปลี่ยนสถานะห้อง: reduce → จำ event → กระจายให้ทุกคน → เช็คว่าต้องเติมเพลงไหม
function dispatch(roomId, room, action, actor) {
  const next = reduce(room.state, action, Date.now());
  if (next === room.state) return;
  room.state = next;
  room.event = describeEvent(action, actor, next.version, next);
  io.to(roomId).emit('state', snapshot(room));
  maybeAutofill(roomId, room);
}

// งบการเติมเพลง: ค้น 1 ครั้ง = 101 หน่วยจากโควต้าวันละ 10,000
// ทุกครั้งที่มีคนเพิ่มเพลงในห้องว่างจะเรียกการเติมเพลง (ผ่าน socket ไม่ติด limit ของ /api) จึงต้องคุมแยก
const AUTOFILL_ROOM_COOLDOWN_MS = 30_000;
const AUTOFILL_DAILY_MAX = 40; // ~40% ของโควต้า เหลือให้คนค้นเอง
const DAY_MS = 24 * 60 * 60 * 1000;
const autofillLog = []; // เวลาที่เติมเพลง (ทั้ง server) ย้อนหลัง 24 ชม.

function takeAutofillBudget(room, now) {
  while (autofillLog.length && now - autofillLog[0] > DAY_MS) autofillLog.shift();
  if (autofillLog.length >= AUTOFILL_DAILY_MAX) return false;
  if (now - (room.lastFillAt ?? 0) < AUTOFILL_ROOM_COOLDOWN_MS) return false;
  autofillLog.push(now);
  room.lastFillAt = now;
  return true;
}

// ระหว่างรอผลค้น ห้องอาจเปลี่ยนไปแล้ว (เปลี่ยนโหมด / เปลี่ยนเพลง / มีคนเพิ่มเพลงเอง) → เติมเฉพาะถ้ายังต้องเติมจริง
const stillNeedsFill = (room, seedId) =>
  room.state.whenEmpty === 'similar' && room.state.currentId === seedId && needsAutofill(room.state);

// เล่นถึงเพลงสุดท้ายในคิว → ค้นเพลงแนวเดียวกันมาเติมล่วงหน้า (ไม่รอให้เงียบ)
// fillingFor กันยิงซ้ำต่อเพลงเดิม (ทั้งตอนกำลังค้น และเมื่อค้นแล้วไม่เจอ) — ถ้าไม่ได้ผล ตอนจบเพลง reducer จะวนคิวแทน
async function maybeAutofill(roomId, room) {
  if (!API_KEY || !needsAutofill(room.state)) return;
  const seed = room.state.queue.find((item) => item.id === room.state.currentId);
  if (!seed || room.fillingFor === seed.id || !takeAutofillBudget(room, Date.now())) return;
  room.fillingFor = seed.id;
  try {
    const picks = await suggest(seed, new Set(room.state.queue.map((item) => item.videoId)), API_KEY);
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

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null;
    room = { state: createRoomState(Date.now()), users: new Map(), items: createItemState(), cleanupTimer: null, chat: [], chatSeq: 0 };
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
    ack({ state: snapshot(room), users: userList(room), chat: room.chat, avatars: avatarList(room), items: groundList(room.items), you: socket.id });
    socket.to(roomId).emit('users', userList(room));
    socket.to(roomId).emit('avatar:join', avatarOf(socket.id, user));
  });

  socket.on('action', (raw) => {
    const room = roomId && rooms.get(roomId);
    if (!room || !allow()) return;
    const action = sanitizeAction(raw, userName);
    if (action) dispatch(roomId, room, action, { name: userName, socketId: socket.id });
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

  socket.on('disconnect', () => {
    const room = roomId && rooms.get(roomId);
    if (!room) return;
    const leaving = room.users.get(socket.id);
    if (leaving && drop(room.items, leaving)) emitItems(roomId, room); // ออกไปแล้วของหล่นไว้ตรงนั้น
    room.users.delete(socket.id);
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
});
