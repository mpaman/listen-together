// "รสนิยมของห้อง" สำหรับโหมดต่อเพลงแนวเดียวกัน — pure function ทั้งหมด (test ได้ ไม่ยิงเน็ต)
//
// ปัญหาเดิม: ค้นจากเพลงล่าสุดเพลงเดียว แล้วสุ่ม → ได้ศิลปินเดิมวน, ได้ cover/คาราโอเกะ, เพลงที่เล่นไปแล้วกลับมาซ้ำ
// แนวทางใหม่ (ยังค้น YouTube 1 ครั้งต่อการเติม เท่าเดิม):
//   1) จำประวัติห้อง: เพลงไหนฟังจนจบ (ชอบ) / ถูกข้ามเร็ว (ไม่ชอบ)
//   2) เลือกเพลงตั้งต้นจากเพลงที่ห้องชอบหลายเพลง สลับศิลปินกันไป ไม่ยึดเพลงล่าสุดเพลงเดียว
//   3) กรองของปลอมทิ้ง แล้วให้คะแนนผลค้น (ช่องศิลปินจริงได้ก่อน ศิลปินที่ห้องข้ามบ่อยโดนหัก)
import { positionAt } from './room.js';
import { cleanTitle } from './youtube.js';

export const HISTORY_MAX = 60;
export const SKIP_UNDER_SEC = 30; // ฟังไม่ถึงนี้แล้วกดข้าม = ไม่ชอบ
const SEED_POOL = 6; // เลือกเพลงตั้งต้นจากศิลปินที่ห้องชอบล่าสุดกี่คน
const MAX_PER_ARTIST = 2; // ในชุดที่เติมแต่ละครั้ง ศิลปินเดียวกันไม่เกินนี้
const JITTER = 1.5; // สุ่มบวกคะแนนเล็กน้อย → เติมแต่ละครั้งไม่ได้ลำดับเดิมเป๊ะ

const TOPIC_RE = /\s*-\s*Topic$/i;
const CHANNEL_NOISE_RE = /\s*(vevo|official|channel|music)\s*$/i;

// ของปลอมที่ไม่ใช่เพลงต้นฉบับ → ทิ้งเลย
// คำอังกฤษใช้ \b · คำไทยไม่มีช่องว่างคั่นคำ เลยจับเป็นคำตรงๆ
// ไม่ใส่คำที่เป็นชื่อเพลงจริงได้บ่อย เช่น loop / react / "ชั่วโมง" เดี่ยวๆ (เพลง "24 ชั่วโมง" มีจริง)
const JUNK_EN_RE = /\b(cover(ed)? by|covers?|karaoke|reaction|instrumental|nightcore|8d audio|sped ?up|slowed|\d+ ?hours?|tutorial|lesson|chords|guitar tab|shorts)\b/i;
const JUNK_TH_RE = /คาราโอเกะ|คัฟเวอร์|โคฟเวอร์|แปลไทย|ซับไทย|สอนเล่น|คอร์ดเพลง|คอร์ดกีตาร์|ฟังยาว|ฟังต่อเนื่อง|รวมเพลง|[1-9]\s*ชั่วโมงเต็ม/;
// คลิปเนื้อเพลงที่คนทั่วไปอัปโหลด / รีมิกซ์ → ยังใช้ได้ แต่ให้ช่องศิลปินจริงมาก่อน
const LYRIC_RE = /\b(lyrics?|lyric video)\b|เนื้อเพลง/i;
const REMIX_RE = /\b(remix|mashup|edit|version)\b|รีมิกซ์/i;
const OFFICIAL_RE = /\bofficial\b|ออฟฟิเชียล/i;

// ชื่อเพลงหลัก (ส่วนแรกก่อน " - ") — กันได้เพลงเดิมเวอร์ชันอื่น
export const songCore = (title) => cleanTitle(title).split(/\s[-–|]\s/)[0].toLowerCase();

// ตัวแทนศิลปิน = ชื่อช่อง (ตัด " - Topic" / VEVO / Official ออก) · เดาจากชื่อเพลงไม่ได้ เพราะไทยกับอังกฤษวางชื่อศิลปินคนละฝั่ง
export function artistKey(item) {
  return String(item?.channel ?? '')
    .replace(TOPIC_RE, '')
    .replace(CHANNEL_NOISE_RE, '')
    .trim()
    .toLowerCase();
}

export const isJunk = (title) => JUNK_EN_RE.test(title) || JUNK_TH_RE.test(title);

// บันทึกผลของเพลงที่เพิ่งเปลี่ยนไป · คืน array ใหม่ (ไม่แก้ของเดิม) · ยาวเกิน → ทิ้งเก่าสุด
// ended = เล่นจนจบ · ไม่จบแต่ฟังเกิน SKIP_UNDER_SEC ถือว่าชอบพอใช้ · ไม่ถึง = ข้าม
export function recordOutcome(history, item, playedSec, ended) {
  if (!item?.videoId) return history;
  const outcome = ended || playedSec >= SKIP_UNDER_SEC ? 'played' : 'skipped';
  const entry = { videoId: item.videoId, title: item.title, channel: item.channel ?? '', outcome };
  return [...history, entry].slice(-HISTORY_MAX);
}

// action นี้ทำให้เพลงที่เล่นอยู่ "จบรอบ" ไหม · คืน { item, playedSec, ended } หรือ null (ไม่ต้องบันทึก)
// นับเฉพาะ: เล่นจนจบ / กดข้าม / กดเลือกเพลงอื่น / ลบเพลงที่เล่นอยู่
// ไม่นับ: กดย้อนกลับ (ไม่ได้แปลว่าไม่ชอบ) · เพลงเล่นไม่ได้ (blocked) · โหมด host (host เลือกเอง ไม่ใช่ห้อง)
const LEAVE_ACTIONS = new Set(['next', 'jump', 'remove']);
export function outcomeOf(prev, next, action, now) {
  if (prev.host || prev.currentId === null) return null;
  const item = prev.queue.find((q) => q.id === prev.currentId);
  if (!item) return null;
  if (action.type === 'ended' && action.id === prev.currentId) return { item, playedSec: positionAt(prev, now), ended: true };
  if (LEAVE_ACTIONS.has(action.type) && next.currentId !== prev.currentId) {
    return { item, playedSec: positionAt(prev, now), ended: false };
  }
  return null;
}

// ศิลปินที่ห้องข้ามมากกว่าฟังจบ
export function skippedArtists(history) {
  const score = new Map();
  for (const h of history) {
    const key = artistKey(h);
    if (!key) continue;
    score.set(key, (score.get(key) ?? 0) + (h.outcome === 'skipped' ? 1 : -1));
  }
  return new Set([...score].filter(([, n]) => n > 0).map(([key]) => key));
}

// เลือกเพลงตั้งต้นสำหรับค้น:
//  - กองตัวเลือก = เพลงที่ห้องฟังจบล่าสุด ศิลปินละ 1 เพลง (ไม่เกิน SEED_POOL คน) + เพลงที่เล่นอยู่
//  - ตัดศิลปินที่ห้องข้ามบ่อยออก · ไม่ใช้ศิลปินเดียวกับรอบที่แล้ว (สลับกันไป ไม่วนคนเดียว)
//  - ห้องยังไม่มีประวัติ → ใช้เพลงที่เล่นอยู่ (พฤติกรรมเดิม)
export function pickSeed(history, current, lastSeedArtist, rand = Math.random) {
  const disliked = skippedArtists(history);
  const pool = [];
  const seen = new Set();
  const consider = (item) => {
    const key = artistKey(item);
    if (!item?.title || seen.has(key) || disliked.has(key)) return;
    seen.add(key);
    pool.push(item);
  };
  if (current) consider(current);
  for (let i = history.length - 1; i >= 0 && pool.length < SEED_POOL; i -= 1) {
    if (history[i].outcome === 'played') consider(history[i]);
  }
  const fresh = pool.filter((item) => artistKey(item) !== lastSeedArtist);
  const choices = fresh.length ? fresh : pool;
  if (!choices.length) return current;
  // เพลงที่เล่นอยู่ได้โอกาสมากกว่า (ตรงกับอารมณ์ตอนนี้ที่สุด) ที่เหลือสุ่มเท่ากัน
  if (choices[0] === current && rand() < 0.5) return current;
  return choices[Math.floor(rand() * choices.length)];
}

// คะแนนผลค้น 1 รายการ · null = ทิ้ง
export function scoreCandidate(cand, ctx) {
  const { excludeVideoIds, excludeCores, disliked, seedArtist } = ctx;
  if (excludeVideoIds.has(cand.videoId) || isJunk(cand.title)) return null;
  const core = songCore(cand.title);
  if (core.length >= 2 && excludeCores.has(core)) return null;
  const key = artistKey(cand);
  // ศิลปินที่ห้องข้ามบ่อย → ไม่เอาเลย (แค่หักคะแนน ยังหลุดมาตอนผลค้นมีตัวเลือกน้อย)
  if (key && disliked.has(key)) return null;
  let score = 0;
  if (TOPIC_RE.test(cand.channel ?? '')) score += 3; // ช่องศิลปินของ YouTube Music = เพลงต้นฉบับแน่ๆ
  if (key && key === seedArtist) score += 2;
  if (OFFICIAL_RE.test(cand.title) || OFFICIAL_RE.test(cand.channel ?? '')) score += 1;
  if (LYRIC_RE.test(cand.title) && !TOPIC_RE.test(cand.channel ?? '')) score -= 1;
  if (REMIX_RE.test(cand.title)) score -= 1;
  return score;
}

// เรียงตามคะแนน (+สุ่มนิดหน่อย) แล้วเลือก count เพลง · ศิลปินเดียวกันไม่เกิน MAX_PER_ARTIST · ชื่อเพลงซ้ำกันเอาตัวเดียว
export function rankCandidates(cands, ctx, count, rand = Math.random) {
  const scored = [];
  for (const cand of cands) {
    const score = scoreCandidate(cand, ctx);
    if (score !== null) scored.push({ cand, rank: score + rand() * JITTER });
  }
  scored.sort((a, b) => b.rank - a.rank);
  const picked = [];
  const perArtist = new Map();
  const cores = new Set();
  // รอบแรกจำกัดศิลปินละ MAX_PER_ARTIST · ยังไม่ครบ → รอบสองไม่จำกัด (ศิลปินเดิมเพิ่มดีกว่าเติมไม่ครบ)
  // held = เพลงที่รอบแรกข้ามเพราะศิลปินเต็มโควต้า → ห้ามเอาเวอร์ชันอื่นของเพลงนั้น (เช่นคลิปเนื้อเพลงที่แฟนอัป) มาแทนต้นฉบับ
  const held = new Set();
  for (const cap of [MAX_PER_ARTIST, Infinity]) {
    for (const { cand } of scored) {
      if (picked.length >= count) return picked;
      const key = artistKey(cand);
      const core = songCore(cand.title);
      if (picked.includes(cand) || cores.has(core)) continue;
      if (cap !== Infinity && held.has(core)) continue;
      if ((perArtist.get(key) ?? 0) >= cap) {
        held.add(core);
        continue;
      }
      perArtist.set(key, (perArtist.get(key) ?? 0) + 1);
      cores.add(core);
      picked.push(cand);
    }
  }
  return picked;
}

// ของที่ห้ามแนะนำซ้ำ: ทุกเพลงในคิว + ทุกเพลงที่เคยเล่นในห้อง (ทั้ง id และชื่อเพลงหลัก)
export function buildContext(history, queue, seed) {
  const all = [...history, ...queue];
  return {
    excludeVideoIds: new Set(all.map((item) => item.videoId)),
    excludeCores: new Set(all.map((item) => songCore(item.title)).filter((core) => core.length >= 2)),
    disliked: skippedArtists(history),
    seedArtist: artistKey(seed),
  };
}
