import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomState, needsAutofill, positionAt, reduce } from '../server/room.js';
import { cleanTitle, parseIsoDuration, parseVideoId, seedQuery } from '../server/youtube.js';
import { isRoomId, normalizeRoomId, sanitizeAction } from '../server/validate.js';

test('ชื่อห้อง: ภาษาไทยได้ ช่องว่างกลายเป็นขีด ตัดอักขระพิเศษ', () => {
  assert.equal(normalizeRoomId('  ห้อง แก๊งค์!! '), 'ห้อง-แก๊งค์');
  assert.equal(normalizeRoomId('Bodyslam Night'), 'bodyslam-night');
  assert.equal(normalizeRoomId('<script>'), 'script');
  assert.equal(isRoomId(normalizeRoomId('ห้องแก๊งค์')), true);
  assert.equal(isRoomId(normalizeRoomId('!')), false);
});

const song = (id) => ({ id, videoId: `vid${id}`.padEnd(11, 'x'), title: `เพลง ${id}`, channel: '', thumb: '', addedBy: 'Man' });

// ค่าเริ่มต้นของห้องคือ 'similar' แต่เทสเก่าเขียนตามพฤติกรรม 'stop' → ระบุโหมดได้
function roomWith(ids, now = 0, whenEmpty = 'stop') {
  const start = { ...createRoomState(now), whenEmpty };
  return ids.reduce((s, id) => reduce(s, { type: 'add', item: song(id) }, now), start);
}

test('ห้องใหม่ตั้งค่า "เมื่อคิวหมด" เป็นต่อเพลงแนวเดียวกัน', () => {
  assert.equal(createRoomState(0).whenEmpty, 'similar');
});

test('โหมด loop: จบเพลงสุดท้าย → กลับไปเพลงแรก', () => {
  let s = roomWith(['a', 'b'], 0, 'loop');
  s = reduce(s, { type: 'ended', id: 'a' }, 1);
  s = reduce(s, { type: 'ended', id: 'b' }, 2);
  assert.equal(s.currentId, 'a');
  assert.equal(s.isPlaying, true);
});

test('โหมด similar: เติมเพลงไม่ทัน → วนคิวแทนการเงียบ', () => {
  let s = roomWith(['a'], 0, 'similar');
  s = reduce(s, { type: 'ended', id: 'a' }, 1);
  assert.equal(s.isPlaying, true);
  assert.equal(s.currentId, 'a');
});

test('needsAutofill จริงเฉพาะตอนเล่นเพลงสุดท้าย ในโหมด similar', () => {
  assert.equal(needsAutofill(roomWith(['a'], 0, 'similar')), true);
  assert.equal(needsAutofill(roomWith(['a', 'b'], 0, 'similar')), false);
  assert.equal(needsAutofill(roomWith(['a'], 0, 'loop')), false);
  assert.equal(needsAutofill({ ...createRoomState(0) }), false);
});

test('autofill ต่อท้ายคิวโดยไม่ตัดเพลงที่เล่นอยู่ / ถ้าคิวจบแล้วเล่นเพลงที่เติมทันที', () => {
  const playing = reduce(roomWith(['a'], 0, 'similar'), { type: 'autofill', items: [song('x'), song('y')] }, 5);
  assert.equal(playing.currentId, 'a');
  assert.equal(playing.queue.length, 3);
  let finished = reduce(roomWith(['a']), { type: 'ended', id: 'a' }, 1);
  finished = reduce(finished, { type: 'autofill', items: [song('x')] }, 2);
  assert.equal(finished.currentId, 'x');
  assert.equal(finished.isPlaying, true);
});

test('เปลี่ยนโหมดได้ / ค่าเดิมไม่ broadcast / client ส่ง autofill เองไม่ได้', () => {
  const s = roomWith(['a']);
  assert.equal(reduce(s, { type: 'mode', mode: 'loop' }, 0).whenEmpty, 'loop');
  assert.equal(reduce(s, { type: 'mode', mode: 'stop' }, 0), s);
  assert.deepEqual(sanitizeAction({ type: 'mode', mode: 'loop' }, 'x'), { type: 'mode', mode: 'loop' });
  assert.equal(sanitizeAction({ type: 'mode', mode: 'party' }, 'x'), null);
  assert.equal(sanitizeAction({ type: 'autofill', items: [] }, 'x'), null);
});

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT3M45S'), 225);
  assert.equal(parseIsoDuration('PT1H2M'), 3720);
  assert.equal(parseIsoDuration('P1D'), 0);
});

test('cleanTitle ตัดวงเล็บและคำประกอบ', () => {
  assert.equal(cleanTitle('ปลายทาง (ร้องสด) - Bodyslam'), 'ปลายทาง - Bodyslam');
  assert.equal(cleanTitle('ความเชื่อ - bodyslam【OFFICIAL MV】'), 'ความเชื่อ - bodyslam');
  assert.equal(cleanTitle('[MV] เขาที่เพิ่งเจอ - ABnormal'), 'เขาที่เพิ่งเจอ - ABnormal');
});

test('seedQuery: ช่อง Topic ใช้ชื่อศิลปิน / ช่องคนอัปโหลดใช้ชื่อเพลงที่ล้างแล้ว', () => {
  assert.equal(seedQuery({ channel: 'bodyslam - Topic', title: 'แสงสุดท้าย' }), 'bodyslam');
  assert.equal(seedQuery({ channel: 'อลิสา สุวรรณโชติ', title: 'ปลายทาง (ร้องสด) - Bodyslam' }), 'ปลายทาง - Bodyslam');
});

test('เพิ่มเพลงแรกในห้องว่าง → เล่นทันที', () => {
  const s = roomWith(['a']);
  assert.equal(s.currentId, 'a');
  assert.equal(s.isPlaying, true);
});

test('เพิ่มเพลงต่อจากนั้นแค่เข้าคิว ไม่ตัดเพลงที่เล่นอยู่', () => {
  const s = roomWith(['a', 'b']);
  assert.equal(s.currentId, 'a');
  assert.equal(s.queue.length, 2);
});

test('ตำแหน่งเพลงเดินตามเวลาเมื่อกำลังเล่น และหยุดนิ่งเมื่อ pause', () => {
  const s = roomWith(['a'], 1000);
  assert.equal(positionAt(s, 11_000), 10);
  const paused = reduce(s, { type: 'pause' }, 11_000);
  assert.equal(positionAt(paused, 99_000), 10);
  const resumed = reduce(paused, { type: 'play' }, 20_000);
  assert.equal(positionAt(resumed, 25_000), 15);
});

test('ended จากหลายเครื่องพร้อมกัน → ข้ามเพลงแค่ครั้งเดียว', () => {
  let s = roomWith(['a', 'b', 'c']);
  s = reduce(s, { type: 'ended', id: 'a' }, 100);
  s = reduce(s, { type: 'ended', id: 'a' }, 101); // เครื่องที่สองส่งตามมา
  assert.equal(s.currentId, 'b');
});

test('เล่นจบคิว → หยุด แล้วเพลงที่เพิ่มใหม่เล่นต่อเลย', () => {
  let s = roomWith(['a']);
  s = reduce(s, { type: 'ended', id: 'a' }, 100);
  assert.equal(s.isPlaying, false);
  s = reduce(s, { type: 'add', item: song('b') }, 200);
  assert.equal(s.currentId, 'b');
  assert.equal(s.isPlaying, true);
});

test('เพลงที่ฝังไม่ได้ → ติดป้าย blocked และข้าม, prev/jump จะไม่วนกลับมา', () => {
  let s = roomWith(['a', 'b', 'c']);
  s = reduce(s, { type: 'next' }, 0);
  s = reduce(s, { type: 'blocked', id: 'b' }, 0);
  assert.equal(s.currentId, 'c');
  assert.equal(s.queue.find((q) => q.id === 'b').blocked, true);
  assert.equal(reduce(s, { type: 'jump', id: 'b' }, 0), s);
  assert.equal(reduce(s, { type: 'prev' }, 0).currentId, 'a');
});

test('blocked ที่ไม่ใช่เพลงปัจจุบัน → ไม่มีผล', () => {
  const s = roomWith(['a', 'b']);
  assert.equal(reduce(s, { type: 'blocked', id: 'b' }, 0), s);
});

test('ลบเพลงที่กำลังเล่น → ไปเพลงถัดไป', () => {
  let s = roomWith(['a', 'b']);
  s = reduce(s, { type: 'remove', id: 'a' }, 0);
  assert.equal(s.currentId, 'b');
  assert.equal(s.queue.length, 1);
});

test('prev: เล่นเกิน 3 วิ → กลับต้นเพลง, ไม่เกิน → ไปเพลงก่อน', () => {
  let s = roomWith(['a', 'b'], 0);
  s = reduce(s, { type: 'jump', id: 'b' }, 0);
  const restarted = reduce(s, { type: 'prev' }, 10_000);
  assert.equal(restarted.currentId, 'b');
  assert.equal(positionAt(restarted, 10_000), 0);
  const back = reduce(s, { type: 'prev' }, 1000);
  assert.equal(back.currentId, 'a');
});

test('action ไม่มีผล → คืน object เดิม (ไม่ต้อง broadcast) และไม่แก้ state เดิม', () => {
  const s = roomWith(['a']);
  const frozen = structuredClone(s);
  assert.equal(reduce(s, { type: 'play' }, 0), s);
  reduce(s, { type: 'next' }, 0);
  assert.deepEqual(s, frozen);
});

test('parseVideoId รับลิงก์ YouTube Music / youtu.be / shorts', () => {
  assert.equal(parseVideoId('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(parseVideoId('https://evil.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseVideoId('ไม่ใช่ลิงก์'), null);
});

test('sanitizeAction ทิ้งข้อมูลแปลกปลอม และสร้าง thumbnail เอง', () => {
  assert.equal(sanitizeAction({ type: 'hack' }, 'x'), null);
  assert.equal(sanitizeAction({ type: 'seek', position: -5 }, 'x'), null);
  assert.equal(sanitizeAction({ type: 'add', item: { videoId: '<script>' } }, 'x'), null);
  const add = sanitizeAction({ type: 'add', item: { videoId: 'dQw4w9WgXcQ', title: 'a\u0000b', thumb: 'https://evil' } }, 'Man');
  assert.equal(add.item.title, 'ab');
  assert.equal(add.item.thumb, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
  assert.equal(add.item.addedBy, 'Man');
});
