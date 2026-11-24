// หาเพลงที่ "คล้ายกันจริง" จาก Last.fm (ข้อมูลว่าคนที่ฟังเพลงนี้ ฟังเพลงไหนต่อ) — ขั้น 2 ของการต่อเพลง
// docs: https://www.last.fm/api/show/track.getSimilar · artist.getSimilar · artist.getTopTracks
//
// Last.fm บอกได้แค่ "ศิลปิน + ชื่อเพลง" → ยังต้องไปค้น YouTube ทีละเพลงเพื่อเอาคลิป (ส่วนนั้นอยู่ใน index.js)
// ไม่ตั้ง LASTFM_API_KEY = ไม่ใช้ไฟล์นี้เลย ระบบต่อเพลงแบบขั้น 1 (ค้นจากชื่อศิลปิน) ตามเดิม
// เพลงไทยใน Last.fm มีน้อย → หาไม่เจอบ่อย ระบบจะถอยไปขั้น 1 เอง
import { cleanTitle } from './youtube.js';
import { artistKey, songCore } from './taste.js';

const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const USER_AGENT = 'listen-together/0.1 (personal project)';
const FETCH_TIMEOUT_MS = 6000;
const CACHE_MAX = 300;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const TRACK_LIMIT = 40;
const FALLBACK_ARTISTS = 3; // track.getSimilar ไม่เจอ → ลองศิลปินคล้ายกี่คน
const TOP_TRACKS_PER_ARTIST = 8;
const MIN_TRACK_RESULTS = 5;

const TOPIC_RE = /\s*-\s*Topic$/i;
const SPLIT_RE = /\s[-–|]\s/;
const norm = (text) => String(text ?? '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

// เดาว่า "ศิลปิน / ชื่อเพลง" คืออะไรจากข้อมูล YouTube → คืนหลายแบบให้ลองตามลำดับ
//  - ช่อง "X - Topic" = ศิลปิน X แน่นอน ชื่อคลิป = ชื่อเพลง
//  - ชื่อคลิป "A - B": อังกฤษมักเป็น ศิลปิน - เพลง ไทยมักเป็น เพลง - ศิลปิน → ลองทั้งสองฝั่ง
export function lookupsFor(item) {
  const channel = String(item?.channel ?? '');
  const title = cleanTitle(item?.title);
  if (!title) return [];
  if (TOPIC_RE.test(channel)) return [{ artist: channel.replace(TOPIC_RE, '').trim(), track: title }];
  const parts = title.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return [
      { artist: parts[0], track: parts[1] },
      { artist: parts[1], track: parts[0] },
    ];
  }
  return [];
}

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);

export function parseSimilarTracks(json) {
  return asList(json?.similartracks?.track)
    .map((t) => ({ artist: String(t?.artist?.name ?? ''), track: String(t?.name ?? ''), match: Number(t?.match) || 0 }))
    .filter((t) => t.artist && t.track);
}

export function parseSimilarArtists(json) {
  return asList(json?.similarartists?.artist)
    .map((a) => ({ name: String(a?.name ?? ''), match: Number(a?.match) || 0 }))
    .filter((a) => a.name);
}

export function parseTopTracks(json, artist) {
  return asList(json?.toptracks?.track)
    .map((t) => ({ artist: String(t?.artist?.name ?? artist), track: String(t?.name ?? '') }))
    .filter((t) => t.track);
}

// เลือกเพลงคล้ายมา count เพลง: ศิลปินไม่ซ้ำกัน · ไม่ใช่ศิลปินตั้งต้น (อันนั้นขั้น 1 หาให้อยู่แล้ว)
// ไม่ใช่ศิลปินที่ห้องข้ามบ่อย · ไม่ใช่เพลงที่เคยเล่น · สุ่มโดยถ่วงตามความคล้าย (match สูง = โอกาสมาก)
export function chooseSimilar(list, ctx, seedArtistName, count, rand = Math.random) {
  const seedKey = norm(seedArtistName);
  const usedArtists = new Set([seedKey]);
  const pool = list.filter((s) => {
    const key = norm(s.artist);
    return !ctx.disliked.has(key) && !ctx.excludeCores.has(songCore(s.track));
  });
  const picked = [];
  while (picked.length < count && pool.length) {
    const open = pool.filter((s) => !usedArtists.has(norm(s.artist)));
    if (!open.length) break;
    const total = open.reduce((sum, s) => sum + Math.max(s.match, 0.05), 0);
    let roll = rand() * total;
    let chosen = open[open.length - 1];
    for (const s of open) {
      roll -= Math.max(s.match, 0.05);
      if (roll <= 0) {
        chosen = s;
        break;
      }
    }
    usedArtists.add(norm(chosen.artist));
    picked.push(chosen);
  }
  return picked;
}

// จากผลค้น YouTube ของ "ศิลปิน ชื่อเพลง" เลือกคลิปที่เป็นเพลงนั้นจริง (กันได้เพลงอื่นของศิลปินเดียวกัน/คลิปมั่ว)
// ต้อง: ชื่อคลิปมีชื่อเพลง และ (ช่องหรือชื่อคลิป) มีชื่อศิลปิน · แล้วเอาตัวที่ scoreFn ให้คะแนนสูงสุด
export function bestMatch(results, want, scoreFn) {
  const track = norm(want.track);
  const artist = norm(want.artist);
  let best = null;
  let bestScore = -Infinity;
  for (const r of results) {
    const title = norm(r.title);
    const hasArtist = title.includes(artist) || norm(r.channel).includes(artist) || artistKey(r) === artist;
    if (!title.includes(track) || !hasArtist) continue;
    const score = scoreFn(r);
    if (score !== null && score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

// ---------- เรียก API ----------
const cache = new Map();

async function call(params, apiKey, fetchImpl) {
  const key = JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;
  const query = new URLSearchParams({ ...params, api_key: apiKey, format: 'json', autocorrect: '1' });
  const res = await fetchImpl(`${API_URL}?${query}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  // error 6 = หาเพลง/ศิลปินไม่เจอ → ถือว่าไม่มีผล (cache ไว้ด้วย) · error อื่น (key ผิด/โดนจำกัด) → โยนให้ถอยไปขั้น 1
  if (json?.error && json.error !== 6) throw new Error(`Last.fm error ${json.error}: ${json.message ?? ''}`);
  if (!res.ok && json?.error !== 6) throw new Error(`Last.fm ตอบกลับ ${res.status}`);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), json });
  return json;
}

// คืน { artist: ชื่อศิลปินตั้งต้นที่ Last.fm รู้จัก, similar: [{artist, track, match}] }
// ลำดับ: เพลงคล้าย (track.getSimilar) → ไม่พอ → ศิลปินคล้าย + เพลงดังของศิลปินพวกนั้น
export async function findSimilar(item, apiKey, fetchImpl = fetch) {
  const lookups = lookupsFor(item);
  for (const { artist, track } of lookups) {
    const similar = parseSimilarTracks(await call({ method: 'track.getsimilar', artist, track, limit: String(TRACK_LIMIT) }, apiKey, fetchImpl));
    if (similar.length >= MIN_TRACK_RESULTS) return { artist, similar };
  }
  for (const { artist } of lookups) {
    const artists = parseSimilarArtists(await call({ method: 'artist.getsimilar', artist, limit: '12' }, apiKey, fetchImpl));
    if (!artists.length) continue;
    const similar = [];
    for (const a of artists.slice(0, FALLBACK_ARTISTS)) {
      const tops = parseTopTracks(await call({ method: 'artist.gettoptracks', artist: a.name, limit: String(TOP_TRACKS_PER_ARTIST) }, apiKey, fetchImpl), a.name);
      for (const t of tops) similar.push({ ...t, match: a.match });
    }
    if (similar.length) return { artist, similar };
  }
  return { artist: lookups[0]?.artist ?? '', similar: [] };
}
