/* 扬帆OS · Service Worker
 * 目标：桌面安装（独立窗口 + 图标）、二次打开秒开、断网可用。
 *
 * 策略（v3，2026-10-03 加固——用户唯一要求「稳定、不会出错」）：
 *   · 文档（导航请求 / index.html）：**网络优先 + 12s 超时回退本地缓存**。
 *       - 超时从 v2 的 4s 提到 12s：GitHub Pages 边缘节点在东南亚（实测 2.06 MB 需 20s），
 *         v2 会在 4s 时**中止正在下载的响应**改读旧缓存 ⇒「新版永远装不上、一直看旧版」。
 *         12s 覆盖绝大多数真实网络；断网是**立即失败**、不等待超时，回退依旧瞬发。
 *       - 刻意不在 install 阶段预缓存 index.html：网络优先策略下预缓存只增加
 *         **双下载**（白白多耗一个 4.4 MB），断网可用性由「成功 fetch 后自动回写」保证。
 *   · 其余同源静态（图标等小文件）：**缓存优先 + 后台补更新**（不变，本就正确）。
 *   · 只接管同源 GET；云函数 API 与 COS 图片均为跨源，一律直连不插手。
 *
 * 版本升级纪律：**改任何 sw.js 行为都必须同步改 CACHE 常量**（yf-os-vN 递增），
 *   activate 会自动清掉旧缓存。否则老用户拿不到新策略——这是 v2→v3 踩到的点。
 *   该纪律由 tools/gates/sw_selfcheck.js 断言把守（CACHE 缺失 / 无 v 号 → 红）。
 */
const CACHE = 'yf-os-v3';
const NET_TIMEOUT = 12000;

/* 预缓存清单：**只放小体积、且「网络优先」拿不到或拿不稳的资产**。
   ⚠️ 刻意不含 './index.html'——理由见上方注释（避免双下载 4.4 MB）。 */
const CORE = [
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
