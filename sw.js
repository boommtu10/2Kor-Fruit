// Service worker: แคชเฉพาะ "app shell" (หน้าตาโปรแกรม) ให้เปิดแอปได้แม้เน็ตหลุด
// ส่วนข้อมูล (เรียก GAS_URL) จะไปที่เครือข่ายเสมอ เพื่อให้เห็นข้อมูลล่าสุด
const CACHE_NAME = "2kor-shell-v3"; // v2 -> v3: เพิ่มโหมดขาย/จัดการเมนูขาย ต้องบังคับดึงไฟล์ใหม่
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/logo-256.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // อย่าแคชการเรียก API ไป Google Apps Script — ต้องได้ข้อมูลสดเสมอ
  if (url.hostname.includes("script.google.com")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // เฉพาะไฟล์ในโดเมนเดียวกัน (app shell): cache-first แล้วอัปเดตเบื้องหลัง
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((res) => {
            // แก้บั๊ก: ต้อง clone() "ทันที" ที่ได้ res มา ก่อนที่จะ return
            // ออกไปให้หน้าเว็บอ่าน เพราะ Response อ่านได้แค่ครั้งเดียว
            // ถ้า return res ออกไปก่อนแล้วค่อย clone ทีหลัง (แบบเดิม)
            // มีโอกาสที่หน้าเว็บอ่าน body ไปแล้วก่อน clone() จะทำงาน
            // ทำให้พังด้วย error "Response body is already used"
            const resToCache = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resToCache));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
