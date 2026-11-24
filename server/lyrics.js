// เนื้อเพลงแบบมีเวลากำกับ (LRC) จาก LRCLIB — ฟรี ไม่ต้องมี key
// docs: https://lrclib.net/docs
// ทำฝั่ง server (ไม่ให้ browser ยิงตรง) เพราะ: cache ร่วมกันทั้งห้อง คนในห้องขอเพลงเดียวกันยิงจริงแค่ครั้งเดียว
// และตั้ง User-Agent ตามที่ LRCLIB ขอได้ (browser ตั้งเองไม่ได้)
import { cleanTitle } from './youtube.js';

const LRCLIB_URL = 'https://lrclib.net/api/search';
const USER_AGENT = 'listen-together/0.1 (personal project)';
const FETCH_TIMEOUT_MS = 6000;
const CACHE_MAX = 300;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
// ความยาวต่างกันเกินนี้ = น่าจะเป็นคนละเวอร์ชัน (live/remix) → ไม่ใช้เนื้อแบบซิงค์ เพราะเวลาจะคลาดทั้งเพลง
// เผื่อไว้กว้างหน่อย เพราะ MV มักมีฉากเปิด/ปิดยาวกว่าเพลงในอัลบั้ม
const MAX_DURATION_GAP_SEC = 45;
const MAX_LINES = 400;

const TOPIC_RE = /\s*-\s*Topic$/i;
const TIMESTAMP_RE = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

// คำค้น: ช่อง "<ศิลปิน> - Topic" ของ YouTube Music ชื่อเพลงมักไม่มีศิลปิน → ต่อชื่อศิลปินเข้าไป
// ช่องอื่น (ค่าย/คนอัปโหลด) ชื่อคลิปมักมีศิลปินอยู่แล้ว ส่วนชื่อช่องมักไม่ใช่ศิลปิน → ใช้แค่ชื่อเพลงที่ล้างแล้ว
export function lyricsQuery(title, channel) {
  const song = cleanTitle(title);
  const ch = String(channel ?? '');
  if (TOPIC_RE.test(ch)) return `${song} ${ch.replace(TOPIC_RE, '').trim()}`.trim();
  return song;
}

// "[00:14.60][01:20.10] ข้อความ" → [{ t: 14.6, text }, { t: 80.1, text }] เรียงตามเวลา
// บรรทัดว่าง (ช่วงดนตรี) เก็บไว้เป็น text '' — หน้าเว็บโชว์เป็นจุด ♪ ให้รู้ว่ากำลังอยู่ช่วงไม่มีเนื้อ
export function parseLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc ?? '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(TIMESTAMP_RE)];
    if (!stamps.length) continue; // บรรทัด metadata เช่น [ar:...] ไม่ใช่เวลา → ข้าม
    const text = raw.replace(TIMESTAMP_RE, '').trim();
    for (const [, min, sec] of stamps) {
      lines.push({ t: Number(min) * 60 + Number(sec.replace(':', '.')), text });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.slice(0, MAX_LINES);
}

const gapOf = (row, duration) => (duration > 0 && row.duration > 0 ? Math.abs(row.duration - duration) : 0);

// เลือกผลที่ดีที่สุด: มีเนื้อแบบซิงค์ + ความยาวใกล้เพลงที่เล่นอยู่ที่สุด
// ไม่มีแบบซิงค์ที่ความยาวใกล้พอ → ถอยไปใช้เนื้อธรรมดา (โชว์ได้แต่ไม่วิ่งตาม)
export function pickLyrics(rows, duration) {
  const list = Array.isArray(rows) ? rows.filter((row) => row && !row.instrumental) : [];
  const synced = list
    .filter((row) => row.syncedLyrics && gapOf(row, duration) <= MAX_DURATION_GAP_SEC)
    .sort((a, b) => gapOf(a, duration) - gapOf(b, duration));
  if (synced.length) {
    const best = synced[0];
    return { synced: parseLrc(best.syncedLyrics), plain: null, track: best.trackName, artist: best.artistName };
  }
  const plain = list.find((row) => row.plainLyrics);
  if (plain) return { synced: null, plain: String(plain.plainLyrics).slice(0, 8000), track: plain.trackName, artist: plain.artistName };
  return null;
}

const cache = new Map(); // key → { at, value }

function readCache(key, now) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache(key, value, now) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, value });
}

// คืน { synced, plain, track, artist } หรือ null (หาไม่เจอ — cache ผล null ด้วย กันยิงซ้ำเพลงที่ไม่มีเนื้อ)
export async function findLyrics({ videoId, title, channel, duration }, fetchImpl = fetch) {
  const query = lyricsQuery(title, channel);
  if (!query) return null;
  // ความยาวปัดเป็นช่วง 10 วิ ให้ทุกเครื่องในห้องได้ key เดียวกัน (แต่ละเครื่องอ่าน duration ต่างกันเศษวินาที)
  const key = `${videoId}:${Math.round(duration / 10)}`;
  const now = Date.now();
  const cached = readCache(key, now);
  if (cached !== undefined) return cached;

  const res = await fetchImpl(`${LRCLIB_URL}?${new URLSearchParams({ q: query })}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`LRCLIB ตอบกลับ ${res.status}`);
    err.status = res.status;
    throw err; // พังชั่วคราว → ไม่ cache จะได้ลองใหม่ได้
  }
  const value = pickLyrics(await res.json(), duration);
  writeCache(key, value, now);
  return value;
}
