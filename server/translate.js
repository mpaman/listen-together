// แปลเนื้อเพลงต่างประเทศ (เกาหลี/อังกฤษ/ญี่ปุ่น ฯลฯ) เป็นไทย ผ่าน Google Translate แบบไม่ใช้ key (client=gtx)
// ⚠️ endpoint นี้ไม่เป็นทางการ (Man เลือก 2026-11-26 เพราะฟรี ไม่ต้องสมัคร) — วันไหนโดนจำกัด/ปิด
//    แค่ไม่มีคำแปล เนื้อเพลงต้นฉบับยังขึ้นปกติ · ถ้าจะเปลี่ยนเจ้า แก้แค่ requestChunk
// ส่งเฉพาะข้อความเนื้อเพลง ไม่มีข้อมูลคนในห้อง
const GTX_URL = 'https://translate.googleapis.com/translate_a/single';
const USER_AGENT = 'listen-together/0.1 (personal project)';
const FETCH_TIMEOUT_MS = 8000;
// ยาวเกินนี้แบ่งส่งหลายรอบ (เนื้อเพลงทั่วไปรอบเดียวจบ) · เพลงยาวผิดปกติก็ไม่แปลเกิน MAX_CHUNKS รอบ
const CHUNK_CHARS = 4000;
const MAX_CHUNKS = 3;
const CACHE_MAX = 300;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// ตัวอักษรไทยเกินสัดส่วนนี้ = เพลงไทยอยู่แล้ว → ไม่ต้องยิงไปแปล
const THAI_RATIO = 0.3;
const THAI_RE = /[฀-๿]/g;
const LETTER_RE = /\p{L}/gu;

export function isMostlyThai(texts) {
  const all = texts.join('');
  const letters = all.match(LETTER_RE)?.length ?? 0;
  if (letters === 0) return false;
  return (all.match(THAI_RE)?.length ?? 0) / letters >= THAI_RATIO;
}

// ข้อความไม่ซ้ำ (ท่อนฮุคซ้ำแปลครั้งเดียว) แบ่งเป็นก้อน ก้อนละไม่เกิน CHUNK_CHARS
export function chunkLines(texts, limit = CHUNK_CHARS) {
  const chunks = [];
  let cur = [];
  let size = 0;
  for (const text of texts) {
    if (cur.length && size + text.length + 1 > limit) {
      chunks.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(text);
    size += text.length + 1;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// คำตอบของ gtx: [[["คำแปล","ต้นฉบับ",...], ...], null, "ภาษาที่ตรวจเจอ", ...]
// ต่อทุกท่อนแล้วแยกตามบรรทัด · จำนวนบรรทัดไม่ตรง = จับคู่ไม่ได้ → null ดีกว่าโชว์คำแปลผิดบรรทัด
export function parseGtx(data, expected) {
  if (!Array.isArray(data?.[0])) return null;
  const out = data[0].map((seg) => (Array.isArray(seg) ? String(seg[0] ?? '') : '')).join('').split('\n');
  if (out.length !== expected) return null;
  return { lang: typeof data[2] === 'string' ? data[2] : '', lines: out.map((s) => s.trim()) };
}

async function requestChunk(lines, fetchImpl) {
  const url = `${GTX_URL}?${new URLSearchParams({ client: 'gtx', sl: 'auto', tl: 'th', dt: 't' })}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    body: new URLSearchParams({ q: lines.join('\n') }),
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`แปลภาษาตอบกลับ ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return parseGtx(await res.json(), lines.length);
}

const cache = new Map(); // key → { at, value }

// texts = ข้อความทีละบรรทัด (บรรทัดว่าง = ช่วงดนตรี) → { lang, lines } ยาวเท่า texts (บรรทัดว่างได้ '')
// คืน null เมื่อ: เพลงไทยอยู่แล้ว / ไม่มีอะไรให้แปล / จับคู่บรรทัดไม่ได้ · พังชั่วคราว = โยน error ไม่ cache
export async function translateLines(key, texts, fetchImpl = fetch, now = Date.now()) {
  const hit = cache.get(key);
  if (hit && now - hit.at <= CACHE_TTL_MS) return hit.value;

  const unique = [...new Set(texts.map((t) => String(t ?? '').trim()).filter(Boolean))];
  let value = null;
  if (unique.length && !isMostlyThai(unique)) {
    const map = new Map();
    let lang = '';
    let ok = true;
    for (const chunk of chunkLines(unique).slice(0, MAX_CHUNKS)) {
      const got = await requestChunk(chunk, fetchImpl);
      if (!got) {
        ok = false;
        break;
      }
      lang ||= got.lang;
      chunk.forEach((src, i) => map.set(src, got.lines[i]));
    }
    // gtx ตรวจได้ว่าเป็นไทย (เช่นเพลงไทยที่เขียนคาราโอเกะ) → ไม่โชว์คำแปลซ้ำกับต้นฉบับ
    if (ok && lang !== 'th') value = { lang, lines: texts.map((t) => map.get(String(t ?? '').trim()) ?? '') };
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, value });
  return value;
}
