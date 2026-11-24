import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestMatch, chooseSimilar, findSimilar, lookupsFor, parseSimilarArtists, parseSimilarTracks, parseTopTracks } from '../server/lastfm.js';

const ctxOf = (over = {}) => ({ excludeVideoIds: new Set(), excludeCores: new Set(), disliked: new Set(), seedArtist: '', ...over });

test('lookupsFor: ช่อง Topic เชื่อชื่อช่อง · "A - B" ลองทั้งสองฝั่ง · ไม่มีขีด = ไม่รู้', () => {
  assert.deepEqual(lookupsFor({ channel: 'Bodyslam - Topic', title: 'ปลายทาง' }), [{ artist: 'Bodyslam', track: 'ปลายทาง' }]);
  assert.deepEqual(lookupsFor({ channel: 'EdSheeranVEVO', title: 'Ed Sheeran - Perfect (Official Music Video)' }), [
    { artist: 'Ed Sheeran', track: 'Perfect' },
    { artist: 'Perfect', track: 'Ed Sheeran' },
  ]);
  assert.deepEqual(lookupsFor({ channel: 'ใครก็ได้', title: 'เพลงเดี่ยว' }), []);
});

test('parse*: รับได้ทั้ง array และ object เดี่ยว · ตัดรายการที่ไม่มีชื่อ', () => {
  const two = { similartracks: { track: [{ name: 'X', match: '0.5', artist: { name: 'A' } }, { name: '', artist: { name: 'B' } }] } };
  assert.deepEqual(parseSimilarTracks(two), [{ artist: 'A', track: 'X', match: 0.5 }]);
  const one = { similartracks: { track: { name: 'Y', artist: { name: 'C' } } } };
  assert.deepEqual(parseSimilarTracks(one), [{ artist: 'C', track: 'Y', match: 0 }]);
  assert.deepEqual(parseSimilarTracks({}), []);
  assert.deepEqual(parseSimilarArtists({ similarartists: { artist: [{ name: 'A', match: '1' }] } }), [{ name: 'A', match: 1 }]);
  assert.deepEqual(parseTopTracks({ toptracks: { track: [{ name: 'T' }] } }, 'A'), [{ artist: 'A', track: 'T' }]);
});

test('chooseSimilar: ศิลปินไม่ซ้ำ · ไม่เอาศิลปินตั้งต้น / ที่ห้องไม่ชอบ / เพลงที่เคยเล่น', () => {
  const list = [
    { artist: 'Seed', track: 'a', match: 1 },
    { artist: 'B', track: 'b1', match: 0.9 },
    { artist: 'B', track: 'b2', match: 0.9 },
    { artist: 'Bad', track: 'c', match: 0.9 },
    { artist: 'D', track: 'played', match: 0.9 },
    { artist: 'E', track: 'e', match: 0.1 },
  ];
  const ctx = ctxOf({ disliked: new Set(['bad']), excludeCores: new Set(['played']) });
  const picked = chooseSimilar(list, ctx, 'seed', 3, () => 0);
  assert.deepEqual(picked.map((p) => p.artist), ['B', 'E']);
});

test('bestMatch: ต้องมีทั้งชื่อเพลงและศิลปิน · เลือกคะแนนสูงสุด · ทิ้งตัวที่ scoreFn = null', () => {
  const want = { artist: 'Ed Sheeran', track: 'Perfect' };
  const results = [
    { videoId: 'a', title: 'Ed Sheeran - Shape of You', channel: 'Ed Sheeran' },
    { videoId: 'b', title: 'Perfect (Lyrics)', channel: 'Fan Lyrics' },
    { videoId: 'c', title: 'Perfect', channel: 'Ed Sheeran - Topic' },
    { videoId: 'd', title: 'Ed Sheeran - Perfect (Official Music Video)', channel: 'Ed Sheeran' },
    { videoId: 'e', title: 'Ed Sheeran - Perfect Karaoke', channel: 'Kara' },
  ];
  const score = { c: 3, d: 1, e: null };
  assert.equal(bestMatch(results, want, (r) => (r.videoId in score ? score[r.videoId] : 0)).videoId, 'c');
  assert.equal(bestMatch(results.slice(0, 2), want, () => 0), null);
});

// fetch ปลอม: ตอบตาม method · จดพารามิเตอร์ที่ถูกเรียก
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init) => {
    const params = new URL(url).searchParams;
    calls.push({ ...Object.fromEntries(params), userAgent: init?.headers?.['User-Agent'] });
    const body = handlers[params.get('method')]?.(params) ?? { error: 6, message: 'not found' };
    return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
  };
  return { impl, calls };
}
const tracks = (n) => ({
  similartracks: { track: Array.from({ length: n }, (_, i) => ({ name: `t${i}`, match: 0.5, artist: { name: `A${i}` } })) },
});

test('findSimilar: track.getSimilar พอ → ใช้เลย · ส่ง key/autocorrect และ User-Agent ทั่วไป', async () => {
  const { impl, calls } = fakeFetch({ 'track.getsimilar': () => tracks(6) });
  const out = await findSimilar({ channel: 'Uniq1 - Topic', title: 'Song1' }, 'k', impl);
  assert.equal(out.artist, 'Uniq1');
  assert.equal(out.similar.length, 6);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].api_key, 'k');
  assert.equal(calls[0].autocorrect, '1');
  assert.equal(calls[0].userAgent, 'listen-together/0.1 (personal project)');
});

test('findSimilar: เพลงไม่เจอ (error 6) → ลองสลับฝั่ง → ถอยไปศิลปินคล้าย + เพลงดัง', async () => {
  const { impl, calls } = fakeFetch({
    'artist.getsimilar': (p) =>
      p.get('artist') === 'Uniq2b' ? { similarartists: { artist: [{ name: 'S1', match: '0.8' }, { name: 'S2', match: '0.4' }] } } : { error: 6 },
    'artist.gettoptracks': (p) => ({ toptracks: { track: [{ name: `${p.get('artist')}-hit`, artist: { name: p.get('artist') } }] } }),
  });
  const out = await findSimilar({ channel: 'X', title: 'Uniq2a - Uniq2b' }, 'k', impl);
  assert.equal(out.artist, 'Uniq2b');
  assert.deepEqual(out.similar, [
    { artist: 'S1', track: 'S1-hit', match: 0.8 },
    { artist: 'S2', track: 'S2-hit', match: 0.4 },
  ]);
  assert.deepEqual(
    calls.map((c) => c.method),
    ['track.getsimilar', 'track.getsimilar', 'artist.getsimilar', 'artist.getsimilar', 'artist.gettoptracks', 'artist.gettoptracks'],
  );
});

test('findSimilar: key ผิด (error 10) → โยน error ให้ระบบถอยไปขั้น 1', async () => {
  const { impl } = fakeFetch({ 'track.getsimilar': () => ({ error: 10, message: 'Invalid API key' }) });
  await assert.rejects(findSimilar({ channel: 'Uniq3 - Topic', title: 'Song3' }, 'bad', impl), /Last.fm error 10/);
});

test('findSimilar: ถามซ้ำใช้ cache ไม่ยิงเน็ตอีก', async () => {
  const { impl, calls } = fakeFetch({ 'track.getsimilar': () => tracks(6) });
  const item = { channel: 'Uniq4 - Topic', title: 'Song4' };
  await findSimilar(item, 'k', impl);
  await findSimilar(item, 'k', impl);
  assert.equal(calls.length, 1);
});
