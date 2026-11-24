import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomState, reduce } from '../server/room.js';
import {
  artistKey,
  buildContext,
  HISTORY_MAX,
  isJunk,
  outcomeOf,
  pickSeed,
  rankCandidates,
  recordOutcome,
  scoreCandidate,
  searchQueryFor,
  skippedArtists,
} from '../server/taste.js';

const vid = (n) => `vid${n}`.padEnd(11, 'x');
const song = (n, channel = 'Bodyslam - Topic', title = `เพลง ${n}`) => ({ videoId: vid(n), title, channel });
const played = (n, channel) => ({ ...song(n, channel), outcome: 'played' });
const skipped = (n, channel) => ({ ...song(n, channel), outcome: 'skipped' });
const noRand = () => 0;

test('artistKey: ตัด " - Topic" / VEVO / Official และตัวพิมพ์เล็ก', () => {
  assert.equal(artistKey({ channel: 'Bodyslam - Topic' }), 'bodyslam');
  assert.equal(artistKey({ channel: 'EdSheeranVEVO' }), 'edsheeran');
  assert.equal(artistKey({ channel: 'Taylor Swift Official' }), 'taylor swift');
  assert.equal(artistKey({}), '');
});

test('isJunk: ทิ้ง cover/คาราโอเกะ/แปลไทย/คลิปยาว แต่ไม่ทิ้งเพลงที่ชื่อบังเอิญมีคำคล้าย', () => {
  for (const t of ['ปลายทาง Cover by แบม', 'Shape of You (Karaoke)', 'คาราโอเกะ ปลายทาง', 'เพลงนี้ แปลไทย', 'Lofi 1 hour', 'รวมเพลงฮิต 2024', 'Reaction to MV', 'สอนเล่น กีตาร์']) {
    assert.equal(isJunk(t), true, t);
  }
  for (const t of ['24 ชั่วโมง - Bodyslam', 'Loop - Artist', 'ความเชื่อ - Bodyslam (Official MV)', 'Covered in Gold']) {
    assert.equal(isJunk(t), false, t);
  }
});

test('recordOutcome: จบ/ฟังเกิน 30 วิ = played · ไม่ถึง = skipped · ไม่แก้ array เดิม · เก็บไม่เกิน HISTORY_MAX', () => {
  const h0 = [];
  const h1 = recordOutcome(h0, song(1), 10, true);
  assert.equal(h0.length, 0);
  assert.equal(h1[0].outcome, 'played');
  assert.equal(recordOutcome(h1, song(2), 45, false).at(-1).outcome, 'played');
  assert.equal(recordOutcome(h1, song(3), 12, false).at(-1).outcome, 'skipped');
  let h = [];
  for (let i = 0; i < HISTORY_MAX + 5; i += 1) h = recordOutcome(h, song(i), 0, true);
  assert.equal(h.length, HISTORY_MAX);
  assert.equal(h[0].videoId, vid(5));
});

test('skippedArtists: ข้ามมากกว่าฟังจบ = ไม่ชอบ', () => {
  const h = [skipped(1, 'A - Topic'), skipped(2, 'A - Topic'), played(3, 'A - Topic'), skipped(4, 'B - Topic'), played(5, 'B - Topic')];
  assert.deepEqual([...skippedArtists(h)], ['a']);
});

test('pickSeed: ไม่มีประวัติ → เพลงที่เล่นอยู่', () => {
  const cur = song(9, 'C - Topic');
  assert.equal(pickSeed([], cur, null, noRand), cur);
});

test('pickSeed: ไม่ใช้ศิลปินเดียวกับรอบก่อน และไม่ใช้ศิลปินที่ห้องข้ามบ่อย', () => {
  const cur = song(9, 'C - Topic');
  const h = [played(1, 'A - Topic'), skipped(2, 'B - Topic'), skipped(3, 'B - Topic'), played(4, 'D - Topic')];
  for (let i = 0; i < 20; i += 1) {
    const seed = pickSeed(h, cur, 'c', Math.random);
    assert.notEqual(artistKey(seed), 'c');
    assert.notEqual(artistKey(seed), 'b');
  }
});

test('pickSeed: มีแต่ศิลปินเดิมให้เลือก → ยอมใช้ซ้ำดีกว่าไม่มี', () => {
  const cur = song(9, 'C - Topic');
  assert.equal(artistKey(pickSeed([played(1, 'C - Topic')], cur, 'c', noRand)), 'c');
});

const ctxOf = (over = {}) => {
  const ctx = { seen: [], excludeVideoIds: new Set(), excludeCores: new Set(), disliked: new Set(), seedArtist: 'bodyslam', ...over };
  return { ...ctx, extraCores: [...ctx.excludeCores] };
};

test('scoreCandidate: ช่อง Topic + ศิลปินตั้งต้นได้คะแนนมากสุด · คลิปเนื้อเพลงคนอัป/รีมิกซ์โดนหัก · ศิลปินที่ไม่ชอบไม่เอาเลย', () => {
  const ctx = ctxOf({ disliked: new Set(['bad']) });
  assert.equal(scoreCandidate(song(1, 'Bodyslam - Topic', 'แสงสุดท้าย'), ctx), 5);
  assert.equal(scoreCandidate(song(2, 'ใครก็ได้', 'แสงสุดท้าย - Bodyslam (Lyrics)'), ctx), -1);
  assert.equal(scoreCandidate(song(3, 'ใครก็ได้', 'แสงสุดท้าย Remix'), ctx), -1);
  assert.equal(scoreCandidate(song(4, 'Bad - Topic', 'เพลง'), ctx), null);
});

test('rankCandidates: เพลงที่ถูกกันเพราะศิลปินเต็ม ไม่เอาคลิปเนื้อเพลงของแฟนมาแทนต้นฉบับ', () => {
  const cands = [
    song(1, 'A - Topic', 'หนึ่ง'),
    song(2, 'A - Topic', 'สอง'),
    song(3, 'A - Topic', 'สาม'),
    song(4, 'Fan', 'สาม - A (Lyrics)'),
  ];
  const picked = rankCandidates(cands, ctxOf({ seedArtist: 'a' }), 3, noRand);
  assert.deepEqual(picked.map((p) => p.videoId), [vid(1), vid(2), vid(3)]);
});

test('rankCandidates: ผลค้นมีแต่ศิลปินเดียว → ยอมเกิน 2 เพลงให้ครบ (ไม่เอาศิลปินที่ห้องไม่ชอบมาเติมแทน)', () => {
  const cands = [song(1, 'A - Topic', 'หนึ่ง'), song(2, 'A - Topic', 'สอง'), song(3, 'A - Topic', 'สาม'), song(4, 'Bad - Topic', 'สี่')];
  const picked = rankCandidates(cands, ctxOf({ disliked: new Set(['bad']) }), 3, noRand);
  assert.deepEqual(picked.map((p) => p.videoId), [vid(1), vid(2), vid(3)]);
});

test('scoreCandidate: ทิ้งเพลงที่เคยเล่น (id หรือชื่อเพลงเดียวกันคนละเวอร์ชัน) และของปลอม', () => {
  const ctx = ctxOf({ excludeVideoIds: new Set([vid(1)]), excludeCores: new Set(['ปลายทาง']) });
  assert.equal(scoreCandidate(song(1), ctx), null);
  assert.equal(scoreCandidate(song(2, 'X', 'ปลายทาง (Live)'), ctx), null);
  assert.equal(scoreCandidate(song(3, 'X', 'ความเชื่อ Cover by เอ'), ctx), null);
});

test('rankCandidates: เลือกตามคะแนน ศิลปินละไม่เกิน 2 เพลง ชื่อเพลงซ้ำเอาตัวเดียว', () => {
  const cands = [
    song(1, 'Bodyslam - Topic', 'หนึ่ง'),
    song(2, 'Bodyslam - Topic', 'สอง'),
    song(3, 'Bodyslam - Topic', 'สาม'),
    song(4, 'Other - Topic', 'สี่'),
    song(5, 'Fan', 'หนึ่ง - Bodyslam (Lyrics)'),
    song(6, 'Fan', 'ปลอม Karaoke'),
  ];
  const picked = rankCandidates(cands, ctxOf(), 3, noRand);
  assert.deepEqual(picked.map((p) => p.videoId), [vid(1), vid(2), vid(4)]);
});

test('buildContext: กันเพลงทั้งในคิวและที่เคยเล่น', () => {
  const ctx = buildContext([played(1)], [{ ...song(2), title: 'ปลายทาง - Bodyslam' }], song(3, 'X - Topic'));
  assert.ok(ctx.excludeVideoIds.has(vid(1)) && ctx.excludeVideoIds.has(vid(2)));
  assert.ok(ctx.excludeCores.has('ปลายทาง'));
  assert.equal(ctx.seedArtist, 'x');
});

// ---------- outcomeOf: ผูกกับ reducer จริง ----------
const item = (id) => ({ id, videoId: vid(id), title: `เพลง ${id}`, channel: 'A - Topic', thumb: '', addedBy: 'Man' });
function roomWith(n, now) {
  let s = createRoomState(now);
  for (let i = 1; i <= n; i += 1) s = reduce(s, { type: 'add', item: item(String(i)) }, now);
  return s;
}
const T0 = 1_000_000;

test('outcomeOf: กดข้ามหลังเล่น 10 วิ = ข้าม · จบเพลง = ended', () => {
  const s = roomWith(3, T0);
  const skip = reduce(s, { type: 'next' }, T0 + 10_000);
  const out = outcomeOf(s, skip, { type: 'next' }, T0 + 10_000);
  assert.equal(out.item.id, '1');
  assert.equal(Math.round(out.playedSec), 10);
  assert.equal(out.ended, false);
  const end = { type: 'ended', id: '1' };
  assert.equal(outcomeOf(s, reduce(s, end, T0 + 200_000), end, T0 + 200_000).ended, true);
});

test('outcomeOf: ไม่บันทึก กดย้อน / pause / ลบเพลงอื่น / โหมด host', () => {
  const s = roomWith(3, T0);
  for (const action of [{ type: 'prev' }, { type: 'pause' }, { type: 'remove', id: '2' }]) {
    assert.equal(outcomeOf(s, reduce(s, action, T0 + 5000), action, T0 + 5000), null, action.type);
  }
  const hosted = { ...s, host: { socketId: 'x', name: 'h' } };
  assert.equal(outcomeOf(hosted, { ...hosted, currentId: '2' }, { type: 'next' }, T0), null);
});

// ---------- เพลงเดียวกันคนละคลิป (bug 11-24: โหมดแนวเดียวกันได้เพลงเดิมซ้ำ) ----------
const yt = (id, title, channel) => ({ videoId: vid(id), title, channel });

test('rankCandidates: เพลงฝรั่ง "ศิลปิน - เพลง" → ไม่เอาเพลงเดิมคนละคลิป แต่ยังเอาเพลงอื่นของศิลปินเดียวกัน', () => {
  const seed = yt('s1', 'Ed Sheeran - Perfect (Official Music Video)', 'Ed Sheeran');
  const cands = [
    yt('a', 'Perfect - Ed Sheeran (Lyrics)', 'Fan'),
    yt('b', 'Ed Sheeran - Perfect [Live]', 'Ed Sheeran'),
    yt('c', 'Perfect', 'Ed Sheeran - Topic'),
    yt('d', 'Ed Sheeran - Shape of You', 'Ed Sheeran'),
  ];
  const picked = rankCandidates(cands, buildContext([], [seed], seed), 3, noRand);
  assert.deepEqual(picked.map((p) => p.title), ['Ed Sheeran - Shape of You']);
});

test('rankCandidates: เพลงไทย "เพลง - ศิลปิน" → คลิปที่สลับเป็น "ศิลปิน - เพลง" ก็ถือเป็นเพลงเดิม', () => {
  const seed = yt('s2', 'ปลายทาง - Bodyslam【Official MV】', 'GMMGrammy Official');
  const cands = [
    yt('e', 'Bodyslam - ปลายทาง (Lyrics)', 'Fan'),
    yt('f', 'ปลายทาง (ร้องสด) - Bodyslam', 'GMM'),
    yt('g', 'ปลายทาง', 'Bodyslam - Topic'),
    yt('h', 'ความเชื่อ - Bodyslam', 'GMM'),
  ];
  const picked = rankCandidates(cands, buildContext([], [seed], seed), 3, noRand);
  assert.deepEqual(picked.map((p) => p.title), ['ความเชื่อ - Bodyslam']);
});

test('searchQueryFor: รู้ชื่อศิลปิน → ค้นด้วยชื่อศิลปิน (ไม่ใช่ชื่อเพลงซึ่งได้แต่เพลงเดิม) · ไม่รู้ → ชื่อเพลงเต็ม', () => {
  assert.equal(searchQueryFor(yt('1', 'Ed Sheeran - Perfect (Official Music Video)', 'Ed Sheeran'), new Set()), 'Ed Sheeran');
  assert.equal(searchQueryFor(yt('2', 'ปลายทาง', 'Bodyslam - Topic'), new Set()), 'Bodyslam');
  assert.equal(searchQueryFor(yt('3', 'ปลายทาง - Bodyslam【Official MV】', 'GMM'), new Set(['bodyslam'])), 'Bodyslam');
  assert.equal(searchQueryFor(yt('4', 'ปลายทาง - Bodyslam【Official MV】', 'GMM'), new Set()), 'ปลายทาง - Bodyslam');
});

// bug 11-24 (2): ศิลปินหลายคนในท่อนเดียว "PUN, THE TOYS" แต่ช่องชื่อ "PUN" · แต่ละคลิปเขียนชื่อศิลปินต่างกัน (", " / " x ")
test('rankCandidates: ศิลปินร่วม (PUN, THE TOYS / PUN x THE TOYS) → ไม่เอาเพลงเดิมคนละคลิป · ค้นด้วยชื่อช่อง', () => {
  const seed = yt('s3', 'PUN, THE TOYS - เขียว เหลือง แดง (Get high)', 'PUN');
  const cands = [
    yt('a', 'เขียว เหลือง แดง (Get high) - PUN x THE TOYS [Official MV]', 'PUN'),
    yt('b', 'PUN, THE TOYS - เขียว เหลือง แดง (Get high) [Lyric Video]', 'Fan'),
    yt('c', 'เขียว เหลือง แดง (Get high)', 'PUN - Topic'),
    yt('d', 'PUN - ถ้าเธอ (Official MV)', 'PUN'),
    yt('e', 'THE TOYS - ก่อนฤดูฝน', 'THE TOYS'),
  ];
  const ctx = buildContext([], [seed], seed);
  assert.equal(searchQueryFor(seed, ctx.artists), 'PUN');
  const picked = rankCandidates(cands, ctx, 3, noRand);
  assert.deepEqual(picked.map((p) => p.title).sort(), ['PUN - ถ้าเธอ (Official MV)', 'THE TOYS - ก่อนฤดูฝน']);
});
