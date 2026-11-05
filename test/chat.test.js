import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendChat, cleanChatText, createChatLimiter, MAX_CHAT_LEN } from '../server/chat.js';

test('cleanChatText: ว่าง/ไม่ใช่ string → null, ตัดช่องว่างหัวท้าย', () => {
  assert.equal(cleanChatText('   '), null);
  assert.equal(cleanChatText(42), null);
  assert.equal(cleanChatText({ text: 'hi' }), null);
  assert.equal(cleanChatText('  สวัสดี  '), 'สวัสดี');
});

test('cleanChatText: เก็บขึ้นบรรทัด ตัดอักขระควบคุม ยุบบรรทัดว่างซ้อน ตัดความยาว', () => {
  assert.equal(cleanChatText('a\r\nb'), 'a\nb');
  assert.equal(cleanChatText('a\u0000\u0007b\tc'), 'abc');
  assert.equal(cleanChatText('a\n\n\n\n\nb'), 'a\n\nb');
  assert.equal(cleanChatText('x'.repeat(MAX_CHAT_LEN + 50)).length, MAX_CHAT_LEN);
});

test('appendChat: คืน array ใหม่ เก็บแค่ N ล่าสุด ไม่แก้ของเดิม', () => {
  const log = [1, 2, 3];
  const next = appendChat(log, 4, 3);
  assert.deepEqual(next, [2, 3, 4]);
  assert.deepEqual(log, [1, 2, 3]);
});

test('createChatLimiter: ส่งได้ burst ครั้งในหน้าต่าง แล้วกลับมาส่งได้เมื่อพ้นหน้าต่าง', () => {
  const allow = createChatLimiter(2, 1000);
  assert.equal(allow(0), true);
  assert.equal(allow(100), true);
  assert.equal(allow(200), false);
  assert.equal(allow(1001), true); // ข้อความแรก (t=0) พ้นหน้าต่างแล้ว
  assert.equal(allow(1050), false);
});
