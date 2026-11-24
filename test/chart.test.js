import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTopChart, mapChartItems } from '../server/youtube.js';
import { isJunk } from '../server/taste.js';

const vid = (s) => s.padEnd(11, 'x');
const video = (id, title, { duration = 'PT3M30S', embeddable = true, channel = 'PUN' } = {}) => ({
  id: vid(id),
  snippet: { title, channelTitle: channel },
  contentDetails: { duration },
  status: { embeddable },
});

test('mapChartItems: ตัดคลิปที่ฝังไม่ได้ / สั้นหรือยาวผิดปกติ / คาราโอเกะ · ถอด HTML entity', () => {
  const out = mapChartItems(
    [
      video('a', 'เขียว เหลือง แดง (Get high)'),
      video('b', 'ห้ามฝัง', { embeddable: false }),
      video('c', 'teaser', { duration: 'PT30S' }),
      video('d', 'รวมเพลงฮิต', { duration: 'PT1H2M' }),
      video('e', 'ปลายทาง คาราโอเกะ'),
      video('f', 'Don&#39;t Stop'),
      { id: 'bad', snippet: { title: 'x' }, contentDetails: { duration: 'PT3M' } },
    ],
    isJunk,
  );
  assert.deepEqual(out.map((s) => s.title), ['เขียว เหลือง แดง (Get high)', "Don't Stop"]);
  assert.equal(out[0].thumb, `https://i.ytimg.com/vi/${vid('a')}/mqdefault.jpg`);
});

// แทน fetch ทั้งไฟล์ (youtube.js เรียก fetch ตรง) · คืนค่าเดิมทุกครั้งหลัง test
function withFetch(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}
const ok = (items) => ({ ok: true, status: 200, json: async () => ({ items }) });

test('fetchTopChart: ขอ mostPopular หมวดเพลงของประเทศนั้น 50 คลิป · cache ไว้ ไม่ยิงซ้ำ', async () => {
  const urls = [];
  await withFetch(
    async (url) => {
      urls.push(new URL(url));
      return ok([video('a', 'เพลงหนึ่ง')]);
    },
    async () => {
      const first = await fetchTopChart('KR', 'k', { now: 1000 });
      const again = await fetchTopChart('KR', 'k', { now: 2000 });
      assert.equal(first.items.length, 1);
      assert.equal(again.updatedAt, 1000);
    },
  );
  assert.equal(urls.length, 1);
  const p = urls[0].searchParams;
  assert.equal(p.get('chart'), 'mostPopular');
  assert.equal(p.get('videoCategoryId'), '10');
  assert.equal(p.get('regionCode'), 'KR');
  assert.equal(p.get('maxResults'), '50');
});

test('fetchTopChart: หมดอายุแล้วดึงใหม่ · ดึงพังแต่มีของเก่า → ส่งของเก่า · ไม่มีของเก่า → โยน error', async () => {
  let fail = false;
  await withFetch(
    async () => (fail ? { ok: false, status: 500, json: async () => ({}) } : ok([video('z', 'เพลงเก่า')])),
    async () => {
      await fetchTopChart('US', 'k', { now: 0 });
      fail = true;
      const stale = await fetchTopChart('US', 'k', { now: 4 * 60 * 60 * 1000 });
      assert.equal(stale.items[0].title, 'เพลงเก่า');
      assert.equal(stale.updatedAt, 0);
      await assert.rejects(fetchTopChart('TH', 'k', { now: 0 }), /500/);
    },
  );
});
