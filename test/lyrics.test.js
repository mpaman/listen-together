import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLyrics, lyricsQuery, parseLrc, pickLyrics } from '../server/lyrics.js';

const LRC = '[ar:Bodyslam]\n[00:14.60] บรรทัดแรก\n[00:20.00]\n[01:02.5][00:30.25] ท่อนซ้ำ';

test('parseLrc: อ่านเวลา เรียงตามเวลา ข้าม metadata · บรรทัดเดียวหลายเวลาแตกเป็นหลายบรรทัด', () => {
  assert.deepEqual(parseLrc(LRC), [
    { t: 14.6, text: 'บรรทัดแรก' },
    { t: 20, text: '' },
    { t: 30.25, text: 'ท่อนซ้ำ' },
    { t: 62.5, text: 'ท่อนซ้ำ' },
  ]);
});

test('parseLrc: ค่าว่าง/ไม่ใช่ LRC → []', () => {
  assert.deepEqual(parseLrc(null), []);
  assert.deepEqual(parseLrc('ไม่มีเวลาเลย'), []);
});

test('lyricsQuery: ช่อง Topic ต่อชื่อศิลปิน · ช่องอื่นใช้ชื่อเพลงที่ล้างแล้ว', () => {
  assert.equal(lyricsQuery('ปลายทาง', 'Bodyslam - Topic'), 'ปลายทาง Bodyslam');
  assert.equal(lyricsQuery('ปลายทาง - Bodyslam【Official MV】', 'GMMTV Records'), 'ปลายทาง - Bodyslam');
});

const row = (over) => ({ trackName: 'ปลายทาง', artistName: 'Bodyslam', duration: 251, instrumental: false, plainLyrics: 'เนื้อ', syncedLyrics: '[00:01.00] a', ...over });

test('pickLyrics: เลือกแบบซิงค์ที่ความยาวใกล้ที่สุด', () => {
  const picked = pickLyrics([row({ duration: 305, syncedLyrics: '[00:01.00] ไกล' }), row({ duration: 252, syncedLyrics: '[00:02.00] ใกล้' })], 250);
  assert.deepEqual(picked.synced, [{ t: 2, text: 'ใกล้' }]);
  assert.equal(picked.plain, null);
});

test('pickLyrics: แบบซิงค์ความยาวต่างเกิน → ถอยไปเนื้อธรรมดา · instrumental ไม่นับ', () => {
  const picked = pickLyrics([row({ duration: 400 }), row({ instrumental: true })], 250);
  assert.equal(picked.synced, null);
  assert.equal(picked.plain, 'เนื้อ');
});

test('pickLyrics: ไม่ทราบความยาว (0) → ยอมรับทุกผล · ไม่มีอะไรเลย → null', () => {
  assert.ok(pickLyrics([row({ duration: 999 })], 0).synced);
  assert.equal(pickLyrics([], 250), null);
  assert.equal(pickLyrics('ไม่ใช่ array', 250), null);
});

const okFetch = (body, calls) => async (url, opts) => {
  calls.push({ url, opts });
  return { ok: true, json: async () => body };
};

test('findLyrics: ส่ง User-Agent + cache ผล (ขอซ้ำไม่ยิงใหม่ ทั้งเจอและไม่เจอ)', async () => {
  const calls = [];
  const song = { videoId: 'aaaaaaaaaa1', title: 'ปลายทาง', channel: 'Bodyslam - Topic', duration: 251 };
  const first = await findLyrics(song, okFetch([row()], calls));
  const again = await findLyrics({ ...song, duration: 252 }, okFetch([], calls));
  assert.equal(calls.length, 1);
  assert.deepEqual(first, again);
  assert.match(calls[0].opts.headers['User-Agent'], /listen-together/);
  assert.match(decodeURIComponent(calls[0].url), /q=ปลายทาง\+Bodyslam|q=ปลายทาง Bodyslam/);

  const missing = { ...song, videoId: 'bbbbbbbbbb2' };
  assert.equal(await findLyrics(missing, okFetch([], calls)), null);
  assert.equal(await findLyrics(missing, okFetch([row()], calls)), null);
  assert.equal(calls.length, 2);
});

test('findLyrics: LRCLIB ล่ม → โยน error และไม่ cache', async () => {
  const song = { videoId: 'cccccccccc3', title: 'เพลง', channel: '', duration: 200 };
  await assert.rejects(findLyrics(song, async () => ({ ok: false, status: 503 })), /503/);
  const calls = [];
  await findLyrics(song, okFetch([row()], calls));
  assert.equal(calls.length, 1);
});

test('findLyrics: ชื่อเพลงล้างแล้วว่าง → null โดยไม่ยิง', async () => {
  const calls = [];
  assert.equal(await findLyrics({ videoId: 'dddddddddd4', title: '(Official MV)', channel: '', duration: 0 }, okFetch([], calls)), null);
  assert.equal(calls.length, 0);
});
