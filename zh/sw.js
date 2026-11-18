const MEDIA_CACHE = 'embypro-media-v1';
const MAX_ENTRIES = 400;          // 海报/图片缓存条数上限（LRU 裁剪）
let prefs = { maxAgeH: 168 };     // 自动清理时长，由页面经 postMessage 同步

// 安装阶段：不强制缓存大量资源，保持轻量
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

// activate 阶段：接管页面并清理过期缓存
self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        await clients.claim();
        await trimCache();
    })());
});

// 页面同步缓存偏好（当前仅自动清理时长）
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'embypro-cache-prefs' && event.data.prefs) {
        prefs = Object.assign(prefs, event.data.prefs);
        trimCache().catch(() => {});
    }
});

function isImageRequest(req, url) {
    if (req.method !== 'GET') return false;
    if (req.destination === 'image') return true;
    if (/\/Images\//.test(url.pathname)) return true;      // Emby / Jellyfin 海报接口
    if (/\.(webp|png|jpe?g|gif|svg|avif)([?#]|$)/i.test(url.pathname)) return true;
    return false;
}

/** LRU + 过期裁剪：条数超限删最旧，超过自动清理时长的删除 */
async function trimCache() {
    try {
        const c = await caches.open(MEDIA_CACHE);
        const keys = await c.keys();
        const maxAgeMs = (Number(prefs.maxAgeH) || 168) * 3600 * 1000;
        const entries = [];
        for (const k of keys) {
            const r = await c.match(k);
            const t = r ? (Number(r.headers.get('x-cached-at')) || Date.parse(r.headers.get('date') || 0) || 0) : 0;
            if (t && Date.now() - t > maxAgeMs) { await c.delete(k); continue; }
            entries.push({ k, t });
        }
        entries.sort((a, b) => a.t - b.t);
        while (entries.length > MAX_ENTRIES) {
            await c.delete(entries.shift().k);
        }
    } catch (e) { /* 裁剪失败不影响正常响应 */ }
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (e) { return; }

    if (!isImageRequest(req, url)) {
        // 非图片（页面/接口/视频流）一律透传，异常时优雅兜底
        event.respondWith(
            fetch(req).catch(() => new Response('', { status: 408, statusText: 'Request Timeout' }))
        );
        return;
    }

    // 图片（海报 / 演员 / 媒体库封面）：缓存优先，未命中拉取后入缓存
    event.respondWith((async () => {
        try {
            const c = await caches.open(MEDIA_CACHE);
            const hit = await c.match(req, { ignoreVary: true });
            if (hit) return hit;
            const res = await fetch(req);
            if (res && (res.ok || res.type === 'opaque')) {
                try {
                    const body = await res.clone().blob();
                    const stored = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
                    stored.headers.set('x-cached-at', String(Date.now()));
                    await c.put(req, stored);
                    if (Math.random() < 0.08) trimCache().catch(() => {});
                } catch (e) { /* 入缓存失败不影响本次显示 */ }
            }
            return res;
        } catch (e) {
            try { return await fetch(req); } catch (e2) {
                return new Response('', { status: 408, statusText: 'Request Timeout' });
            }
        }
    })());
});
