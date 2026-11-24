import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateUnits, pickAutofill } from '../server/autofill.js';

const vid = (s) => s.padEnd(11, 'x');
const yt = (id, title, channel) => ({ videoId: vid(id), title, channel });
const seed = { id: '1', ...yt('seed', 'ปลายทาง', 'Bodyslam - Topic') };
const familiarPool = [yt('f1', 'แสงสุดท้าย', 'Bodyslam - Topic'), yt('f2', 'ความเชื่อ', 'Bodyslam - Topic'), yt('f3', 'คิดถึง', 'Bodyslam - Topic')];

// deps ปลอมทั้งหมด (ไม่ยิงเน็ต) · searched = คำที่ถูกส่งไปค้น YouTube
function deps(over = {}) {
  const searched = [];
  return {
    searched,
    useLastfm: true,
    rand: () => 0,
    findSimilar: async () => ({
      artist: 'Bodyslam',
      similar: [
        { artist: 'Big Ass', track: 'เล่นของสูง', match: 0.9 },
        { artist: 'Potato', track: 'ทิ้งไว้กลางทาง', match: 0.8 },
      ],
    }),
    search: async (q) => {
      searched.push(q);
      if (q.startsWith('Big Ass')) return [yt('n1', 'เล่นของสูง', 'Big Ass - Topic'), yt('n1b', 'เล่นของสูง Karaoke', 'Big Ass - Topic')];
      if (q.startsWith('Potato')) return [yt('n2', 'ทิ้งไว้กลางทาง - Potato', 'Potato Official')];
      return [];
    },
    keepSongLength: async (items) => items,
    suggestCandidates: async (_base, exclude) => familiarPool.filter((r) => !exclude.has(r.videoId)),
    ...over,
  };
}
const input = { seed, history: [], queue: [seed], lastSeedArtist: null, count: 3 };

test('estimateUnits: ขั้น 1 = 101 · ขั้น 2 = 302', () => {
  assert.equal(estimateUnits(false), 101);
  assert.equal(estimateUnits(true), 302);
});

test('pickAutofill: มี Last.fm → ศิลปินใหม่ 2 + ศิลปินเดิม 1 สลับกัน · นับหน่วยถูก', async () => {
  const d = deps();
  const out = await pickAutofill(input, d);
  assert.deepEqual(out.picks.map((p) => p.videoId), [vid('n1'), vid('f1'), vid('n2')]);
  assert.equal(out.fromLastfm, 2);
  assert.equal(out.units, 302);
  assert.equal(out.seedArtist, 'bodyslam');
  assert.deepEqual(d.searched, ['Big Ass เล่นของสูง', 'Potato ทิ้งไว้กลางทาง']);
});

test('pickAutofill: Last.fm พัง → แจ้ง onError แล้วได้ผลแบบขั้น 1 ครบ 3 เพลง', async () => {
  const errors = [];
  const broken = async () => {
    throw new Error('down');
  };
  const out = await pickAutofill(input, deps({ findSimilar: broken, onError: (e) => errors.push(e.message) }));
  assert.deepEqual(errors, ['down']);
  assert.equal(out.fromLastfm, 0);
  assert.equal(out.picks.length, 3);
  assert.equal(out.units, 101);
});

test('pickAutofill: ไม่ใช้ Last.fm → ไม่เรียก findSimilar เลย', async () => {
  let called = false;
  const spy = async () => {
    called = true;
    return { artist: '', similar: [] };
  };
  const out = await pickAutofill(input, deps({ useLastfm: false, findSimilar: spy }));
  assert.equal(called, false);
  assert.equal(out.picks.length, 3);
  assert.equal(out.units, 101);
});

test('pickAutofill: ค้น YouTube แล้วไม่เจอคลิปที่ตรงเพลง → ไม่นับเป็นเพลงใหม่ ให้ขั้น 1 เติมแทน', async () => {
  const out = await pickAutofill(input, deps({ search: async () => [yt('zz', 'เพลงอื่นเลย', 'ใครไม่รู้')] }));
  assert.equal(out.fromLastfm, 0);
  assert.deepEqual(out.picks.map((p) => p.videoId), [vid('f1'), vid('f2'), vid('f3')]);
  assert.equal(out.units, 301); // ค้น 2 ครั้ง + ขั้น 1 (ไม่ถามความยาวเพราะไม่เจออะไร)
});
