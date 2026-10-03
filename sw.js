/* 扬帆OS · Service Worker
 * 目标：桌面安装（独立窗口 + 图标）、二次打开秒开、断网可用。
 *
 * 策略（v3.1，2026-10-03 加固——用户唯一要求「稳定、不会出错」）：
 *   · 文档（导航请求 / index.html）：**缓存优先 + 后台静默更新**。
 *       - 改为缓存优先的原因（v3 实测踩到）：v3 的「网络优先」在真实浏览器里
 *         **从未把 index.html 写进缓存**（缓存只有 CORE 的 4 个图标），断网能用
 *         全靠 Chromium 的 HTTP 磁盘缓存（GitHub 只给 max-age=600）⇒ 超过 10 分钟
 *         断网即打不开。改为缓存优先后，离线窗口从 10 分钟提升到**无限期**。
 *       - 版本仍会自动前进：命中缓存时**同时**后台拉新版并回写，下次打开即新版。
 *       - 无缓存（首次访问）走网络并**显式等待回写**，确保一定落盘。
 *       - 极端情况（首次访问 + 断网）返回可读的 503 提示页，而不是空白。
 *   · 其余同源静态（图标等小文件）：**缓存优先 + 后台补更新**。
 *   · 只接管同源 GET；云函数 API 与 COS 图片均为跨源，一律直连不插手。
 *
 * 版本升级纪律：**改任何 sw.js 行为都必须同步改 CACHE 常量**（yf-os-vN 递增），
 *   activate 会自动清掉旧缓存。否则老用户拿不到新策略——这是 v2→v3 踩到的点。
 *   该纪律由 tools/gates/sw_selfcheck.js 断言把守（CACHE 缺失 / 无 v 号 → 红）。
 */
const CACHE = 'yf-os-v4';

/* 预缓存清单：**只放小体积、且导航分支之外仍需要的资产**。
   ⚠️ 刻意不含 './index.html'——导航请求由 fetch 处理器按需回写（见文首策略说明），
   在 install 阶段预缓存它只会造成首次访问**双下载** 4.4 MB，对 20 站弱网是净负收益。 */
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

/** 网络优先，带超时；成功则回写缓存。超时/失败返回 null。
 *  当前**仅被测/将来复用**保留：v3.1 起导航分支改用「缓存优先」，
 *  非导航分支本来就是「缓存优先」，故本函数暂无调用方。
 *  ⚠️ 保留是按「宁可留着不带隐患」——它是纯函数、无副作用、不注册任何监听器，
 *  留着不增加任何运行时行为。若将来确认不再需要，可安全删除。 */
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
      /* 🔴 v3.1 关键修正（2026-10-03 实测发现）：
         v3 用「网络优先」，实测**导航请求从未被写进缓存**（缓存里只有 CORE 的 4 个图标）——
         断网能用只是因为 Chromium 的 HTTP 磁盘缓存（GitHub 给 max-age=600），
         超过 10 分钟断网就会打不开。根因：首次导航的响应早于 SW 激活即发出，不经本处理器；
         而后续导航虽经本处理器，netFirst 把响应交给浏览器后，cache.put 的 clone 落盘
         在导航这种 4.4 MB 大响应上不可靠。
         ⇒ 改为「**缓存优先 + 后台静默更新**」：
            · 有缓存 → 立刻返回缓存（**保证断网可用 + 秒开**，不再受 max-age=600 限制）
            · 同时后台 fetch 最新版并回写（下次打开就是新版）⇒ 版本仍会自动前进，不会卡旧版
            · 无缓存（首次访问）→ 走网络，成功后**显式 await 回写**，确保一定进缓存
         代价：用户可能**这次**打开看到的是上一版（差异通常只在下次打开时体现）。
         这正是「稳定优先」的取舍——明确选「永远打得开」而不是「永远最新」。
         注：GitHub Pages 的 Cache-Control 只有 max-age=600，SW 缓存不受其约束，
             故本策略把「离线窗口」从 10 分钟提升到**无限期**。 */
      const cached = await cache.match(req, { ignoreSearch: true })
                  || await cache.match('./index.html', { ignoreSearch: true });

      /* 后台更新：不 await，失败静默（不能影响本次打开） */
      const bg = fetch(req).then(async (r) => {
        if (r && r.ok) { try { await cache.put(req, r.clone()); } catch (_) {} }
        return r;
      }).catch(() => null);

      if (cached) {
        e.waitUntil(bg);       // 延长 SW 生命周期，保证后台写入完成
        return cached;
      }
      const fresh = await bg;  // 首次访问：等网络，确保写入完成再交付
      if (fresh) return fresh;
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>扬帆OS · 离线</title>' +
        '<div style="font-family:system-ui;padding:40px;text-align:center;color:#0d2c4d">' +
        '<h2>暂时无法打开</h2><p>首次使用需要联网加载一次，之后即可离线使用。</p>' +
        '<p>请连接网络后重试。</p></div>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
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
