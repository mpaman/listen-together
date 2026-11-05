// คุยกับ YouTube ฝั่ง server เท่านั้น (API key ห้ามหลุดไปหน้าเว็บ)
//  - search(): ค้นผ่าน YouTube Data API v3 (ต้องมี YOUTUBE_API_KEY, โควต้าฟรี ~100 ครั้ง/วัน)
//  - resolveLink(): แปลงลิงก์ YouTube / YouTube Music เป็นข้อมูลเพลง ผ่าน oEmbed (ไม่ต้องใช้ key)

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SEARCH_CACHE_MAX = 300;
const FETCH_TIMEOUT_MS = 8000;

export const isVideoId = (value) => typeof value === 'string' && VIDEO_ID_RE.test(value);

export const thumbnailFor = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

// รับได้ทั้ง id ล้วน, youtube.com/watch?v=, music.youtube.com/watch?v=, youtu.be/, /shorts/, /embed/
export function parseVideoId(input) {
  const text = String(input ?? '').trim();
  if (isVideoId(text)) return text;
  let url;
  try {
    url = new URL(text.startsWith('http') ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return isVideoId(id) ? id : null;
  }
  if (!YT_HOSTS.has(host)) return null;
  const v = url.searchParams.get('v');
  if (isVideoId(v)) return v;
  const match = url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Data API ส่ง title มาแบบ HTML-escaped (เช่น &#39;) ต้องถอดก่อนส่งให้หน้าเว็บ
function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`YouTube ตอบกลับ ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function resolveLink(input) {
  const videoId = parseVideoId(input);
  if (!videoId) return null;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const data = await fetchJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}`);
  return {
    videoId,
    title: String(data.title ?? videoId),
    channel: String(data.author_name ?? ''),
    thumb: thumbnailFor(videoId),
  };
}

// cache ผลค้นในหน่วยความจำ — คำค้นซ้ำไม่กินโควต้า
const searchCache = new Map();

function readCache(key, now) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (now - hit.at > SEARCH_CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return hit.results;
}

function writeCache(key, results, now) {
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, { at: now, results });
}

// ---------- ต่อเพลงแนวเดียวกัน ----------
// YouTube ปิด relatedToVideoId ไปแล้ว (2023) จึงเดาจากชื่อศิลปินของเพลงล่าสุดแทน
const SUGGEST_COUNT = 3;
const SONG_MIN_SEC = 60;
const SONG_MAX_SEC = 10 * 60; // ยาวกว่านี้มักเป็นคลิปรวมเพลง/LONGPLAY

// "PT3M45S" → 225
export function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso ?? ''));
  if (!m) return 0;
  const [, h = 0, min = 0, s = 0] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s);
}

const TOPIC_RE = /\s*-\s*Topic$/i;
const BRACKETS_RE = /[(\[【「《][^)\]】」》]*[)\]】」》]/g;
const NOISE_RE = /\b(official|music|video|mv|lyrics?|audio|live|4k|remaster(ed)?|hd)\b/gi;

// ตัดวงเล็บ/คำประกอบออก: "ปลายทาง (ร้องสด) - Bodyslam【Official MV】" → "ปลายทาง - Bodyslam"
export function cleanTitle(title) {
  return String(title ?? '')
    .replace(BRACKETS_RE, ' ')
    .replace(NOISE_RE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|]+|[\s\-–|]+$/g, '')
    .trim();
}

// ใช้อะไรค้นต่อ:
//  - ช่อง "<ศิลปิน> - Topic" = ช่องศิลปินจริงของ YouTube Music → เชื่อชื่อช่อง
//  - ช่องอื่น (คนอัปโหลด/ค่าย) ชื่อช่องมักไม่ใช่ศิลปิน → ใช้ชื่อเพลงที่ล้างแล้ว (มักมีชื่อศิลปินอยู่)
export function seedQuery(item) {
  const channel = String(item.channel ?? '');
  if (TOPIC_RE.test(channel)) return channel.replace(TOPIC_RE, '').trim();
  return cleanTitle(item.title) || channel;
}

// ชื่อเพลงหลัก (ส่วนแรกก่อน " - ") ไว้กันเลือกเพลงเดิมเวอร์ชันอื่น/คนอื่น cover
const songCore = (title) => cleanTitle(title).split(/\s[-–|]\s/)[0].toLowerCase();

async function durationsOf(videoIds, apiKey) {
  const params = new URLSearchParams({ part: 'contentDetails', id: videoIds.join(','), key: apiKey });
  const data = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  return new Map((data.items ?? []).map((v) => [v.id, parseIsoDuration(v.contentDetails?.duration)]));
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// คืนเพลงที่ยังไม่เคยอยู่ในคิว ความยาวแบบเพลงปกติ สุ่มลำดับ
export async function suggest(seedItem, excludeVideoIds, apiKey) {
  const seedCore = songCore(seedItem.title);
  const fresh = (await search(seedQuery(seedItem), apiKey)).filter(
    (r) => !excludeVideoIds.has(r.videoId) && !(seedCore.length >= 2 && songCore(r.title) === seedCore),
  );
  if (fresh.length === 0) return [];
  const durations = await durationsOf(fresh.map((r) => r.videoId), apiKey);
  const songs = fresh.filter((r) => {
    const sec = durations.get(r.videoId) ?? 0;
    return sec >= SONG_MIN_SEC && sec <= SONG_MAX_SEC;
  });
  return shuffle(songs).slice(0, SUGGEST_COUNT);
}

export async function search(query, apiKey) {
  const key = query.trim().toLowerCase();
  const cached = readCache(key, Date.now());
  if (cached) return cached;

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoCategoryId: '10', // หมวด Music
    videoEmbeddable: 'true', // เอาเฉพาะเพลงที่ยอมให้ฝังในเว็บอื่น
    maxResults: '12',
    q: query,
    key: apiKey,
  });
  const data = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${params}`);
  const results = (data.items ?? [])
    .filter((item) => isVideoId(item?.id?.videoId))
    .map((item) => ({
      videoId: item.id.videoId,
      title: decodeEntities(item.snippet?.title),
      channel: decodeEntities(item.snippet?.channelTitle),
      thumb: thumbnailFor(item.id.videoId),
    }));
  writeCache(key, results, Date.now());
  return results;
}
