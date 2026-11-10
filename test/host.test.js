import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomState, MAX_QUEUE, needsAutofill, reduce } from '../server/room.js';
import { decideHostStart, HOST_IDLE_MS, HOST_TAKEOVER_COOLDOWN_MS } from '../server/host.js';
import { cleanHostState, sanitizeAction } from '../server/validate.js';

const vid = (n) => `vid${n}`.padEnd(11, 'x');
const song = (id, videoId = vid(id)) => ({ id, videoId, title: `เพลง ${id}`, channel: '', thumb: '', addedBy: 'Man' });
const MAN = { socketId: 's-man', name: 'Man' };

// ห้องที่มี host แล้ว (เริ่มจากคิวเพลง a ที่คนเพิ่มไว้ก่อน)
function hostedRoom() {
  let s = reduce({ ...createRoomState(0), whenEmpty: 'stop' }, { type: 'add', item: song('a') }, 0);
  s = reduce(s, { type: 'hostStart', host: MAN }, 0);
  return s;
}

const sync = (videoId, position, isPlaying, refTime, itemId = `q-${videoId}`) => ({
  type: 'hostSync',
  videoId,
  position,
  isPlaying,
  refTime,
  item: song(itemId, videoId),
});

test('hostStart ตั้ง host / กดซ้ำคนเดิม → object เดิม (ไม่ broadcast)', () => {
  const s = hostedRoom();
  assert.deepEqual(s.host, MAN);
  assert.equal(reduce(s, { type: 'hostStart', host: MAN }, 1), s);
});

test('hostStop: หยุดเฉพาะ host คนที่ระบุ (timer ของ host เก่าไม่ไปหยุด host ใหม่)', () => {
  let s = hostedRoom();
  s = reduce(s, { type: 'hostStart', host: { socketId: 's-bas', name: 'เบส' } }, 1);
  assert.equal(reduce(s, { type: 'hostStop', socketId: 's-man' }, 2), s);
  assert.equal(reduce(s, { type: 'hostStop', socketId: 's-bas' }, 2).host, null);
});

test('client ส่ง host:* ผ่าน action ธรรมดาไม่ได้', () => {
  assert.equal(sanitizeAction({ type: 'hostStart', host: MAN }, 'x'), null);
  assert.equal(sanitizeAction({ type: 'hostStop' }, 'x'), null);
  assert.equal(sanitizeAction({ type: 'hostSync', videoId: vid('z') }, 'x'), null);
});

test('hostSync ไม่มี host → ไม่มีผล', () => {
  const s = reduce(createRoomState(0), { type: 'add', item: song('a') }, 0);
  assert.equal(reduce(s, sync(vid('z'), 5, true, 1), 1), s);
});

test('hostSync เพลงใหม่ → ต่อท้ายคิวแล้วเล่นตามตำแหน่งของ host', () => {
  const s = reduce(hostedRoom(), sync(vid('z'), 42, true, 1000), 1000);
  assert.equal(s.queue.length, 2);
  assert.equal(s.queue[1].videoId, vid('z'));
  assert.equal(s.currentId, s.queue[1].id);
  assert.equal(s.isPlaying, true);
  assert.equal(s.position, 42);
  assert.equal(s.refTime, 1000);
});

test('hostSync เพลงที่เคยอยู่ในคิว → ใช้รายการเดิม ไม่เพิ่มซ้ำ', () => {
  let s = reduce(hostedRoom(), sync(vid('z'), 0, true, 0), 0);
  s = reduce(s, sync(vid('a'), 10, true, 5000), 5000);
  assert.equal(s.queue.length, 2);
  assert.equal(s.currentId, 'a');
});

test('hostSync เพลงเดิมตำแหน่งตรง → object เดิม · คลาดเกิน 1 วิ หรือเล่น/หยุดเปลี่ยน → อัปเดต', () => {
  const s = reduce(hostedRoom(), sync(vid('z'), 10, true, 0), 0);
  // ผ่านไป 5 วิ host อยู่ที่ 15.4 = คลาด 0.4 วิ → ไม่ต้อง broadcast
  assert.equal(reduce(s, sync(vid('z'), 15.4, true, 5000), 5000), s);
  // host กรอไป 60 วิ
  assert.equal(reduce(s, sync(vid('z'), 60, true, 5000), 5000).position, 60);
  // host กดหยุด
  const paused = reduce(s, sync(vid('z'), 15, false, 5000), 5000);
  assert.equal(paused.isPlaying, false);
  assert.equal(paused.position, 15);
});

test('hostSync คิวเต็ม → ทิ้งเพลงเก่าสุดแทนการไม่รับเพลงของ host', () => {
  let s = { ...createRoomState(0), whenEmpty: 'stop' };
  const many = Array.from({ length: MAX_QUEUE }, (_, i) => song(`m${i}`, vid(i)));
  s = reduce(s, { type: 'addMany', items: many }, 0);
  s = reduce(s, { type: 'hostStart', host: MAN }, 0);
  s = reduce(s, sync('newsongxxxx', 0, true, 1), 1);
  assert.equal(s.queue.length, MAX_QUEUE);
  assert.equal(s.queue[0].id, 'm1');
  assert.equal(s.queue.at(-1).videoId, 'newsongxxxx');
});

test('โหมด host: ปุ่มของคนในห้องถูกเมินทั้งหมด และไม่เติมเพลงอัตโนมัติ', () => {
  const s = reduce(hostedRoom(), sync(vid('a'), 0, true, 0), 0);
  for (const action of [
    { type: 'pause' },
    { type: 'next' },
    { type: 'prev' },
    { type: 'seek', position: 30 },
    { type: 'add', item: song('b') },
    { type: 'remove', id: 'a' },
    { type: 'ended', id: 'a' },
    { type: 'mode', mode: 'loop' },
    { type: 'autofill', items: [song('c')] },
  ]) {
    assert.equal(reduce(s, action, 1), s, action.type);
  }
  assert.equal(needsAutofill({ ...s, whenEmpty: 'similar' }), false);
});

test('โหมด host: เพลงที่ฝังไม่ได้ → ติดป้ายแต่ไม่ข้ามเพลง (host เป็นคนเลือกเพลงต่อ)', () => {
  const s = reduce(hostedRoom(), sync(vid('a'), 0, true, 0), 0);
  const blocked = reduce(s, { type: 'blocked', id: 'a' }, 1);
  assert.equal(blocked.currentId, 'a');
  assert.equal(blocked.queue[0].blocked, true);
  assert.equal(reduce(blocked, { type: 'blocked', id: 'a' }, 2), blocked); // หลายเครื่องส่งซ้ำ → ไม่ broadcast ซ้ำ
});

test('เลิก host → กลับมาคุมร่วมกันได้ เพลงเล่นต่อจากจุดเดิม', () => {
  let s = reduce(hostedRoom(), sync(vid('a'), 20, true, 0), 0);
  s = reduce(s, { type: 'hostStop', socketId: MAN.socketId }, 1000);
  assert.equal(s.host, null);
  assert.equal(s.isPlaying, true);
  assert.equal(reduce(s, { type: 'pause' }, 2000).position, 22);
});

test('decideHostStart: ไม่มี host / host หลุด → ได้เลย · คนเดิม → same', () => {
  const base = { host: MAN, socketId: 's-bas', hostConnected: true, since: 0, activeAt: 0, now: HOST_TAKEOVER_COOLDOWN_MS + 1, force: false };
  assert.equal(decideHostStart({ ...base, host: null }), 'start');
  assert.equal(decideHostStart({ ...base, socketId: MAN.socketId }), 'same');
  assert.equal(decideHostStart({ ...base, hostConnected: false }), 'start');
});

test('decideHostStart: host กำลังเปิดเพลง → ต้องยืนยันก่อน · ยืนยันแล้ว / host ว่างนาน → แย่งได้', () => {
  const now = 5 * 60 * 1000;
  const base = { host: MAN, socketId: 's-bas', hostConnected: true, since: 0, now, force: false };
  assert.equal(decideHostStart({ ...base, activeAt: now - 1000 }), 'confirm');
  assert.equal(decideHostStart({ ...base, activeAt: now - 1000, force: true }), 'start');
  assert.equal(decideHostStart({ ...base, activeAt: now - HOST_IDLE_MS - 1 }), 'start');
});

test('decideHostStart: เพิ่งเปลี่ยน host ไม่ถึง 10 วิ → cooldown แม้จะยืนยัน', () => {
  const base = { host: MAN, socketId: 's-bas', hostConnected: true, since: 1000, activeAt: 1000, force: true };
  assert.equal(decideHostStart({ ...base, now: 1000 + HOST_TAKEOVER_COOLDOWN_MS - 1 }), 'cooldown');
});

test('cleanHostState: ทิ้งข้อมูลแปลก และบีบเวลาที่เพี้ยนให้อยู่ในกรอบ', () => {
  const now = 100_000;
  assert.equal(cleanHostState(null, now), null);
  assert.equal(cleanHostState({ videoId: '<script>', position: 1 }, now), null);
  assert.equal(cleanHostState({ videoId: 'dQw4w9WgXcQ', position: -1 }, now), null);
  const ok = cleanHostState({ videoId: 'dQw4w9WgXcQ', position: 10, isPlaying: true, sampledAt: now - 500, title: 'a\u0000b', extra: 1 }, now);
  assert.deepEqual(ok, { videoId: 'dQw4w9WgXcQ', title: 'ab', channel: '', position: 10, isPlaying: true, refTime: now - 500 });
  // เวลาในอนาคต 3 วิ → ใช้ now แล้วเลื่อนตำแหน่งถอยกลับ 3 วิ ให้ยังตรงกับเพลงจริง
  const future = cleanHostState({ videoId: 'dQw4w9WgXcQ', position: 10, isPlaying: true, sampledAt: now + 3000 }, now);
  assert.equal(future.refTime, now);
  assert.equal(future.position, 7);
  // หยุดอยู่ → ตำแหน่งไม่ขยับตามเวลา
  const paused = cleanHostState({ videoId: 'dQw4w9WgXcQ', position: 10, isPlaying: 'yes', sampledAt: now - 60_000 }, now);
  assert.equal(paused.isPlaying, false);
  assert.equal(paused.position, 10);
});
