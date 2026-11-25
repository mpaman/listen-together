import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLines, isMostlyThai, parseGtx, translateLines } from '../server/translate.js';

test('isMostlyThai: เพลงไทยไม่ต้องแปล · อังกฤษ/เกาหลี/ไทยปนคำอังกฤษนิดหน่อยแยกได้', () => {
  assert.equal(isMostlyThai(['ปลายทางที่ฉันรอเธอ', 'ไปดีเถอะนะ baby']), true);
  assert.equal(isMostlyThai(['I found a love for me']), false);
  assert.equal(isMostlyThai(['사랑해 너를']), false);
  assert.equal(isMostlyThai(['...', '123']), false);
});

test('chunkLines: แบ่งก้อนไม่เกินขนาด ไม่ตัดกลางบรรทัด', () => {
  assert.deepEqual(chunkLines(['aaaa', 'bbbb', 'cc'], 10), [['aaaa', 'bbbb'], ['cc']]);
  assert.deepEqual(chunkLines([], 10), []);
});

test('parseGtx: ต่อท่อนแล้วแยกบรรทัด · จำนวนบรรทัดไม่ตรง → null', () => {
  const data = [[['ฉันรัก\n', 'I love\n'], ['เธอ', 'you']], null, 'en'];
  assert.deepEqual(parseGtx(data, 2), { lang: 'en', lines: ['ฉันรัก', 'เธอ'] });
  assert.equal(parseGtx(data, 3), null);
  assert.equal(parseGtx({}, 1), null);
});

// gtx ปลอม: แปลทีละบรรทัดเป็น "TH:<ต้นฉบับ>" · จดว่าถูกส่งอะไรไปบ้าง
function fakeGtx(calls, lang = 'en') {
  return async (url, opts) => {
    const q = opts.body.get('q');
    calls.push({ url: new URL(url), q, ua: opts.headers['User-Agent'] });
    const text = q.split('\n').map((l) => `TH:${l}`).join('\n');
    return { ok: true, json: async () => [[[text, q]], null, lang] };
  };
}

test('translateLines: ท่อนซ้ำส่งไปแปลครั้งเดียว · คืนครบทุกบรรทัด (ช่วงดนตรีได้ "") · cache', async () => {
  const calls = [];
  const texts = ['I love you', '', 'Baby', 'I love you'];
  const got = await translateLines('k1', texts, fakeGtx(calls));
  assert.deepEqual(got, { lang: 'en', lines: ['TH:I love you', '', 'TH:Baby', 'TH:I love you'] });
  assert.equal(calls[0].q, 'I love you\nBaby');
  assert.equal(calls[0].url.searchParams.get('tl'), 'th');
  assert.match(calls[0].ua, /listen-together/);
  await translateLines('k1', texts, fakeGtx(calls));
  assert.equal(calls.length, 1);
});

test('translateLines: เพลงไทย → null ไม่ยิง · gtx ตรวจเจอว่าไทย → null', async () => {
  const calls = [];
  assert.equal(await translateLines('k2', ['ปลายทางที่ฉันรอเธอ'], fakeGtx(calls)), null);
  assert.equal(calls.length, 0);
  assert.equal(await translateLines('k3', ['plaithang thi chan ro thoe'], fakeGtx(calls, 'th')), null);
});

test('translateLines: บริการแปลพัง → โยน error ไม่ cache (ลองใหม่ได้)', async () => {
  await assert.rejects(translateLines('k4', ['hello'], async () => ({ ok: false, status: 429 })), /429/);
  const calls = [];
  assert.equal((await translateLines('k4', ['hello'], fakeGtx(calls))).lines[0], 'TH:hello');
});
