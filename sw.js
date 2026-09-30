/* 扬帆OS · Service Worker
 * 目标：桌面安装（独立窗口 + 图标）、二次打开秒开、断网可用。
 * 策略：文档走「网络优先 + 4s 超时回退本地缓存」——既保证版本不过期，又保证弱网/断网秒开；
 *       其余同源静态走「缓存优先 + 后台补更新」。
 * 只接管同源 GET；云函数 API 与 COS 图片均为跨源，一律直连不插手。
 * 版本升级：改 CACHE 常量（yf-os-v2 …），activate 会自动清掉旧缓存。
 */
const CACHE = 'yf-os-v1';
const NET_TIMEOUT = 4000;
const CORE = [
  './index.html',
  './manifest.json',
  './pwa_icon_192.png',
  './pwa_icon_512.png',
  './pwa_apple_touch_180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { cache: 'reload' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 网络优先，带超时；成功则回写缓存。超时/失败返回 null。 */
function netFirst(req, cache, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const ctl = ('AbortController' in self) ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; if (ctl) { try { ctl.abort(); } catch (_) {} } resolve(null); }
    }, ms);
    fetch(req, ctl ? { signal: ctl.signal } : undefined).then((r) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (r && r.ok) { try { cache.put(req, r.clone()); } catch (_) {} }
      resolve(r);
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // 写请求永不接管

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;     // 跨源（云函数 API / COS 图）直连
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isDoc = req.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/');

  if (isDoc) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const fresh = await netFirst(req, cache, NET_TIMEOUT);
      if (fresh) return fresh;
      return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match('./index.html', { ignoreSearch: true }))
          || Response.error();
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      e.waitUntil(fetch(req).then((r) => {
        if (r && r.ok && r.type === 'basic') return cache.put(req, r.clone());
      }).catch(() => {}));
      return hit;
    }
    const r = await fetch(req).catch(() => null);
    if (r && r.ok && r.type === 'basic') { try { cache.put(req, r.clone()); } catch (_) {} }
    return r || Response.error();
  })());
});
