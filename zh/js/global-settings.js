/*
 * global-settings.js —— EmbyPro v1.2.5「全局设置」自包含模块
 *
 * 移植基准：EmbyTok 1.5.19
 *   services/prefs.ts:400-401, 671-683    fontSizePx 12~22 / applyFontSize
 *   services/theme.ts:9-46                ThemeMode auto/dark/light
 *   services/netSelector.ts:12-25         NetMode auto/lan/wan（本工程复用 emby_net_mode）
 *   StandardRoot.tsx:673-681              embyOrientationMode both/horizontal/vertical
 *   services/prefs.ts:412-419, 498-501    缓存 4 项档位 + 默认值
 *   LibrarySelect.tsx:1613-1641           媒体库可见性 embyHiddenLibs
 *   LibrarySelect.tsx:146-203             服务器地址 ping 测速并显示
 *
 * 与参考版的差异（工程为原生 JS + Tailwind rem 布局，不是 React）：
 *   - 字号：参考版改 root font-size，会连带缩放图标与圆圈；本工程改为「只给含文字的
 *     元素设置 font-size」，完全不碰 root，因此图标、圆形底板、播放视频文件名 100% 不变。
 *   - 白天模式：只对浏览类界面（设置页 / 媒体库弹窗 / 演员弹窗 / 账号面板）生效，
 *     播放页保持黑，与参考版一致。
 *   - 网络模式：复用本工程已有的 emby_net_mode / EmbyProAccount.setNetMode。
 *   - 视频方向：参考版是服务端查询参数，本工程在取片后按视频宽高做客户端过滤。
 *
 * 只读 window.app / DOM / localStorage / CacheStorage，不改动多服务器数据层。
 */
(function () {
    'use strict';

    const FONT_KEY = 'embyFontPx';
    const THEME_KEY = 'embyThemeMode';
    const ORIENT_KEY = 'embyOrientationMode';
    const CACHE_KEY = 'embyCachePrefs';
    const HIDDEN_KEY = 'embyHiddenLibs';
    const IDX_KEY = 'embyproCacheIndex';
    const CACHE_NAME = 'embypro-media-v1';
    let lastWarmAt = 0;   // v1.2.12：上次「图片预热入缓存」时间（10 分钟节流）
    const STYLE_ID = 'epg-style';

    const FONT_MIN = 12, FONT_MAX = 22, FONT_DEF = 17;   // v1.3.2：出厂默认 17px
    const CACHE_DEFAULTS = { cacheLimitMB: 512, cacheCurrentSec: 300, preloadNextSec: 60, cacheMaxAgeH: 168 };
    const CACHE_LIMIT_OPTIONS = [0, 256, 512, 1024, 2048];
    const CURRENT_OPTIONS = [0, 60, 300, 900, 1800, -1];   // -1 = 不限
    const PRELOAD_OPTIONS = [0, 15, 30, 60, 120, 300];
    const CLEAN_OPTIONS = [24, 72, 168];

    let app = null;
    let fontPx = FONT_DEF;
    let fontTimer = null;
    let fontObserver = null;

    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const toast = msg => { if (app && typeof app.showToast === 'function') app.showToast(msg); };
    function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

    // ═══════════════════ ① 全局字体（只改文字，不动图标 / 圆圈 / 视频名） ═══════════════════

    /** 只处理「自己带文本」的元素，跳过图标、输入框、播放视频名与图标区域面板 */
    const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, SVG: 1, I: 1, IMG: 1, VIDEO: 1, CANVAS: 1, INPUT: 1,
                        TEXTAREA: 1, SELECT: 1, PATH: 1, CIRCLE: 1, RECT: 1, LINE: 1, POLYLINE: 1, POLYGON: 1, G: 1 };
    function hasOwnText(el) {
        for (let i = 0; i < el.childNodes.length; i++) {
            const n = el.childNodes[i];
            if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return true;
        }
        return false;
    }
    function fontSkipped(el) {
        if (!el || el.nodeType !== 1) return true;
        if (SKIP_TAGS[el.tagName] || el.hasAttribute('data-lucide')) return true;
        if (el.id === 'videoTitle' || el.id === 'buttonPrefsModal' || el.id === 'progressOSD') return true;
        if (el.closest('#videoTitle, #buttonPrefsModal, #progressOSD')) return true;
        // v1.2.8：进度时间行有专属「时间字号」滑块，内联字号会压过其 CSS（内联值阻断继承），必须整行跳过
        if (el.id === 'progressTimeRow' || el.closest('#progressTimeRow')) return true;
        if (el.classList && el.classList.contains('epg-no-font')) return true;
        return false;
    }
    /** scale=1 时移除内联字号，恢复 100% 原生外观；其余按「基准字号 × 倍率」逐元素设置 */
    function applyFont(px) {
        const scale = px / FONT_DEF;
        const list = document.body ? document.body.querySelectorAll('*') : [];
        for (let i = 0; i < list.length; i++) {
            const el = list[i];
            if (fontSkipped(el) || !hasOwnText(el)) continue;
            if (scale === 1) {
                if (el.style && el.style.fontSize) el.style.fontSize = '';
                continue;
            }
            let base = el.dataset ? el.dataset.epgFontBase : null;
            if (!base) {
                try { base = parseFloat(getComputedStyle(el).fontSize) || FONT_DEF; } catch (e) { base = FONT_DEF; }
                if (el.dataset) el.dataset.epgFontBase = String(base);
            }
            const v = (parseFloat(base) * scale).toFixed(2);
            if (el.style) el.style.fontSize = v + 'px';
        }
    }
    function setFont(px) {
        const v = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(Number(px) || FONT_DEF)));
        fontPx = v;
        lsSet(FONT_KEY, String(v));
        applyFont(v);
        const out = $('epgFontValue');
        if (out) out.textContent = v + 'px';
        const inp = $('epgFontRange');
        if (inp) inp.value = String(v);
        return v;
    }
    /** 给「浏览类界面」打标：白天模式只作用于这些容器，播放页保持黑 */
    function markLight() {
        const sels = ['#profilePage', '#libraryModal > div.relative', '#addToPlaylistModal > div.relative',
                      '#actorsModal > div.relative', '#accountPanel .ep-panel', '#epLoginPanel .ep-panel'];
        sels.forEach(sel => {
            try { document.querySelectorAll(sel).forEach(el => el.classList.add('epg-light-ui')); }
            catch (e) { }
        });
    }
    function watchFont() {
        if (fontObserver || !window.MutationObserver || !document.body) return;
        fontObserver = new MutationObserver(() => {
            markLight();
            if (fontPx === FONT_DEF) return;
            clearTimeout(fontTimer);
            fontTimer = setTimeout(() => applyFont(fontPx), 140);
        });
        // 只观察子节点变化：applyFont 自身改 style（属性）不会自触发
        fontObserver.observe(document.body, { childList: true, subtree: true });
    }

    // ═══════════════════ ② 主题（自动 / 白天 / 夜间） ═══════════════════

    function themeMode() {
        const m = lsGet(THEME_KEY, 'dark');
        return (m === 'auto' || m === 'light') ? m : 'dark';
    }
    function resolvedTheme() {
        const m = themeMode();
        if (m !== 'auto') return m;
        try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
        catch (e) { return 'dark'; }
    }
    function applyTheme() {
        const light = resolvedTheme() === 'light';
        if (document.documentElement) document.documentElement.classList.toggle('epg-theme-light', light);
        syncSegments();
    }
    function setTheme(m) {
        const v = (m === 'auto' || m === 'light') ? m : 'dark';
        lsSet(THEME_KEY, v);
        applyTheme();
        toast('主题：' + (v === 'auto' ? '自动（跟随系统）' : v === 'light' ? '白天' : '夜间'));
    }

    // ═══════════════════ ③ 网络（自动 / 内网 / 外网） ═══════════════════

    function netMode() {
        const A = window.EmbyProAccount;
        return (A && typeof A.getNetMode === 'function') ? A.getNetMode() : 'auto';
    }
    function setNet(m) {
        const A = window.EmbyProAccount;
        if (A && typeof A.setNetMode === 'function') A.setNetMode(m);
        else lsSet('emby_net_mode', m);
        if (window.EmbyProUI && typeof window.EmbyProUI.refreshNetMode === 'function') {
            try { window.EmbyProUI.refreshNetMode(); } catch (e) { }
        }
        syncSegments();
        toast('网络：' + (m === 'lan' ? '内网（主 > 备）' : m === 'wan' ? '外网' : '自动（主 > 备 > 外网）'));
    }

    // ═══════════════════ ④ 视频方向（全部 / 横向 / 竖向） ═══════════════════

    function orientation() {
        const m = lsGet(ORIENT_KEY, 'both');
        return (m === 'horizontal' || m === 'vertical') ? m : 'both';
    }
    function setOrientation(m) {
        const v = (m === 'horizontal' || m === 'vertical') ? m : 'both';
        lsSet(ORIENT_KEY, v);
        syncSegments();
        toast('视频方向：' + (v === 'both' ? '全部' : v === 'horizontal' ? '横向' : '竖向'));
        // 立即按新方向重取当前列表
        if (app && typeof app.fetchVideos === 'function') {
            const lib = app.state && app.state.currentLibraryId;
            const arg = (!lib || lib === 'favorites') ? null : lib;
            try { app.fetchVideos(arg); } catch (e) { }
        }
    }
    /** 从 MediaSources / 顶层字段猜视频方向；拿不到尺寸时返回 null（不参与过滤） */
    function itemOrientation(item) {
        if (!item) return null;
        const ms = (item.MediaSources && item.MediaSources[0]) || {};
        const streams = ms.MediaStreams || [];
        const vs = streams.find(s => s && s.Type === 'Video') || {};
        const w = Number(item.Width || vs.Width || 0);
        const h = Number(item.Height || vs.Height || 0);
        if (!w || !h) return null;
        return w >= h ? 'horizontal' : 'vertical';
    }
    function filterByOrientation(items, mode) {
        if (!mode || mode === 'both' || !Array.isArray(items)) return items;
        return items.filter(x => {
            const o = itemOrientation(x);
            return o === null || o === mode;   // 尺寸未知的视频保留，避免误伤
        });
    }

    // ═══════════════════ ⑤ 缓存设置 ═══════════════════

    function cachePrefs() {
        let o = {};
        try { o = JSON.parse(lsGet(CACHE_KEY, '{}')) || {}; } catch (e) { }
        const valid = (v, arr, def) => arr.indexOf(Number(v)) >= 0 ? Number(v) : def;
        return {
            cacheLimitMB: valid(o.cacheLimitMB, CACHE_LIMIT_OPTIONS, CACHE_DEFAULTS.cacheLimitMB),
            cacheCurrentSec: valid(o.cacheCurrentSec, CURRENT_OPTIONS, CACHE_DEFAULTS.cacheCurrentSec),
            preloadNextSec: valid(o.preloadNextSec, PRELOAD_OPTIONS, CACHE_DEFAULTS.preloadNextSec),
            cacheMaxAgeH: valid(o.cacheMaxAgeH, CLEAN_OPTIONS, CACHE_DEFAULTS.cacheMaxAgeH)
        };
    }
    function saveCachePrefs(patch) {
        const p = Object.assign(cachePrefs(), patch || {});
        lsSet(CACHE_KEY, JSON.stringify(p));
        renderCache();
        return p;
    }
    function readIndex() {
        try { const v = JSON.parse(lsGet(IDX_KEY, '[]')); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }
    function writeIndex(arr) { lsSet(IDX_KEY, JSON.stringify(arr.slice(-500))); }
    /** 记录一次缓存写入（供后续接入视频预加载；同时让「已用缓存」统计真实可用） */
    function noteCache(key, bytes) {
        const arr = readIndex().filter(x => x && x.k !== key);
        arr.push({ k: String(key), b: Number(bytes) || 0, t: Date.now() });
        writeIndex(arr);
    }
    function cacheStats() {
        const idx = readIndex();
        let bytes = 0;
        idx.forEach(x => { bytes += x.b || 0; });
        // 列表/媒体库缓存也算进「已用」
        ['emby_views_cache', 'emby_favorites', 'emby_actor_cache'].forEach(k => {
            const v = lsGet(k, ''); if (v) bytes += v.length;
        });
        return { files: idx.length, bytes: bytes };
    }
    /** v1.2.10：真实缓存统计 —— 条数取 CacheStorage 实际键数，占用优先取真实用量
     *  v1.2.12：改为逐条累加 blob 体积（抽样 60 条按比例外推）+ storage.estimate 取大值，
     *  这样即使 SW 未控制页面（首次启动 / WebView 不支持）也能看到真实数字 */
    async function cacheStatsReal() {
        let files = 0, bytes = 0;
        try {
            if (window.caches && typeof caches.open === 'function') {
                const c = await caches.open(CACHE_NAME);
                const keys = await c.keys();
                files = keys.length;
                const sample = keys.slice(0, 60);
                let sb = 0;
                for (const k of sample) {
                    try {
                        const r = await c.match(k, { ignoreVary: true });
                        if (!r) continue;
                        const b = await r.clone().blob();
                        sb += b.size || 0;
                    } catch (e) { }
                }
                if (sample.length && files > sample.length) sb = Math.round(sb * files / sample.length);
                bytes = sb;
            }
        } catch (e) { }
        try {
            if (navigator.storage && typeof navigator.storage.estimate === 'function') {
                const est = await navigator.storage.estimate();
                if (est && Number(est.usage) > bytes) bytes = Number(est.usage);
            }
        } catch (e) { }
        if (!files && !bytes) { const s = cacheStats(); files = s.files; bytes = s.bytes; }
        return { files, bytes };
    }

    /** v1.2.12：把当前页面上已经显示的图片（海报 / 演员 / 媒体库封面）复制进 CacheStorage。
     *  不依赖 Service Worker 控制：SW 生效时后续请求直接命中，SW 不生效时至少「已用缓存」是真实数据。 */
    async function warmImageCache(max = 120) {
        if (!window.caches || typeof caches.open !== 'function') return 0;
        let added = 0;
        try {
            const c = await caches.open(CACHE_NAME);
            const urls = new Set();
            document.querySelectorAll('img[src]').forEach(img => {
                const s = img.currentSrc || img.src || '';
                if (/^https?:/i.test(s) && /\/Images\/|\.(webp|jpe?g|png)(\?|$)/i.test(s)) urls.add(s);
            });
            const list = Array.from(urls).slice(0, max);
            for (const u of list) {
                try {
                    if (await c.match(u, { ignoreVary: true })) continue;
                    let res = null;
                    try { res = await fetch(u, { mode: 'cors', credentials: 'omit' }); }
                    catch (e) { res = await fetch(u, { mode: 'no-cors', credentials: 'omit' }); }
                    if (!res) continue;
                    if (res.ok || res.type === 'opaque') {
                        await c.put(u, res.clone());
                        added++;
                    }
                } catch (e) { }
            }
        } catch (e) { }
        return added;
    }
    /** v1.2.13 第 3 项：宫格每次渲染后自动预热（此前只有打开缓存设置面板才预热，
     *  用户浏览到的多数图片永远进不了缓存）。3 分钟节流，只补未缓存的图。 */
    let lastAutoWarmAt = 0;
    async function autoWarmImageCache() {
        if (Date.now() - lastAutoWarmAt < 3 * 60 * 1000) return;
        lastAutoWarmAt = Date.now();
        try { await warmImageCache(60); } catch (e) { }
    }

    async function clearCache() {        let n = 0;
        try {
            if (window.caches && typeof caches.delete === 'function') {
                await caches.delete(CACHE_NAME); n++;
            }
        } catch (e) { }
        ['emby_views_cache', 'emby_actor_cache'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { } });
        lsSet(IDX_KEY, '[]');
        renderCache();
        toast('缓存已清理');
        return n;
    }
    /** 启动时按「自动清理时长 / 缓存上限」剔除过期与超额条目（LRU） */
    async function enforceCache() {
        const p = cachePrefs();
        const maxAgeMs = p.cacheMaxAgeH * 3600 * 1000;
        let arr = readIndex().filter(x => x && (Date.now() - (x.t || 0)) <= maxAgeMs);
        const maxBytes = p.cacheLimitMB * 1024 * 1024;
        if (p.cacheLimitMB > 0 && maxBytes > 0) {
            let total = arr.reduce((s, x) => s + (x.b || 0), 0);
            if (total > maxBytes) {
                arr.sort((a, b) => (a.t || 0) - (b.t || 0));
                while (arr.length && total > maxBytes) { const x = arr.shift(); total -= (x.b || 0); }
            }
        }
        writeIndex(arr);
        if (window.caches && typeof caches.open === 'function') {
            try {
                const c = await caches.open(CACHE_NAME);
                const keys = await c.keys();
                for (let i = 0; i < keys.length; i++) {
                    const r = await c.match(keys[i]);
                    if (!r) continue;
                    // v1.2.10：优先读 SW 打的 x-cached-at 戳，回退服务器 date
                    const raw = r.headers && (r.headers.get('x-cached-at') || r.headers.get('date'));
                    const t = raw ? (Number(raw) || Date.parse(raw) || 0) : 0;
                    if (t && Date.now() - t > maxAgeMs) await c.delete(keys[i]);
                }
            } catch (e) { }
        }
    }

    const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB'
        : b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';
    const optLabel = (v, unit, never) => v === 0 ? '关闭' : (v < 0 ? (never || '不限') : v + unit);
    function segHtml(group, field, options, cur, labels) {
        return `<div class="epg-seg" data-epg-group="${group}" data-epg-field="${field}">` +
            options.map((v, i) => `<button type="button" class="epg-seg-btn ${Number(cur) === Number(v) ? 'on' : ''}"
                data-epg-value="${esc(v)}">${esc(labels[i])}</button>`).join('') + '</div>';
    }
    function renderCache() {
        const box = $('epgCacheBody');
        if (!box) return;
        const p = cachePrefs();
        const st = cacheStats();
        const row = (title, field, options, cur, labels) =>
            `<div class="epg-row"><span class="epg-lb">${title}</span>
                ${segHtml('cache', field, options, cur, labels)}</div>`;
        box.innerHTML =
            row('缓存上限', 'cacheLimitMB', CACHE_LIMIT_OPTIONS, p.cacheLimitMB,
                CACHE_LIMIT_OPTIONS.map(v => v === 0 ? '关闭' : v + 'MB')) +
            row('当前视频缓存', 'cacheCurrentSec', CURRENT_OPTIONS, p.cacheCurrentSec,
                CURRENT_OPTIONS.map(v => optLabel(v, 's', '不限'))) +
            row('下一条预加载', 'preloadNextSec', PRELOAD_OPTIONS, p.preloadNextSec,
                PRELOAD_OPTIONS.map(v => optLabel(v, 's'))) +
            row('自动清理', 'cacheMaxAgeH', CLEAN_OPTIONS, p.cacheMaxAgeH, ['24小时', '3天', '7天']) +
            `<div class="epg-row"><span class="epg-lb">已用缓存</span>
                <span class="epg-val" id="epgCacheUsed">${fmtSize(st.bytes)} · ${st.files} 个文件</span></div>
             <div class="epg-hint" style="padding:2px 2px 0;">v1.2.13：海报/图片真实写入本机缓存，浏览列表时自动预热（APK 内已接通 Service Worker，缓存优先读取），条数与占用为实测值</div>
             <button type="button" id="epgCacheClearBtn" class="epg-btn">立即清理缓存</button>`;
        bindCache(box);
        // v1.2.12：打开缓存面板时先把当前页面已显示的图片收进 CacheStorage（10 分钟内只做一次），
        // 再异步刷新真实条数与字节数 —— 不再依赖 SW 是否成功接管页面
        const refreshStats = () => cacheStatsReal().then(rs => {
            const el = $('epgCacheUsed');
            if (el) el.textContent = fmtSize(rs.bytes) + ' · ' + rs.files + ' 个文件';
        }).catch(() => { });
        if (Date.now() - lastWarmAt > 10 * 60 * 1000) {
            lastWarmAt = Date.now();
            warmImageCache(80).then(refreshStats).catch(refreshStats);
        } else {
            refreshStats();
        }
        // 向 SW 同步自动清理时长
        try {
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage(
                    { type: 'embypro-cache-prefs', prefs: { maxAgeH: p.cacheMaxAgeH } });
            }
        } catch (e) { }
    }
    function bindCache(box) {
        box.querySelectorAll('[data-epg-group="cache"] .epg-seg-btn').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const field = btn.closest('.epg-seg').dataset.epgField;
                const v = Number(btn.dataset.epgValue);
                saveCachePrefs({ [field]: v });
                enforceCache();
            };
        });
        const clr = $('epgCacheClearBtn');
        if (clr) clr.onclick = e => { e.stopPropagation(); clearCache(); };
    }

    // ═══════════════════ ⑥ 媒体库可见性（折叠 + 调整图标） ═══════════════════

    function hiddenLibs() {
        try { const v = JSON.parse(lsGet(HIDDEN_KEY, '[]')); return Array.isArray(v) ? v.map(String) : []; }
        catch (e) { return []; }
    }
    function isHidden(id) { return id != null && hiddenLibs().indexOf(String(id)) >= 0; }
    function toggleHidden(id) {
        const k = String(id);
        const arr = hiddenLibs();
        const i = arr.indexOf(k);
        if (i >= 0) arr.splice(i, 1); else arr.push(k);
        lsSet(HIDDEN_KEY, JSON.stringify(arr));
        renderVisibility();
        toast(i >= 0 ? '已显示该媒体库' : '已隐藏该媒体库');
        if (app && typeof app.renderLibraryItems === 'function') {
            try {
                const c = JSON.parse(lsGet('emby_views_cache', '{}'));
                if (c.views && c.playlists) app.renderLibraryItems(c.playlists, c.views);
            } catch (e) { }
        }
    }
    function renderVisibility() {
        const box = $('epgVisibilityBody');
        if (!box) return;
        let views = [];
        try {
            const c = JSON.parse(lsGet('emby_views_cache', '{}'));
            views = ((c.views && c.views.Items) || []).filter(x => x &&
                x.CollectionType !== 'playlists' && x.CollectionType !== 'boxsets');
        } catch (e) { }
        if (!views.length) {
            box.innerHTML = '<div class="epg-hint">打开一次「媒体库」后即可在此调整可见性</div>';
            return;
        }
        const hid = hiddenLibs();
        box.innerHTML = '<div class="epg-vis-grid">' + views.map(v => {
            const off = hid.indexOf(String(v.Id)) >= 0;
            return `<button type="button" class="epg-vis ${off ? 'off' : ''}" data-epg-vis="${esc(v.Id)}">
                <i data-lucide="${off ? 'eye-off' : 'eye'}" class="w-3.5 h-3.5"></i>
                <span>${esc(v.Name || '媒体库')}</span></button>`;
        }).join('') + '</div>';
        box.querySelectorAll('[data-epg-vis]').forEach(btn => {
            btn.onclick = e => { e.stopPropagation(); toggleHidden(btn.dataset.epgVis); };
        });
        if (window.lucide) { try { window.lucide.createIcons({ root: box }); } catch (e) { } }
    }

    // ═══════════════════ ⑦ 分段按钮 / 折叠区 ═══════════════════

    function syncSegments() {
        const vals = { net: netMode(), theme: themeMode(), orientation: orientation() };
        document.querySelectorAll('.epg-seg[data-epg-group]').forEach(seg => {
            const g = seg.dataset.epgGroup;
            if (g === 'cache') return;
            const cur = String(vals[g] || '');
            seg.querySelectorAll('.epg-seg-btn').forEach(b => {
                b.classList.toggle('on', String(b.dataset.epgValue) === cur);
            });
        });
    }
    function bindFold() {
        document.querySelectorAll('[data-epg-fold]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const id = btn.dataset.epgFold;
                const body = $(id);
                if (!body) return;
                const open = body.classList.toggle('epg-open');
                btn.classList.toggle('open', open);
                const ic = btn.querySelector('[data-epg-chev]');
                if (ic) ic.style.transform = open ? 'rotate(90deg)' : '';
                if (open && id === 'epgCacheBody') renderCache();
                if (open && id === 'epgVisibilityBody') renderVisibility();
            };
        });
    }
    function bindSegments() {
        document.querySelectorAll('.epg-seg[data-epg-group]').forEach(seg => {
            if (seg.dataset.epgGroup === 'cache') return;
            seg.querySelectorAll('.epg-seg-btn').forEach(btn => {
                btn.onclick = e => {
                    e.stopPropagation();
                    const g = seg.dataset.epgGroup, v = btn.dataset.epgValue;
                    if (g === 'net') setNet(v);
                    else if (g === 'theme') setTheme(v);
                    else if (g === 'orientation') setOrientation(v);
                };
            });
        });
        syncSegments();
    }
    function bindFont() {
        const inp = $('epgFontRange');
        if (inp) inp.oninput = () => setFont(inp.value);
        const minus = $('epgFontMinus'), plus = $('epgFontPlus');
        if (minus) minus.onclick = e => { e.stopPropagation(); setFont(fontPx - 1); };
        if (plus) plus.onclick = e => { e.stopPropagation(); setFont(fontPx + 1); };
    }

    // ═══════════════════ ⑧ 亮色主题 CSS ═══════════════════

    function ensureStyle() {
        if ($(STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
            /* v1.2.5 白天模式：只作用于浏览类界面，播放页保持黑 */
            html.epg-theme-light .epg-light-ui { background:rgba(244,246,245,.97) !important; color:#1f2937 !important; }
            html.epg-theme-light .epg-light-ui .text-white { color:#111827 !important; }
            html.epg-theme-light .epg-light-ui .text-gray-200,
            html.epg-theme-light .epg-light-ui .text-gray-300 { color:#4b5563 !important; }
            html.epg-theme-light .epg-light-ui .text-gray-400,
            html.epg-theme-light .epg-light-ui .text-gray-500 { color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .bg-gray-800\\/40 { background:rgba(255,255,255,.72) !important; border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .bg-black\\/25,
            html.epg-theme-light .epg-light-ui .bg-black\\/40,
            html.epg-theme-light .epg-light-ui .bg-black\\/50,
            html.epg-theme-light .epg-light-ui .bg-black\\/60 { background:rgba(0,0,0,.045) !important; border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .border-white\\/10,
            html.epg-theme-light .epg-light-ui .border-white\\/5 { border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .bg-white\\/10 { background:rgba(0,0,0,.05) !important; }
            html.epg-theme-light .epg-light-ui input,
            html.epg-theme-light .epg-light-ui select { background:rgba(255,255,255,.85) !important; color:#111827 !important; border-color:rgba(0,0,0,.14) !important; }
            /* v1.2.12 第 3 项：白天模式下设置页 / 媒体库的白色、灰色文字统一转深色（白底白字看不见）。
               用属性子串选择器覆盖所有带透明度后缀的写法（text-white/80、text-gray-300 等） */
            html.epg-theme-light .epg-light-ui [class*="text-white"] { color:#111827 !important; }
            html.epg-theme-light .epg-light-ui [class*="text-gray-1"],
            html.epg-theme-light .epg-light-ui [class*="text-gray-2"],
            html.epg-theme-light .epg-light-ui [class*="text-gray-3"],
            html.epg-theme-light .epg-light-ui [class*="text-gray-4"] { color:#374151 !important; }
            html.epg-theme-light .epg-light-ui [class*="text-gray-5"] { color:#4b5563 !important; }
            html.epg-theme-light .epg-light-ui [class*="text-zinc-3"],
            html.epg-theme-light .epg-light-ui [class*="text-slate-3"] { color:#374151 !important; }
            /* 设置页组件（样式表里写死 rgba(255,255,255,…) 的部分） */
            html.epg-theme-light .epg-light-ui .epg-lb { color:#374151 !important; }
            html.epg-theme-light .epg-light-ui .epg-val { color:#15803d !important; }
            html.epg-theme-light .epg-light-ui .epg-row { background:rgba(255,255,255,.82) !important; border-color:rgba(0,0,0,.08) !important; }
            html.epg-theme-light .epg-light-ui .epg-seg-btn { color:#374151 !important;
                background:rgba(0,0,0,.05) !important; border-color:rgba(0,0,0,.12) !important; }
            /* v1.2.15 第 16 项：三态分段按钮选中态与小标题（内联白字）白天模式转深色 */
            html.epg-theme-light .epg-light-ui .epg-seg-btn.on { color:#111827 !important;
                background:rgba(82,181,75,.90) !important; border-color:#52B54B !important; }
            html.epg-theme-light .epg-light-ui div[style*="rgba(255,255,255,.62)"] { color:#374151 !important; }
            html.epg-theme-light .epg-light-ui .epg-btn { color:#14532d !important;
                background:rgba(82,181,75,.22) !important; border-color:rgba(82,181,75,.55) !important; }
            html.epg-theme-light .epg-light-ui .epg-hint { color:#4b5563 !important; }
            html.epg-theme-light .epg-light-ui .epg-vis { color:#14532d !important;
                background:rgba(82,181,75,.14) !important; }
            html.epg-theme-light .epg-light-ui .epg-vis.off { color:#6b7280 !important;
                background:rgba(0,0,0,.05) !important; border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .epg-fold-btn { color:#1f2937 !important;
                background:rgba(255,255,255,.9) !important; border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .epg-sec-head { color:#14532d !important;
                background:rgba(82,181,75,.16) !important; }
            /* 媒体库弹窗（lib-tile / 折叠行 / 副服务器卡片） */
            html.epg-theme-light .epg-light-ui .lib-tile { color:#1f2937 !important;
                background:rgba(255,255,255,.92) !important; border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .lib-tile.on { color:#14532d !important;
                background:rgba(82,181,75,.20) !important; border-color:#52B54B !important; }
            /* v1.2.13 第 1 项：白天模式下账号与服务器面板的卡片也转深色文字（.ep-* 组件） */
            html.epg-theme-light .epg-light-ui .ep-card { background:rgba(255,255,255,.88) !important;
                border-color:rgba(0,0,0,.10) !important; }
            html.epg-theme-light .epg-light-ui .ep-card.on { background:rgba(82,181,75,.14) !important;
                border-color:rgba(82,181,75,.55) !important; }
            html.epg-theme-light .epg-light-ui .ep-sub,
            html.epg-theme-light .epg-light-ui .ep-label,
            html.epg-theme-light .epg-light-ui .ep-hint,
            html.epg-theme-light .epg-light-ui .ep-foot,
            html.epg-theme-light .epg-light-ui .ep-empty,
            html.epg-theme-light .epg-light-ui .ep-section-title,
            html.epg-theme-light .epg-light-ui .ep-check { color:#4b5563 !important; }
            html.epg-theme-light .epg-light-ui .ep-tag { color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .ep-badge-off { background:rgba(0,0,0,.08) !important; color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .ep-icon-btn { background:rgba(0,0,0,.05) !important; color:#4b5563 !important; }
            html.epg-theme-light .epg-light-ui .ep-offline { background:rgba(0,0,0,.05) !important; color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .ep-btn-soft { background:rgba(0,0,0,.06) !important; color:#374151 !important; }
            html.epg-theme-light .epg-light-ui .ep-btn-off { background:rgba(0,0,0,.05) !important; color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .ep-btn-del-soft { background:rgba(220,38,38,.10) !important; color:#b91c1c !important; }
            html.epg-theme-light .epg-light-ui .ep-btn-edit { background:rgba(82,181,75,.16) !important; color:#14532d !important; }
            html.epg-theme-light .epg-light-ui .ep-close { background:rgba(0,0,0,.05) !important; color:#374151 !important; }
            html.epg-theme-light .epg-light-ui .ep-mode { background:rgba(82,181,75,.14) !important; color:#14532d !important; }
            html.epg-theme-light .epg-light-ui .ep-ping-off { background:rgba(0,0,0,.06) !important; color:#6b7280 !important; }
            html.epg-theme-light .epg-light-ui .ep-input { background:#ffffff !important; color:#111827 !important;
                border-color:rgba(0,0,0,.14) !important; }
            html.epg-theme-light .epg-light-ui .ep-input::placeholder { color:#9ca3af !important; }
            html.epg-theme-light .epg-light-ui .ep-edit,
            html.epg-theme-light .epg-light-ui .ep-addrform { background:rgba(255,255,255,.92) !important;
                border-color:rgba(0,0,0,.10) !important; }
            /* 设置页组件 */
            .epg-row { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap;
                padding:6px 10px; border-radius:10px; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.06); margin-bottom:6px; }
            .epg-lb { font-size:11px; color:rgba(255,255,255,.72); flex-shrink:0; }
            .epg-val { font-size:10px; color:#8dd18a; font-variant-numeric:tabular-nums; }
            .epg-seg { display:flex; flex-wrap:wrap; gap:3px; justify-content:flex-end; }
            .epg-seg-btn { padding:3px 7px; border-radius:7px; font-size:10px; font-weight:800; white-space:nowrap;
                color:rgba(255,255,255,.68); background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.10); }
            .epg-seg-btn.on { color:#fff; background:rgba(82,181,75,.38); border-color:#52B54B; }
            .epg-btn { width:100%; margin-top:6px; padding:7px 0; border-radius:9px; font-size:11px; font-weight:800;
                color:#fff; background:rgba(82,181,75,.28); border:1px solid rgba(82,181,75,.55); }
            .epg-fold-body { display:none; padding:8px 2px 2px; }
            .epg-fold-body.epg-open { display:block; }
            .epg-vis-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
            .epg-vis { display:flex; align-items:center; gap:5px; padding:6px 7px; border-radius:9px; font-size:10px;
                color:#d3f0ce; background:rgba(82,181,75,.16); border:1px solid rgba(82,181,75,.30); }
            .epg-vis span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
            .epg-vis.off { color:rgba(255,255,255,.40); background:rgba(255,255,255,.06); border-color:rgba(255,255,255,.10); text-decoration:line-through; }
            .epg-hint { font-size:10px; color:rgba(255,255,255,.45); line-height:1.5; padding:4px 2px; }
            [data-epg-chev] { transition:transform .18s; display:inline-block; }
            /* v1.2.7 第 1 项：文件夹列表恢复显示左下角四宫格（v1.2.5 的隐藏规则已删除）。
               仅隐藏左下角工具列（播放页专用），底部导航保留可交互。 */
            .folder-list-active .left-toolbar { display:none !important; }
            /* v1.2.5 页码跳转浮层 */
            #gridPageJumpModal { position:fixed; inset:0; z-index:95; display:flex; align-items:center; justify-content:center; }
            #gridPageJumpModal.hidden { display:none !important; }
            #gridPageJumpModal .card { width:76%; max-width:300px; padding:16px; border-radius:16px;
                background:rgba(24,24,26,.96); border:1px solid rgba(255,255,255,.16); color:#fff; }
            #gridPageJumpModal input { width:100%; margin:10px 0 12px; padding:8px 10px; border-radius:9px;
                background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.18); color:#fff; outline:none; }
            /* v1.2.5 媒体库弹窗：一行三个的小方块与副服务器折叠行 */
            .lib-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
                min-height:52px; padding:7px 4px; border-radius:12px; font-size:11px; font-weight:800;
                color:#e5e7eb; background:rgba(255,255,255,.10); border:1px solid rgba(255,255,255,.10);
                text-align:center; overflow:hidden; }
            .lib-tile:hover { background:rgba(255,255,255,.16); }
            .lib-tile:active { transform:scale(.95); }
            .lib-tile.on { color:#a9dfa2; background:rgba(82,181,75,.22); border-color:#52B54B; }
            .epg-fold-btn { display:flex; align-items:center; gap:6px; width:100%; margin-top:10px;
                padding:8px 10px; border-radius:11px; font-size:11px; font-weight:800; color:#e5e7eb;
                background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.10); text-align:left; }
            .epg-fold-btn.open { border-color:rgba(82,181,75,.55); }
            .epg-sec-group { margin-bottom:6px; }
            .epg-sec-head { display:flex; align-items:center; gap:6px; width:100%; padding:7px 9px;
                border-radius:9px; font-size:11px; font-weight:800; color:#d3f0ce;
                background:rgba(82,181,75,.14); border:1px solid rgba(82,181,75,.28); }
            /* 长按进入文件夹后，当前视频卡片的定位标记 */
            .epg-focus-item { outline:3px solid #52B54B !important; outline-offset:2px !important; }
        `;
        document.head.appendChild(st);
    }

    // ═══════════════ ⑩ v1.2.12：播放背景 / 删除确认 的模糊层与透明度 ═══════════════

    const PLAYBG_KEY = 'emby_playbg';
    const DELBG_KEY = 'emby_delbg';
    /** v1.2.13 第 2 项：模糊层开关 → 模糊度滑杆（px，0=不模糊）。
     *  旧版布尔 blur 字段平滑迁移：false=0，true/未设置=默认模糊度 */
    function bgPrefs(key, defOpacity, defBlur) {
        let o = {};
        try { o = JSON.parse(lsGet(key, '{}')) || {}; } catch (e) { }
        const op = Number(o.opacity);
        let bp = Number(o.blurPx);
        if (!isFinite(bp)) bp = (o.blur === false ? 0 : defBlur);
        return {
            blurPx: Math.min(60, Math.max(0, Math.round(bp))),
            opacity: isFinite(op) ? Math.min(100, Math.max(0, op)) : defOpacity
        };
    }
    function getPlayBg() { return bgPrefs(PLAYBG_KEY, 70, 24); }
    function getDelBg() { return bgPrefs(DELBG_KEY, 40, 6); }
    function setBgPrefs(key, patch) {
        const cur = key === PLAYBG_KEY ? getPlayBg() : getDelBg();
        try { lsSet(key, JSON.stringify(Object.assign({}, cur, patch))); } catch (e) { }
        if (key === PLAYBG_KEY) applyPlayBg(); else applyDelBg();
        syncBgControls();
    }
    /** 播放背景 = 视频未铺满时垫在下面的模糊海报层（poster-N）+ 黑色压暗层 */
    function applyPlayBg() {
        const p = getPlayBg();
        document.querySelectorAll('#videoContainer [id^="poster-"]').forEach(el => {
            el.style.filter = p.blurPx > 0 ? `blur(${p.blurPx}px)` : 'none';
            if (el.dataset.bgOn === '1') el.style.opacity = String(p.opacity / 100);
        });
        document.querySelectorAll('#videoContainer [id^="overlay-"]').forEach(el => {
            el.style.opacity = el.dataset.bgOn === '1' ? '1' : '0';
        });
    }
    /** 删除确认 = 弹窗的浮动卡片本身（v1.2.15 第 12 项：模糊度/透明度控制浮窗，
     *  不再控制背后的全屏遮罩）。带 !important 的内联注入保证必生效 */
    function applyDelBg() {
        const el = $('deleteModalCard');
        if (!el) return;
        const p = getDelBg();
        const blur = p.blurPx > 0 ? `blur(${p.blurPx}px)` : 'none';
        try {
            el.style.setProperty('backdrop-filter', blur, 'important');
            el.style.setProperty('-webkit-backdrop-filter', blur, 'important');
            el.style.setProperty('background', `rgba(0,0,0,${(p.opacity / 100).toFixed(2)})`, 'important');
        } catch (e) { }
    }
    function syncBgControls() {
        const pb = $('epgPlayBgBlur'), pv = $('epgPlayBgBlurVal');
        const pob = $('epgPlayBgOpacity'), pt = $('epgPlayBgOpacityVal');
        const db = $('epgDelBgBlur'), dv = $('epgDelBgBlurVal');
        const dob = $('epgDelBgOpacity'), dt = $('epgDelBgOpacityVal');
        const p = getPlayBg(), d = getDelBg();
        if (pb) pb.value = String(p.blurPx);
        if (pv) pv.textContent = p.blurPx + 'px';
        if (pob) pob.value = String(p.opacity);
        if (pt) pt.textContent = p.opacity + '%';
        if (db) db.value = String(d.blurPx);
        if (dv) dv.textContent = d.blurPx + 'px';
        if (dob) dob.value = String(d.opacity);
        if (dt) dt.textContent = d.opacity + '%';
    }
    function bindBackgrounds() {
        syncBgControls();
        const pb = $('epgPlayBgBlur');
        if (pb) pb.oninput = () => setBgPrefs(PLAYBG_KEY, { blurPx: Number(pb.value) });
        const pv = $('epgPlayBgOpacity');
        if (pv) pv.oninput = () => setBgPrefs(PLAYBG_KEY, { opacity: Number(pv.value) });
        const db = $('epgDelBgBlur');
        if (db) db.oninput = () => setBgPrefs(DELBG_KEY, { blurPx: Number(db.value) });
        const dv = $('epgDelBgOpacity');
        if (dv) dv.oninput = () => setBgPrefs(DELBG_KEY, { opacity: Number(dv.value) });
        // v1.2.14 第 4 项：四根滑杆左右补 −/+ 微调按钮（与「全局字体」一致）
        const pair = (idMinus, idPlus, key, field, step, max) => {
            const cur = () => (key === PLAYBG_KEY ? getPlayBg() : getDelBg())[field];
            const m = $(idMinus), p = $(idPlus);
            if (m) m.onclick = e => { e.stopPropagation(); setBgPrefs(key, { [field]: Math.max(0, cur() - step) }); };
            if (p) p.onclick = e => { e.stopPropagation(); setBgPrefs(key, { [field]: Math.min(max, cur() + step) }); };
        };
        pair('epgPlayBgBlurMinus', 'epgPlayBgBlurPlus', PLAYBG_KEY, 'blurPx', 1, 40);
        pair('epgPlayBgOpacityMinus', 'epgPlayBgOpacityPlus', PLAYBG_KEY, 'opacity', 5, 100);
        pair('epgDelBgBlurMinus', 'epgDelBgBlurPlus', DELBG_KEY, 'blurPx', 1, 24);
        pair('epgDelBgOpacityMinus', 'epgDelBgOpacityPlus', DELBG_KEY, 'opacity', 5, 100);
        applyPlayBg();
        applyDelBg();
    }

    // ═══════════════════ ⑨ 初始化 ═══════════════════

    function init(appInstance) {
        app = appInstance || null;
        ensureStyle();
        markLight();
        // v1.3.2：覆盖安装后一次性把字体默认落到 17px（之后用户可自由调整）
        try {
            if (localStorage.getItem('embyFontPx_v132') !== '1') {
                lsSet(FONT_KEY, String(FONT_DEF));
                localStorage.setItem('embyFontPx_v132', '1');
            }
        } catch (e) { }
        fontPx = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(Number(lsGet(FONT_KEY, FONT_DEF)) || FONT_DEF)));
        applyFont(fontPx);
        watchFont();
        applyTheme();
        bindFont();
        bindBackgrounds();
        bindSegments();
        bindFold();
        renderCache();
        enforceCache();
        try {
            const mq = window.matchMedia('(prefers-color-scheme: light)');
            if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (themeMode() === 'auto') applyTheme(); });
        } catch (e) { }
        // 取片后按方向过滤（客户端实现，尺寸未知的视频保留）
        if (app && typeof app.fetchVideos === 'function' && !app.__epgFetchWrapped) {
            app.__epgFetchWrapped = true;
            // 在 fetchVideos 内部读取 window.EmbyProGlobalSettings.getOrientation()，
            // 这里只暴露接口；index.html 的取片逻辑已加入过滤语句。
        }
    }

    window.EmbyProGlobalSettings = {
        init,
        getFont: () => fontPx, setFont,
        getTheme: themeMode, setTheme,
        getNet: netMode, setNet,
        getOrientation: orientation, setOrientation,
        filterByOrientation, itemOrientation,
        getCachePrefs: cachePrefs, saveCachePrefs, clearCache, cacheStats, noteCache, enforceCache,
        getPlayBg, getDelBg, applyPlayBg, applyDelBg, warmImageCache, autoWarmImageCache,
        hiddenLibs, isHidden, toggleHidden, renderVisibility,
        syncSegments, renderCache, markLight
    };
})();
