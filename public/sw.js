// service worker: ทำให้ "ติดตั้งเป็นแอป" ได้ + เก็บไฟล์หน้าเว็บไว้ใช้ตอนเน็ตหลุด/server กำลังตื่น
// ใช้แบบ network-first: มีเน็ตเอาของใหม่เสมอ (deploy แล้วทุกคนได้โค้ดใหม่ทันที ไม่ค้างเวอร์ชันเก่า)
// ไม่เก็บ /api, socket.io, ไฟล์ข้ามโดเมน (YouTube) — พวกนั้นต้องสดเสมอ หรือเก็บไม่ได้ตามกฎของเจ้าของ
const CACHE = 'listen-together-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.webmanifest', '/img/icon-192.png'];
const SKIP_PREFIXES = ['/api/', '/socket.io/', '/extension.zip'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (SKIP_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      // หน้าห้อง (?room=...) ที่ยังไม่เคยเก็บ → ใช้หน้าแรกแทน (โค้ดเดียวกัน อ่านชื่อห้องจาก URL เอง)
      .catch(() => caches.match(request, { ignoreSearch: request.mode === 'navigate' }).then((hit) => hit ?? caches.match('/'))),
  );
});
