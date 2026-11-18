/*
 * actors.js —— EmbyPro v1.2.2 媒体库「所有媒体 / 演员 / 收藏」三按钮（自包含模块）
 *
 * 移植基准：EmbyTok 1.5.19 components/LibrarySelect.tsx
 *   :1190-1215  三个与媒体库卡片同尺寸的按钮（Folder / Users / Star）
 *   :345-361    getLibraryPersons(null) 全服务器演员；EmbyClient.ts:685-739 /Persons + 兜底
 *   :216-248    localStorage['embyActorFavs'] + mergeServerFavs（服务端 IsFavorite 合并）
 *   :1776-1880  演员视图：搜索框 + 6 种排序 + 人物卡片 + 星标收藏
 *   :994-1003   点演员卡片 → person:<id> → getPersonItems(PersonIds=...)
 *
 * 颜色保持 EmbyPro 绿 #52B54B；不引用参考版全局对象。
 */
(function () {
    'use strict';

    const FAV_KEY = 'embyActorFavs';
    const MODAL_ID = 'actorsModal';
    const SORT_KEY = 'embyActorSort';
    let app = null;
    let modalEl = null;
    let mode = 'actors';           // 'actors' | 'fav'
    let persons = [];
    let currentPerson = null;      // v1.2.12：当前正在浏览作品的演员
    let keyword = '';
    let sortBy = 'name-asc';

    const SORTS = [
        ['name-asc', '名称 A→Z'], ['name-desc', '名称 Z→A'],
        ['date-desc', '入库 新→旧'], ['date-asc', '入库 旧→新'],
        ['rating-desc', '评分 高→低'], ['rating-asc', '评分 低→高']
    ];

    function cfg() { return (app && app.config) || {}; }
    function toast(msg) { if (app && typeof app.showToast === 'function') app.showToast(msg); }

    /** 关闭媒体库弹窗（与工程既有 MODAL_IDS / input 层级逻辑保持一致） */
    function dismissLibrary() {
        if (app && typeof app.closeAllModals === 'function') {
            app.closeAllModals();
        } else {
            const el = document.getElementById('libraryModal');
            if (el) el.classList.add('hidden');
        }
    }

    function readFavs() {
        try {
            const v = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
            return Array.isArray(v) ? v : [];
        } catch (e) { return []; }
    }
    function writeFavs(list) {
        try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch (e) { }
    }
    function isFav(id) { return readFavs().some(p => String(p.Id) === String(id)); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function personImg(p) {
        const c = cfg();
        if (!p || !p.Id) return 'img/avatar.webp';
        const tag = (p.ImageTags && p.ImageTags.Primary) || p.PrimaryImageTag;
        if (!tag) return 'img/avatar.webp';
        return `${c.server}/emby/Items/${encodeURIComponent(p.Id)}/Images/Primary?MaxWidth=240&Quality=85&Tag=${encodeURIComponent(tag)}&api_key=${encodeURIComponent(c.token || '')}`;
    }

    function mergeServerFavs(list) {
        const favs = readFavs();
        const map = new Map(favs.map(p => [String(p.Id), p]));
        (list || []).forEach(p => {
            if (p && p.Id && p.UserData && p.UserData.IsFavorite && !map.has(String(p.Id))) {
                map.set(String(p.Id), p);
            }
        });
        writeFavs(Array.from(map.values()));
    }

    // ── 三个入口 ──────────────────────────────────────────────
    /** 所有媒体：不带 ParentId、不带 Filters 的全量列表（对齐 1.5.19 onSelect(null)） */
    function openAllMedia() {
        if (!app) return;
        const s = app.state;
        s.currentLibraryId = 'all';
        s.currentLibraryType = 'library';
        s.currentPerson = null;
        s.currentTag = null;
        s.searchTerm = '';
        s.isFilteredByPerson = false;
        s.isFilteredByTag = false;
        s.startIndex = 0;
        try {
            localStorage.setItem('emby_lib_id', 'all');
            localStorage.setItem('emby_lib_type', 'library');
            // v1.2.4：「所有媒体」不是具体媒体库，清掉名称避免底部文件夹误用旧库名
            localStorage.setItem('emby_lib_name', '');
        } catch (e) { }
        // 「所有媒体」是全局视图：先退出头像长按/底部文件夹进入的临时文件夹状态，
        // 否则 fetchVideos 仍会走 drama 的 ParentId 混排分支。
        if (window.EmbyProFolderNav && typeof EmbyProFolderNav.exitFolder === 'function') {
            EmbyProFolderNav.exitFolder();
        }
        dismissLibrary();
        close();
        app.fetchVideos('all', null, false, false);
        toast('所有媒体');
    }

    // ═══════════ v1.2.15 第 11 项：演员数据后台预加载 ═══════════
    const PERSONS_CACHE_KEY = 'emby_persons_cache';
    function readPersonCache() {
        try {
            const j = JSON.parse(localStorage.getItem(PERSONS_CACHE_KEY) || 'null');
            return (j && Array.isArray(j.items)) ? j : null;
        } catch (e) { return null; }
    }
    function writePersonCache(items) {
        try {
            localStorage.setItem(PERSONS_CACHE_KEY,
                JSON.stringify({ ts: Date.now(), items: items.slice(0, 2000) }));
        } catch (e) { }
    }
    /** 打开 app 约 1 分钟后后台拉一次全量演员并写缓存；进面板先读缓存秒开，再静默刷新 */
    function schedulePreload() {
        if (window.__epgPersonsPreloaded) return;
        window.__epgPersonsPreloaded = true;
        setTimeout(() => {
            try {
                if (mode) return;   // 面板已打开则无需预载
                if (!(window.EmbyXCommon && EmbyXCommon.getLibraryPersons)) return;
                EmbyXCommon.getLibraryPersons(cfg()).then(list => {
                    if (Array.isArray(list) && list.length) writePersonCache(list);
                }).catch(() => { });
            } catch (e) { }
        }, 60000);
    }

    async function openActors() {
        mode = 'actors';
        keyword = '';
        try { sortBy = localStorage.getItem(SORT_KEY) || 'name-asc'; } catch (e) { }
        dismissLibrary();
        show();
        render();
        // v1.2.15 第 11 项：有预载缓存时先秒开，再后台静默刷新
        const cached = readPersonCache();
        if (cached && cached.items.length && window.EmbyXCommon && EmbyXCommon.getLibraryPersons) {
            persons = cached.items;
            mergeServerFavs(persons);
            render();
            EmbyXCommon.getLibraryPersons(cfg()).then(list => {
                if (Array.isArray(list) && list.length) writePersonCache(list);
                if (mode !== 'actors') return;
                persons = list;
                mergeServerFavs(persons);
                render();
            }).catch(() => { });
            return;
        }
        if (app && typeof app.toggleLoading === 'function') app.toggleLoading(true);
        const list = await (window.EmbyXCommon && EmbyXCommon.getLibraryPersons
            ? EmbyXCommon.getLibraryPersons(cfg()) : Promise.resolve([]));
        if (app && typeof app.toggleLoading === 'function') app.toggleLoading(false);
        persons = Array.isArray(list) ? list : [];
        mergeServerFavs(persons);
        if (!persons.length) toast('未获取到演员数据');
        render();
        if (Array.isArray(list) && list.length) writePersonCache(list);
    }

    function openFavorites() {
        mode = 'fav';
        keyword = '';
        persons = readFavs();
        dismissLibrary();
        show();
        render();
        // v1.2.12：本机收藏可能因清缓存/换机丢失，再从服务端同步一次「已收藏的演员」补进来
        if (window.EmbyXCommon && EmbyXCommon.getFavoritePersons) {
            EmbyXCommon.getFavoritePersons(cfg()).then(list => {
                if (mode !== 'fav' || !Array.isArray(list) || !list.length) return;
                // 服务端已收藏的演员直接并入本机收藏（不要求 UserData 字段齐全）
                const map = new Map(readFavs().map(p => [String(p.Id), p]));
                list.forEach(p => { if (p && p.Id && !map.has(String(p.Id))) map.set(String(p.Id), p); });
                writeFavs(Array.from(map.values()));
                persons = readFavs();
                render();
            }).catch(() => { });
        }
    }

    async function toggleFav(p) {
        if (!p || !p.Id) return;
        const favs = readFavs();
        const has = isFav(p.Id);
        writeFavs(has ? favs.filter(x => String(x.Id) !== String(p.Id)) : favs.concat([p]));
        if (window.EmbyXCommon && typeof EmbyXCommon.syncFavoriteStatus === 'function') {
            const c = cfg();
            try {
                await EmbyXCommon.syncFavoriteStatus({
                    server: c.server, token: c.token, userId: c.userId,
                    itemId: p.Id, isFav: !has,
                    deviceName: c.deviceName, deviceId: c.deviceId, appVersion: c.appVersion
                });
            } catch (e) { }
        }
        toast(has ? '已取消收藏演员' : '已收藏演员');
        if (mode === 'fav') persons = readFavs();
        render();
    }

    /** 点演员卡片 → 该演员作品（PersonIds 优先，回退 Person 名称） */
    async function openPersonItems(p) {
        if (!app || !p) return;
        if (app.toggleLoading) app.toggleLoading(true);
        let data = await (window.EmbyXCommon && EmbyXCommon.getPersonItems
            ? EmbyXCommon.getPersonItems(cfg(), p.Id, p.Name)
            : Promise.resolve({ Items: [] }));
        if (!data || !data.Items || !data.Items.length) {
            // 兜底：按姓名走工程原有 Person 参数
            data = await (window.EmbyXCommon && EmbyXCommon.getPersonItems
                ? EmbyXCommon.getPersonItems(cfg(), null, p.Name)
                : Promise.resolve({ Items: [] }));
        }
        if (app.toggleLoading) app.toggleLoading(false);
        const s = app.state;
        s.personVideos = (data && data.Items) || [];
        s.personTotalCount = (data && data.TotalRecordCount) || s.personVideos.length;
        s.currentPerson = p.Name;
        currentPerson = p;   // v1.2.12：保留演员对象，供右下角收藏按钮使用
        s.currentTag = null;
        s.searchTerm = '';
        s.isFilteredByTag = false;
        s.isFilteredByPerson = true;
        // v1.2.14 第 6 项：记录从哪个入口进入（actors=演员面板 / fav=演员收藏），供媒体库回显选中态
        s.personEntry = mode;
        s.startIndex = 0;
        s.viewMode = 'grid';
        if (window.EmbyProFolderNav && typeof EmbyProFolderNav.exitFolder === 'function') {
            EmbyProFolderNav.exitFolder();
        }
        dismissLibrary();
        close();
        const appEl = document.getElementById('app');
        if (appEl) { appEl.classList.remove('interface-hidden'); appEl.classList.add('grid-active'); }
        if (app.dom && app.dom.videoContainer) app.dom.videoContainer.style.touchAction = 'auto';
        const viewBtn = document.getElementById('viewModeBtn');
        if (viewBtn) {
            viewBtn.innerHTML = '<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>';
            if (window.lucide) window.lucide.createIcons({ root: viewBtn });
        }
        if (typeof app.renderGridView === 'function') app.renderGridView();
        try { syncPersonView(); } catch (e) { }
        toast('演员：' + p.Name);
    }

    // ── 面板 DOM ──────────────────────────────────────────────
    function visiblePersons() {
        let list = mode === 'fav' ? readFavs() : persons.slice();
        if (keyword) {
            const k = keyword.toLowerCase();
            list = list.filter(p => String(p.Name || '').toLowerCase().indexOf(k) >= 0);
        }
        const val = p => (p && p.PremiereDate) ? String(p.PremiereDate) : (p && p.DateCreated) || '';
        const rating = p => Number((p && p.CommunityRating) || (p && p.OfficialRating) || 0) || 0;
        list.sort((a, b) => {
            switch (sortBy) {
                case 'name-desc': return String(b.Name || '').localeCompare(String(a.Name || ''), 'zh');
                case 'date-desc': return val(b).localeCompare(val(a));
                case 'date-asc': return val(a).localeCompare(val(b));
                case 'rating-desc': return rating(b) - rating(a);
                case 'rating-asc': return rating(a) - rating(b);
                default: return String(a.Name || '').localeCompare(String(b.Name || ''), 'zh');
            }
        });
        return list;
    }

    function ensureModal() {
        if (modalEl) return modalEl;
        modalEl = document.createElement('div');
        modalEl.id = MODAL_ID;
        modalEl.className = 'fixed inset-0 z-[70] hidden flex items-center justify-center';
        document.body.appendChild(modalEl);
        return modalEl;
    }

    function render() {
        if (!modalEl) return;
        const list = visiblePersons();
        const isActors = mode === 'actors';
        const cards = list.length ? list.map((p, i) => `
            <div class="epa-card relative flex flex-col items-center gap-1 p-1 rounded-lg cursor-pointer
                        bg-black/30 border border-white/10 active:scale-[.97] transition-transform" data-i="${i}">
                <img src="${esc(personImg(p))}" alt="" loading="lazy" onerror="this.src='img/avatar.webp'"
                     class="w-full aspect-[3/4] object-cover rounded-md bg-white/5">
                <span class="w-full text-center text-[9px] leading-tight text-white/90 truncate">${esc(p.Name)}</span>
                <button class="epa-star absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center
                               bg-black/60 border border-white/10" data-fav="${i}" title="收藏演员">
                    <i data-lucide="star" class="w-3 h-3 ${isFav(p.Id) ? 'text-amber-300' : 'text-white/60'}"></i>
                </button>
            </div>`).join('')
            : `<div class="col-span-6 text-center text-gray-400 text-xs py-10">
                ${isActors ? (persons.length ? '没有匹配的演员' : '正在加载演员…') : '还没有收藏的演员'}
               </div>`;

        modalEl.innerHTML = `
            <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" data-close="1"></div>
            <div class="relative z-10 w-[92%] max-w-lg max-h-[80vh] flex flex-col rounded-2xl p-4
                        bg-[#18181b]/95 border border-white/10 backdrop-blur-xl shadow-2xl">
                <div class="flex items-center gap-2 pb-3 mb-3 border-b border-white/10 flex-shrink-0">
                    <i data-lucide="${isActors ? 'users' : 'star'}" class="w-4 h-4 text-[#8dd18a]"></i>
                    <h3 class="text-white text-sm font-bold flex-1">${isActors ? '演员' : '收藏的演员'}</h3>
                    <button class="text-gray-400 hover:text-white text-xs px-2 py-1" data-close="1">关闭</button>
                </div>
                ${isActors ? `
                <div class="flex gap-2 mb-3 flex-shrink-0">
                    <input id="epaSearch" type="search" value="${esc(keyword)}" placeholder="搜索演员…"
                           class="flex-1 min-w-0 h-8 px-3 rounded-lg bg-black/40 text-white text-xs outline-none border border-white/10 focus:border-[#52B54B]">
                    <select id="epaSort" class="h-8 px-2 rounded-lg bg-black/40 text-white text-xs outline-none border border-white/10">
                        ${SORTS.map(([k, t]) => `<option value="${k}" ${k === sortBy ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>` : ''}
                <div class="flex-1 overflow-y-auto overscroll-contain">
                    <div class="grid grid-cols-6 gap-1">${cards}</div>
                </div>
                <p class="text-[10px] text-gray-500 mt-3 flex-shrink-0">共 ${list.length} 位 · 点卡片查看作品，点星标${isActors ? '收藏' : '取消收藏'}</p>
            </div>`;

        modalEl.querySelectorAll('[data-close]').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); close(); };
        });
        const search = modalEl.querySelector('#epaSearch');
        if (search) {
            search.oninput = () => {
                keyword = search.value;
                const active = document.activeElement === search;
                const pos = search.selectionStart;
                render();
                const s2 = modalEl.querySelector('#epaSearch');
                if (s2 && active) { s2.focus(); try { s2.setSelectionRange(pos, pos); } catch (e) { } }
            };
        }
        const sel = modalEl.querySelector('#epaSort');
        if (sel) sel.onchange = () => {
            sortBy = sel.value;
            try { localStorage.setItem(SORT_KEY, sortBy); } catch (e) { }
            render();
        };
        modalEl.querySelectorAll('[data-i]').forEach(el => {
            el.onclick = (e) => {
                if (e.target.closest('[data-fav]')) return;
                e.stopPropagation();
                openPersonItems(list[Number(el.dataset.i)]);
            };
        });
        modalEl.querySelectorAll('[data-fav]').forEach(el => {
            el.onclick = (e) => { e.stopPropagation(); toggleFav(list[Number(el.dataset.fav)]); };
        });
        if (window.lucide) window.lucide.createIcons({ root: modalEl });
    }

    function show() {
        ensureModal();
        render();
        modalEl.classList.remove('hidden');
    }
    function close() {
        if (modalEl) modalEl.classList.add('hidden');
    }

    function init(appInstance) {
        app = appInstance || null;
        ensureModal();
        schedulePreload();   // v1.2.15 第 11 项：app 打开约 1 分钟后后台预载演员数据
        const map = [
            ['libAllBtn', openAllMedia],
            ['libActorsBtn', openActors],
            ['libActorFavBtn', openFavorites]
        ];
        map.forEach(([id, fn]) => {
            const el = document.getElementById(id);
            if (el) el.onclick = (e) => { e.stopPropagation(); fn(); };
        });
        // v1.2.12 第 8 项：演员作品列表的右下角「收藏该演员」
        const favBtn = document.getElementById('personFavBtn');
        if (favBtn) favBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!currentPerson) return;
            // v1.2.13：按名字进入的演员视图，Id 可能还没解析完 —— 收藏前再补一次
            if (!currentPerson.Id) {
                if (app && app.toggleLoading) app.toggleLoading(true);
                const p = await resolvePersonByName(currentPerson.Name);
                if (app && app.toggleLoading) app.toggleLoading(false);
                if (p && p.Id) currentPerson = p;
                else { toast('暂未获取到该演员信息，稍后再试'); return; }
            }
            toggleFav(currentPerson).then(syncPersonView).catch(() => { });
        };
        // 视图切换（所有媒体 / 切库 / 退出演员列表）由 renderGridView 统一收尾
        if (app && typeof app.renderGridView === 'function' && !app.__epPersonViewWrapped) {
            app.__epPersonViewWrapped = true;
            const orig = app.renderGridView.bind(app);
            app.renderGridView = function () {
                const r = orig.apply(this, arguments);
                try { syncPersonView(); } catch (e) { }
                return r;
            };
        }
        setTimeout(syncPersonView, 800);
    }

    /** v1.2.13 第 4 项：播放页点头像进入的演员视图只拿得到演员名，
     *  这里按名字补一个演员对象；Id 后台异步解析（用于服务端收藏同步） */
    async function resolvePersonByName(name) {
        const c = cfg();
        if (!c.server || !c.token || !name) return null;
        const url = `${c.server}/emby/Persons?api_key=${encodeURIComponent(c.token)}` +
            `&SearchTerm=${encodeURIComponent(name)}&Limit=10&Fields=PrimaryImageAspectRatio`;
        try {
            const res = await fetch(url, { headers: { 'X-Emby-Token': c.token } });
            if (!res.ok) return null;
            const data = await res.json();
            const items = (data && data.Items) || [];
            return items.find(p => String(p.Name || '') === String(name)) || items[0] || null;
        } catch (e) { return null; }
    }
    function setCurrentPersonByName(name) {
        currentPerson = { Id: '', Name: String(name || '') };
        try { syncPersonView(); } catch (e) { }
        resolvePersonByName(name).then(p => {
            if (p && p.Id && currentPerson && String(currentPerson.Name) === String(name)) {
                currentPerson = p;
                try { syncPersonView(); } catch (e) { }
            }
        }).catch(() => { });
    }

    /** 演员作品列表态：隐藏左下角图标列，右下角显示收藏按钮并同步收藏状态。
     *  v1.2.13：播放页点头像进入时页面会置 isFilteredByPerson 并传演员名，
     *  此处两种路径都识别（isFilteredByPerson 或 currentPerson 有值） */
    function syncPersonView() {
        const on = !!(app && app.state && (app.state.isFilteredByPerson || app.state.currentPerson));
        const appEl = document.getElementById('app');
        if (appEl) appEl.classList.toggle('person-view', on);
        const btn = document.getElementById('personFavBtn');
        if (!btn) return;
        btn.style.display = on ? 'flex' : 'none';
        if (!on) return;
        const fav = currentPerson && currentPerson.Id ? isFav(currentPerson.Id) : false;
        const icon = document.getElementById('personFavIcon');
        if (icon) {
            icon.setAttribute('data-lucide', 'heart');
            icon.classList.toggle('text-secondary', fav);
            icon.classList.toggle('stroke-secondary', fav);
            if (fav) icon.setAttribute('fill', 'currentColor');
            else icon.removeAttribute('fill');
            if (window.lucide && window.lucide.createIcons) {
                window.lucide.createIcons({ attrs: {}, nodes: [icon] });
                // createIcons 会重建 svg，重新补填充色
                const svg = btn.querySelector('svg');
                if (svg) {
                    svg.setAttribute('fill', fav ? 'currentColor' : 'none');
                    svg.classList.toggle('text-secondary', fav);
                }
            }
        }
        btn.title = fav ? '取消收藏该演员' : '收藏该演员';
    }

    window.EmbyProActors = {
        init, openAllMedia, openActors, openFavorites, close,
        /** v1.2.14：当前是否处于「演员作品列表」视图；'actors'=演员入口 / 'fav'=演员收藏入口 / null=否 */
        personEntry: () => (app && app.state && app.state.isFilteredByPerson
            ? (app.state.personEntry === 'fav' ? 'fav' : 'actors') : null),
        setCurrentPersonByName, syncPersonView
    };
})();
