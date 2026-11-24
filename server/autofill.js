// เลือกเพลงมาเติมคิวตอนโหมด "แนวเดียวกัน" — รวมขั้น 1 กับขั้น 2 ไว้ที่เดียว
//   ขั้น 2 (มี LASTFM_API_KEY): ถาม Last.fm ว่าเพลงไหนคล้าย → เอาศิลปินใหม่ LASTFM_SHARE เพลง → ค้นหาคลิปใน YouTube ทีละเพลง
//   ขั้น 1 (เสมอ): ค้นจากชื่อศิลปินตั้งต้น เติมให้ครบ → ได้ทั้ง "ศิลปินใหม่ที่เข้ากัน" + "ศิลปินที่ฟังอยู่"
// Last.fm หาไม่เจอ/ล่ม/ไม่มี key → ได้ผลแบบขั้น 1 ล้วน (ไม่ทำให้การเติมเพลงพัง)
// deps ส่งเข้ามา (ไม่ import ตรง) จะได้ test ได้โดยไม่ยิงเน็ต
import { chooseSimilar, bestMatch } from './lastfm.js';
import { artistKey, buildContext, pickSeed, rankCandidates, scoreCandidate, searchQueryFor, withCandidates } from './taste.js';

export const LASTFM_SHARE = 2; // ใน 3 เพลงที่เติม เป็นศิลปินใหม่จาก Last.fm กี่เพลง
// โควตา YouTube (หน่วย): search = 100 · ถามความยาว = 1
export const UNITS_SEARCH = 100;
export const UNITS_LENGTH = 1;

export function estimateUnits(useLastfm) {
  const stage1 = UNITS_SEARCH + UNITS_LENGTH;
  return useLastfm ? stage1 + LASTFM_SHARE * UNITS_SEARCH + UNITS_LENGTH : stage1;
}

// คืน { picks, seedArtist, units, fromLastfm }
export async function pickAutofill({ seed, history, queue, lastSeedArtist, count }, deps) {
  const { search, keepSongLength, suggestCandidates, findSimilar, useLastfm, onError = () => {}, rand = Math.random } = deps;
  const base = pickSeed(history, seed, lastSeedArtist, rand);
  let ctx = buildContext(history, queue, base);
  const picks = [];
  let units = 0;
  // เพลงที่เลือกแล้วนับเป็น "เคยเห็น" → รอบถัดไปไม่เลือกเพลงเดียวกันคนละคลิปซ้ำ
  const take = (item) => {
    picks.push(item);
    ctx.excludeVideoIds.add(item.videoId);
    ctx = withCandidates({ ...ctx, seen: [...ctx.seen, item] }, []);
  };

  if (useLastfm) {
    try {
      const { artist, similar } = await findSimilar(base);
      const wanted = chooseSimilar(similar, ctx, artist, Math.min(LASTFM_SHARE, count), rand);
      const found = [];
      for (const want of wanted) {
        units += UNITS_SEARCH;
        const match = bestMatch(await search(`${want.artist} ${want.track}`), want, (r) => scoreCandidate(r, ctx));
        if (match && !ctx.excludeVideoIds.has(match.videoId)) found.push(match);
      }
      if (found.length) {
        units += UNITS_LENGTH;
        for (const item of await keepSongLength(found)) take(item);
      }
    } catch (err) {
      onError(err); // Last.fm/ค้นพัง → ไปต่อด้วยขั้น 1
    }
  }
  const fromLastfm = picks.length;

  const familiar = [];
  if (picks.length < count) {
    units += UNITS_SEARCH + UNITS_LENGTH;
    const cands = await suggestCandidates(searchQueryFor(base, ctx.artists), ctx.excludeVideoIds);
    familiar.push(...rankCandidates(cands, ctx, count - picks.length, rand));
  }
  // สลับ ใหม่-คุ้น-ใหม่ ไม่ให้ศิลปินแปลกหน้ามาติดกันหมด
  const discovered = picks.splice(0);
  while (discovered.length || familiar.length) {
    if (discovered.length) take(discovered.shift());
    if (familiar.length) take(familiar.shift());
  }
  return { picks, seedArtist: artistKey(base), units, fromLastfm };
}
