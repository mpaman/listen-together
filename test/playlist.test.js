import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomState, MAX_QUEUE, reduce } from '../server/room.js';
import { sanitizeAction } from '../server/validate.js';
import { isAutoMix, mapPlaylistItems, parsePlaylistId } from '../server/youtube.js';

const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
const vid = (n) => `video${n}`.padEnd(11, 'x');
const song = (id) => ({ id, videoId: vid(id), title: `เพลง ${id}`, channel: '', thumb: '', addedBy: 'Man' });

test('parsePlaylistId: อ่าน list= จากลิงก์ YouTube / YouTube Music / watch?v=&list=', () => {
  assert.equal(parsePlaylistId(`https://www.youtube.com/playlist?list=${LIST}`), LIST);
  assert.equal(parsePlaylistId(`https://music.youtube.com/playlist?list=${LIST}&si=abc`), LIST);
  assert.equal(parsePlaylistId(`youtube.com/watch?v=dQw4w9WgXcQ&list=${LIST}&index=2`), LIST);
});

test('parsePlaylistId: ไม่มี list / โดเมนอื่น / id แปลก → null', () => {
  assert.equal(parsePlaylistId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parsePlaylistId(`https://evil.example.com/playlist?list=${LIST}`), null);
  assert.equal(parsePlaylistId('https://www.youtube.com/playlist?list=<script>'), null);
  assert.equal(parsePlaylistId('ไม่ใช่ลิงก์'), null);
});

test('isAutoMix: Mix อัตโนมัติขึ้นต้นด้วย RD', () => {
  assert.equal(isAutoMix('RDdQw4w9WgXcQ'), true);
  assert.equal(isAutoMix(LIST), false);
});

test('mapPlaylistItems: ตัดคลิปที่ถูกลบ/ส่วนตัว และ id ซ้ำ · ถอด HTML entity ในชื่อ', () => {
  const item = (videoId, title, owner) => ({ snippet: { title, videoOwnerChannelTitle: owner, resourceId: { videoId } } });
  const songs = mapPlaylistItems([
    item(vid(1), 'Don&#39;t Stop', 'Queen - Topic'),
    item(vid(2), 'Deleted video', undefined), // ถูกลบ → ไม่มีเจ้าของ
    item(vid(1), 'ซ้ำ', 'Queen - Topic'),
    item('bad', 'id ผิด', 'X'),
    item(vid(3), 'ปลายทาง', 'Bodyslam'),
  ]);
  assert.deepEqual(songs.map((s) => s.videoId), [vid(1), vid(3)]);
  assert.equal(songs[0].title, "Don't Stop");
  assert.equal(songs[0].channel, 'Queen - Topic');
});

test('sanitizeAction addMany: กรองเพลงที่ id ผิด · ไม่มีเพลงที่ใช้ได้ → null · ตัดที่ 100', () => {
  const ok = sanitizeAction({ type: 'addMany', items: [{ videoId: vid(1), title: 'a' }, { videoId: 'x' }] }, 'Man');
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].addedBy, 'Man');
  assert.equal(sanitizeAction({ type: 'addMany', items: [{ videoId: 'x' }] }, 'Man'), null);
  assert.equal(sanitizeAction({ type: 'addMany', items: 'nope' }, 'Man'), null);
  const many = Array.from({ length: 150 }, (_, i) => ({ videoId: vid(i) }));
  assert.equal(sanitizeAction({ type: 'addMany', items: many }, 'Man').items.length, 100);
});

test('addMany: ห้องว่าง → เล่นเพลงแรกทันที · มีเพลงเล่นอยู่ → ต่อท้ายไม่แตะเพลงปัจจุบัน', () => {
  const empty = reduce(createRoomState(0), { type: 'addMany', items: [song('a'), song('b')] }, 10);
  assert.equal(empty.queue.length, 2);
  assert.equal(empty.currentId, 'a');
  assert.equal(empty.isPlaying, true);

  const more = reduce(empty, { type: 'addMany', items: [song('c')] }, 20);
  assert.deepEqual(more.queue.map((q) => q.id), ['a', 'b', 'c']);
  assert.equal(more.currentId, 'a');
  assert.equal(more.version, empty.version + 1);
});

test('addMany: คิวเกือบเต็ม → รับเท่าที่ใส่ได้ · เต็มแล้ว → state เดิม', () => {
  const nearlyFull = { ...createRoomState(0), queue: Array.from({ length: MAX_QUEUE - 1 }, (_, i) => song(`q${i}`)) };
  const next = reduce(nearlyFull, { type: 'addMany', items: [song('x'), song('y')] }, 1);
  assert.equal(next.queue.length, MAX_QUEUE);
  assert.equal(reduce(next, { type: 'addMany', items: [song('z')] }, 2), next);
});
