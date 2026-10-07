// Service worker: تخزين واجهة التطبيق والمكتبات للعمل بدون إنترنت + إشعارات + مزامنة خلفية
const CACHE = 'mawlidi-shell-v1';
const CORE = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Noto+Naskh+Arabic:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // نخزّن كل مورد على حدة حتى لا يفشل التثبيت بسبب مورد واحد
    await Promise.all(CORE.map(async (u) => {
      try {
        const isCross = u.startsWith('http');
        const r = await fetch(isCross ? new Request(u, { mode: 'no-cors' }) : u, { cache: 'reload' });
        if (r && (r.ok || r.type === 'opaque')) await c.put(u, r);
      } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // لا نتدخل في طلبات قاعدة البيانات/الـ API (Supabase) — المزامنة يتولاها التطبيق
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;

  // صفحة التطبيق: الشبكة أولاً لكن بمهلة قصيرة (2.5 ثانية) — إن تأخرت الشبكة تُعرض النسخة المخزّنة فوراً
  // وتتحدّث النسخة المخزّنة في الخلفية، فلا ينتظر المستخدم عند ضعف الإنترنت
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const cached = (await c.match('./index.html')) || (await c.match('./'));
      const net = fetch(req).then((r) => { if (r && r.ok) c.put('./index.html', r.clone()); return r; });
      if (!cached) {
        try { return await net; }
        catch (_) {
          return new Response('التطبيق غير متاح دون اتصال بعد. افتحه مرة واحدة مع الإنترنت.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }
      }
      net.catch(() => {});
      try {
        return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 2500))]);
      } catch (_) {
        return cached;
      }
    })());
    return;
  }

  // باقي الموارد (مكتبات، خطوط): من الكاش أولاً ثم الشبكة مع التخزين
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) { const c = await caches.open(CACHE); c.put(req, r.clone()); }
      return r;
    } catch (_) {
      return new Response('', { status: 504 });
    }
  })());
});

// مزامنة خلفية (Chrome/Android): توقظ التطبيق ليرسل الطابور عند عودة الإنترنت
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-pending') {
    e.waitUntil(self.clients.matchAll({ includeUncontrolled: true }).then(list => list.forEach(c => c.postMessage({ type: 'sync-now' }))));
  }
});

// الإشعارات
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'show-notification') {
    const { id, title, body, tag, icon } = event.data;
    self.registration.showNotification(title, { body, tag: String(tag ?? id), icon: icon || undefined, badge: icon || undefined, dir: 'rtl', lang: 'ar', requireInteraction: false, data: { id } });
  }
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) { if (client.url && 'focus' in client) return client.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});
