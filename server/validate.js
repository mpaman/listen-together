// ตรวจทุกอย่างที่มาจากหน้าเว็บก่อนเข้า reducer — ไม่เชื่อข้อมูลจาก client
import { randomUUID } from 'node:crypto';
import { MAX_QUEUE, WHEN_EMPTY_MODES } from './room.js';
import { isVideoId, thumbnailFor } from './youtube.js';

// ชื่อห้องใช้ภาษาไทยได้: ตัวอักษรทุกภาษา (\p{L}) + สระ/วรรณยุกต์ไทย (\p{M}) + ตัวเลข + ขีด
const ROOM_ID_RE = /^[\p{L}\p{M}\p{N}-]{2,32}$/u;
const MAX_ROOM_LEN = 32;
const MAX_NAME = 24;
const MAX_TITLE = 200;
const MAX_POSITION_SEC = 24 * 60 * 60;
const MAX_ADD_MANY = 100; // = PLAYLIST_MAX ใน youtube.js
const ID_ACTIONS = new Set(['jump', 'remove', 'ended', 'blocked']);
const PLAIN_ACTIONS = new Set(['play', 'pause', 'next', 'prev']);

const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);

export const isRoomId = (value) => typeof value === 'string' && ROOM_ID_RE.test(value);

// "ห้อง แก๊งค์!!" → "ห้อง-แก๊งค์" — ให้ชื่อที่พิมพ์ต่างกันนิดหน่อยได้ห้องเดียวกัน (หน้าเว็บใช้กฎเดียวกัน)
export function normalizeRoomId(value) {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_ROOM_LEN);
}

export const cleanName = (value) => cleanText(value, MAX_NAME) || 'ไม่ระบุชื่อ';

// สร้าง "รายการในคิว" — ใช้ทั้งตอนคนเพิ่มเพลง และตอน server เติมเพลงให้เอง
export function makeQueueItem({ videoId, title, channel }, addedBy, auto = false) {
  return {
    id: randomUUID(), // id ของรายการ (เพลงเดียวกันเพิ่มซ้ำได้)
    videoId,
    title: cleanText(title, MAX_TITLE) || videoId,
    channel: cleanText(channel, MAX_TITLE),
    thumb: thumbnailFor(videoId), // สร้างเอง ไม่ใช้ URL จาก client
    addedBy,
    auto,
  };
}

// คืน action ที่สะอาดแล้ว หรือ null ถ้าไม่ผ่าน
export function sanitizeAction(raw, addedBy) {
  if (!raw || typeof raw !== 'object') return null;
  const { type } = raw;
  if (PLAIN_ACTIONS.has(type)) return { type };
  if (ID_ACTIONS.has(type)) return typeof raw.id === 'string' && raw.id.length <= 64 ? { type, id: raw.id } : null;
  if (type === 'seek') {
    const position = Number(raw.position);
    return Number.isFinite(position) && position >= 0 && position <= MAX_POSITION_SEC ? { type, position } : null;
  }
  if (type === 'add') {
    if (!isVideoId(raw.item?.videoId)) return null;
    return { type, item: makeQueueItem(raw.item, addedBy) };
  }
  // เพิ่มทั้ง playlist ในครั้งเดียว (ส่งทีละเพลงจะชน rate limit 10 ครั้ง/วิ) · เพลงที่ id ไม่ถูกตัดทิ้ง
  if (type === 'addMany') {
    if (!Array.isArray(raw.items)) return null;
    const items = raw.items.slice(0, MAX_ADD_MANY).filter((item) => isVideoId(item?.videoId)).map((item) => makeQueueItem(item, addedBy));
    return items.length ? { type, items } : null;
  }
  if (type === 'move') {
    const to = Number(raw.to);
    const okId = typeof raw.id === 'string' && raw.id.length <= 64;
    return okId && Number.isInteger(to) && to >= 0 && to < MAX_QUEUE ? { type, id: raw.id, to } : null;
  }
  if (type === 'mode') return WHEN_EMPTY_MODES.includes(raw.mode) ? { type, mode: raw.mode } : null;
  return null;
}
