/**
 * EmbyX Grid View & Poster Gallery Controller (Zero-dependency, Vanilla JS)
 * Handles:
 * - 3:4 aspect-ratio card rendering for videos and short drama folders
 * - SafeHeader with pagination (❮ 1/N ❯), shuffle, search toggle, and one-level folder back (❮)
 * - Search bar with composition debounce & tag/actor filtering
 * - Hitokoto footer quote loading & cache
 */
(function (window) {
    'use strict';

    /**
     * v1.2.12 第 9 项：搜索记录（本机保存最近 12 条，聚焦搜索框时展开）
     */
    const SEARCH_HISTORY_KEY = 'emby_search_history';
    function readSearchHistory() {
        try {
            const v = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
            return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
        } catch (e) { return []; }
    }
    function writeSearchHistory(list) {
        try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify((list || []).slice(0, 12))); } catch (e) { }
    }
    function pushSearchTerm(term) {
        const t = String(term || '').trim();
        if (!t) return;
        const list = readSearchHistory();
        // 边输入边搜时只保留最终那次（新词以上一条为前缀就覆盖，避免堆一串半截词）
        if (list[0] && t.length > list[0].length && t.indexOf(list[0]) === 0) list.shift();
        writeSearchHistory([t].concat(list.filter(x => x !== t)));
    }
    function hideSearchHistory() {
        const box = document.getElementById('gridSearchHistory');
        if (box) box.classList.add('hidden');
    }
    function renderSearchHistory() {
        const box = document.getElementById('gridSearchHistory');
        if (!box) return;
        const list = readSearchHistory();
        if (!list.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
        box.classList.remove('hidden');
        box.innerHTML = `
            <div class="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
                <span class="text-[10px]" style="color:rgba(255,255,255,.55)">搜索记录</span>
                <span data-sh-clear="1" class="text-[10px] font-bold" style="color:#8dd18a">清空</span>
            </div>
            ${list.map((t, i) => `
                <div class="flex items-center gap-2 px-3 py-2 active:bg-white/10" data-sh-term="${encodeURIComponent(t)}" data-sh-i="${i}">
                    <i data-lucide="history" class="w-3.5 h-3.5 flex-shrink-0" style="color:rgba(255,255,255,.5)"></i>
                    <span class="flex-1 min-w-0 text-xs text-white truncate">${String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</span>
                    <span data-sh-del="${encodeURIComponent(t)}" class="text-[13px] px-1" style="color:rgba(255,255,255,.45)">×</span>
                </div>`).join('')}`;
        if (window.lucide) window.lucide.createIcons({ root: box });
        box.querySelectorAll('[data-sh-del]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const t = decodeURIComponent(el.dataset.shDel);
                writeSearchHistory(readSearchHistory().filter(x => x !== t));
                renderSearchHistory();
            };
        });
        const clr = box.querySelector('[data-sh-clear]');
        if (clr) clr.onclick = (e) => { e.stopPropagation(); writeSearchHistory([]); renderSearchHistory(); };
        box.querySelectorAll('[data-sh-term]').forEach(el => {
            el.onclick = (e) => {
                e.stopPropagation();
                const t = decodeURIComponent(el.dataset.shTerm);
                pushSearchTerm(t);
                hideSearchHistory();
                const inp = document.getElementById('gridSearchInput');
                if (inp) inp.value = t;
                const gi = (window.app && window.app.grid) || null;
                if (gi && typeof gi.searchVideos === 'function') gi.searchVideos(t);
            };
        });
    }

    /**
     * v1.2.5：页码跳转浮层（对齐 1.5.19 VideoGrid.tsx:560-599）。
     * 自建 DOM 而非 window.prompt —— Android WebView 默认不显示 JS 弹窗。
     */
    function openPageJump(cur, total, onGo) {
        let m = document.getElementById('gridPageJumpModal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'gridPageJumpModal';
            m.className = 'hidden';
            document.body.appendChild(m);
        }
        m.innerHTML = `
            <div class="absolute inset-0 bg-black/60" data-pj-close="1"></div>
            <div class="card relative z-10">
                <div class="text-sm font-bold text-center text-white">跳转到指定页码</div>
                <div id="gridPageJumpHint" class="text-[11px] text-center mt-1" style="color:rgba(255,255,255,.55)"></div>
                <input id="gridPageJumpInput" type="number" inputmode="numeric" min="1" max="${total}" value="${cur}">
                <div class="flex gap-2">
                    <button id="gridPageJumpCancel" class="flex-1 py-2 rounded-lg text-xs font-bold text-white"
                        style="background:rgba(255,255,255,.12)">取消</button>
                    <button id="gridPageJumpGo" class="flex-1 py-2 rounded-lg text-xs font-bold text-white"
                        style="background:#52B54B">跳转</button>
                </div>
            </div>`;
        const hint = document.getElementById('gridPageJumpHint');
        if (hint) hint.textContent = '第 1 ~ ' + total + ' 页';
        const inp = document.getElementById('gridPageJumpInput');
        const go = () => {
            const n = Math.min(total, Math.max(1, parseInt(inp.value, 10) || 1));
            m.classList.add('hidden');
            if (typeof onGo === 'function') onGo(n);
        };
        document.getElementById('gridPageJumpGo').onclick = e => { e.stopPropagation(); go(); };
        document.getElementById('gridPageJumpCancel').onclick = e => { e.stopPropagation(); m.classList.add('hidden'); };
        m.querySelectorAll('[data-pj-close]').forEach(el => {
            el.onclick = e => { e.stopPropagation(); m.classList.add('hidden'); };
        });
        inp.onkeydown = e => { if (e.key === 'Enter') go(); };
        m.classList.remove('hidden');
        try { inp.focus(); inp.select(); } catch (e) { }
    }

    /**
     * v1.2.13 第 5 项：A-Z 快速定位。
     * 中文名取拼音首字母：用 Intl.Collator('zh') 与 26 个字母逐一比较，
     * 落在哪个字母区间就算哪个（英文/数字直接按首字符）。
     */
    let _zhCollator = null;
    function zhCollator() {
        if (!_zhCollator) {
            try { _zhCollator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base' }); }
            catch (e) { _zhCollator = null; }
        }
        return _zhCollator;
    }
    function nameLetter(name) {
        const s = String(name || '').trim();
        if (!s) return '#';
        const c0 = s.charAt(0).toUpperCase();
        if (/[A-Z]/.test(c0)) return c0;
        if (/[0-9]/.test(s.charAt(0))) return '#';
        const col = zhCollator();
        if (!col) return '#';
        const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let cur = '#';
        for (let i = 0; i < L.length; i++) {
            if (col.compare(s, L[i]) >= 0) cur = L[i];
            else break;
        }
        return cur;
    }
    /** 右侧字母索引条：点击字母滚动到该字母第一个视频；列表过短或无字母命中时隐藏 */
    function buildLetterBar(container, scrollArea, letters) {
        let bar = document.getElementById('gridLetterBar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'gridLetterBar';
            if (container) container.appendChild(bar);
        }
        if (!bar || !container) return;
        const present = [];
        const seen = new Set();
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').forEach(L => {
            if (letters.indexOf(L) >= 0 && !seen.has(L)) { seen.add(L); present.push(L); }
        });
        if (letters.length < 20 || present.length < 2) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        bar.innerHTML = present.map(L =>
            `<span data-letter="${L}" style="font-size:9px;line-height:1;padding:1.5px 4px;border-radius:4px;
                color:rgba(255,255,255,.72);font-weight:700;cursor:pointer;user-select:none;">${L}</span>`).join('');
        Object.assign(bar.style, {
            position: 'absolute', right: '1px', top: '96px', bottom: '72px', zIndex: '30',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
            alignItems: 'center', gap: '0.5px', pointerEvents: 'none'
        });
        bar.querySelectorAll('[data-letter]').forEach(sp => {
            sp.addEventListener('click', (e) => {
                e.stopPropagation();
                const L = sp.dataset.letter;
                const idx = letters.indexOf(L);
                if (idx < 0 || !scrollArea) return;
                const el = wrapper_queryCard(idx);
                if (!el) return;
                try {
                    const areaH = scrollArea.clientHeight;
                    scrollArea.scrollTop = el.offsetTop - (areaH / 2 - el.offsetHeight / 2);
                    sp.style.background = 'rgba(82,181,75,.85)';
                    sp.style.color = '#fff';
                    setTimeout(() => { sp.style.background = ''; sp.style.color = ''; }, 600);
                } catch (err) { }
            });
            sp.style.pointerEvents = 'auto';
        });
    }
    function wrapper_queryCard(index) {
        return document.querySelector('#gridScrollArea [data-index="' + index + '"]');
    }

    class GridViewManager {
        constructor(app) {
            this.app = app || null;
            // v1.2.15 第 1 项：多选状态
            this.selOn = false;
            this.selSet = new Set();
            this.__selIds = [];
            this.__gridWrapper = null;
            this.__drag = null;
        }

        render() {
            if (!this.app) return;
            const app = this.app;
            // v1.2.14 第 7 项：短剧模式的列表页隐藏左下角图标列（与演员视图一致）
            try {
                const appEl = document.getElementById('app');
                if (appEl) appEl.classList.toggle('drama-list', !!(app.config && app.config.shortDrama));
            } catch (e) { }

            app.dom.slides = null;
            const container = app.dom.videoContainer;
            if (!container) return;

            document.documentElement.scrollTop = 0;
            container.style.transition = 'none';
            void container.offsetHeight;
            container.style.transform = 'none';

            let bgLayer = container.querySelector('.bg-poster-layer');
            let safeHeader = document.getElementById('gridSafeHeader');
            let searchBar = document.getElementById('gridSearchBar');
            let scrollArea = document.getElementById('gridScrollArea');

            if (!safeHeader || !searchBar || !scrollArea) {
                container.innerHTML = '';
                container.className = 'absolute inset-0 z-10 bg-black/40 overflow-hidden';

                bgLayer = document.createElement('div');
                bgLayer.className = 'bg-poster-layer absolute inset-0 bg-cover bg-center opacity-70 scale-[1.15] blur-xl z-[-1] pointer-events-none';
                container.appendChild(bgLayer);

                scrollArea = document.createElement('div');
                scrollArea.id = 'gridScrollArea';
                scrollArea.className = 'absolute inset-0 overflow-y-auto overflow-x-hidden w-full overscroll-contain z-0';
                scrollArea.style.WebkitOverflowScrolling = 'touch';
                container.appendChild(scrollArea);

                safeHeader = document.createElement('div');
                safeHeader.id = 'gridSafeHeader';
                container.appendChild(safeHeader);

                searchBar = document.createElement('div');
                searchBar.id = 'gridSearchBar';
                safeHeader.appendChild(searchBar);

                let isDown = false, startY, scrollTop;
                scrollArea.addEventListener('mousedown', (e) => {
                    isDown = true;
                    scrollArea.style.cursor = 'grabbing';
                    startY = e.pageY - scrollArea.offsetTop;
                    scrollTop = scrollArea.scrollTop;
                });
                scrollArea.addEventListener('mouseleave', () => { isDown = false; scrollArea.style.cursor = ''; });
                scrollArea.addEventListener('mouseup', () => { isDown = false; scrollArea.style.cursor = ''; });
                scrollArea.addEventListener('mousemove', (e) => {
                    if (!isDown) return;
                    e.preventDefault();
                    const y = e.pageY - scrollArea.offsetTop;
                    const walk = (y - startY) * 2;
                    scrollArea.scrollTop = scrollTop - walk;
                });

                // v1.2.15 第 1 项：多选模式下按住卡片左右拖动连续选择（触摸）。
                // 绑定在只创建一次的 scrollArea 上，卡片重建不影响；用 elementFromPoint
                // 命中手指下的卡片并加入选择，拖动期间 preventDefault 防止页面滚动。
                scrollArea.addEventListener('touchstart', (e) => {
                    if (!this.selOn) return;
                    const t = e.touches[0];
                    // mode: null=未判定 / 'sel'=横向连选 / 'scroll'=纵向滚动（放行原生滚动）
                    this.__drag = { id: t.identifier, x: t.clientX, y: t.clientY, mode: null };
                }, { passive: true });
                scrollArea.addEventListener('touchmove', (e) => {
                    const d = this.__drag;
                    if (!this.selOn || !d) return;
                    const t = Array.from(e.touches).find(x => x.identifier === d.id);
                    if (!t) return;
                    const dx = t.clientX - d.x;
                    const dy = t.clientY - d.y;
                    if (d.mode !== 'sel' && d.mode !== 'scroll') {
                        // 位移不足 10px 时先不判定，等方向明确
                        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
                        // v2.1.12：方向判定——横向分量占优（含斜向）才进入连选；
                        // 纵向为主则标记为滚动手势，不拦截、不选择，列表照常滚动。
                        // 判定一次后本次触摸内锁定，避免中途翻向造成误选。
                        d.mode = (Math.abs(dx) >= Math.abs(dy)) ? 'sel' : 'scroll';
                    }
                    if (d.mode !== 'sel') return;
                    e.preventDefault();
                    const hit = document.elementFromPoint(t.clientX, t.clientY);
                    const card = hit && hit.closest ? hit.closest('[data-sel-id]') : null;
                    if (card) this.toggleSelCard(card.getAttribute('data-sel-id'), true);
                }, { passive: false });
                const dragEnd = () => { this.__drag = null; };
                scrollArea.addEventListener('touchend', dragEnd);
                scrollArea.addEventListener('touchcancel', dragEnd);
            }

            // 背景海报模糊层更新
            const currentVideo = app.state.videos[app.state.currentIndex];
            const bgPosterStr = currentVideo ? app.getImageSrc(currentVideo) : app.getImageSrc(null);
            if (bgPosterStr) {
                bgLayer.style.backgroundImage = `url('${bgPosterStr}')`;
            }

            let libraryName = '全部视频';
            if (app.state.searchTerm) {
                libraryName = `搜索：${app.state.searchTerm}`;
            } else if (app.state.isFilteredByTag && app.state.currentTag) {
                libraryName = `标签：${app.state.currentTag}`;
            } else if (app.state.currentPerson) {
                libraryName = `演员：${app.state.currentPerson}`;
            } else if (app.drama?.currentFolderName) {
                libraryName = app.drama.currentFolderName;
            } else if (app.state.currentLibraryId === 'favorites') {
                libraryName = '收藏夹';
            } else if (app.state.currentLibraryId) {
                const libIdStr = String(app.state.currentLibraryId);
                const cachedViewsStr = localStorage.getItem('emby_views_cache');
                if (cachedViewsStr) {
                    try {
                        const cached = JSON.parse(cachedViewsStr);
                        let found = null;
                        if (cached.views && cached.views.Items) {
                            found = cached.views.Items.find(i => String(i.Id) === libIdStr);
                        }
                        if (!found && cached.playlists && cached.playlists.Items) {
                            found = cached.playlists.Items.find(i => String(i.Id) === libIdStr);
                        }
                        if (found) libraryName = found.Name;
                    } catch (e) { }
                }
            }

            const PAGE_SIZE = 150;
            let totalCount = 0;
            if (app.state.searchTerm) {
                totalCount = typeof app.state.searchTotalCount === 'number' ? app.state.searchTotalCount : (app.state.totalCount || app.state.videos.length);
            } else if (app.state.currentPerson || app.state.isFilteredByTag) {
                totalCount = typeof app.state.personTotalCount === 'number' ? app.state.personTotalCount : app.state.personVideos.length;
            } else {
                totalCount = app.state.totalCount || app.state.videos.length;
            }
            const startIndex = app.state.startIndex || 0;
            const currentPage = Math.floor(startIndex / PAGE_SIZE) + 1;
            const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
            // v1.2.12 第 10 项：左上角数量显示真实总数，不再截断成 999+
            const countStr = String(totalCount);

            safeHeader.className = 'absolute top-0 left-0 right-0 z-20 bg-black/25 backdrop-blur-xl border-b border-white/10 flex flex-col transition-all';
            safeHeader.style.paddingTop = 'var(--safe-top)';

            const isSearchActive = !!app.state.searchTerm;
            const hasFolderBack = !!(app.drama && app.drama.folderStack.length > 0);

            const headerNav = document.createElement('div');
            headerNav.id = 'gridHeaderNav';
            headerNav.className = 'flex items-center gap-2 px-3 h-[60px] w-full';
            headerNav.innerHTML = `
                ${hasFolderBack ? `
                    <button id="gridFolderBackBtn" title="返回上一级" class="p-1 -ml-1 text-gray-300 hover:text-white active:scale-90 transition-transform flex items-center justify-center">
                        <i data-lucide="chevron-left" class="w-5 h-5"></i>
                    </button>
                ` : ''}
                <span id="gridLibName" class="text-sm font-bold text-gray-200 truncate max-w-[40%] flex items-center">${libraryName}</span>
                <span class="text-xs font-bold text-primary/70 tabular-nums flex items-center">
                    ${countStr}
                    ${!app.config.shortDrama ? `
                    <span class="w-1.5"></span>
                    <button id="gridShuffleBtn" title="随机换一批" class="active:scale-90 transition-transform p-[2px] bg-white/10 rounded-full hover:bg-white/20 flex items-center justify-center">
                        <i data-lucide="sparkles" class="w-3.5 h-3.5 text-white"></i>
                    </button>
                    ` : ''}
                </span>
                <span class="flex-1"></span>
                <button id="gridSortBtn" title="排序（名称 / 日期）"
                    class="w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-all text-white hover:text-white/80">
                    <i data-lucide="arrow-up-down" class="w-4 h-4"></i>
                </button>
                <button id="gridFolderSearchBtn" title="搜索"
                    class="w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-all ${isSearchActive ? 'text-primary bg-primary/20' : 'text-white hover:text-white/80'}">
                    <i data-lucide="folder-search" class="w-4 h-4"></i>
                </button>
                <span id="gridPageInfo" class="flex items-center gap-0.5">
                <button id="gridPrevBtn" class="px-1.5 py-0.5 rounded text-xs flex items-center justify-center ${currentPage <= 1 ? 'text-gray-600 pointer-events-none' : 'text-gray-300 active:scale-90 hover:text-white transition-colors'}">❮</button>
                <button id="gridPageJumpBtn" title="点击输入页码跳转"
                    class="px-1 py-0.5 rounded text-xs font-bold text-white tabular-nums flex items-center hover:bg-white/10 active:scale-95 transition-all">${currentPage}<span class="px-0.5">/</span>${totalPages}</button>
                <button id="gridNextBtn" class="px-1.5 py-0.5 rounded text-xs flex items-center justify-center ${currentPage >= totalPages ? 'text-gray-600 pointer-events-none' : 'text-gray-300 active:scale-90 hover:text-white transition-colors'}">❯</button>
                </span>
            `;

            safeHeader.innerHTML = '';
            safeHeader.appendChild(headerNav);
            safeHeader.appendChild(searchBar);

            const sortBtn = document.getElementById('gridSortBtn');
            if (sortBtn) {
                sortBtn.onclick = (e) => {
                    e.stopPropagation();
                    const cur = localStorage.getItem('embyListSort') || 'name';
                    const next = cur === 'name' ? 'date'
                        : cur === 'date' ? 'nameDesc'
                        : cur === 'nameDesc' ? 'dateDesc' : 'name';
                    localStorage.setItem('embyListSort', next);
                    const label = { name: '名称 A→Z', date: '入库 旧→新', nameDesc: '名称 Z→A', dateDesc: '入库 新→旧' }[next];
                    if (app.showToast) app.showToast('排序：' + label);
                    const arr = (app.state.videos || []).slice();
                    const nm = x => String((x && (x.SortName || x.Name)) || '');
                    const dt = x => String((x && (x.DateCreated || x.PremiereDate)) || '');
                    arr.sort((a, b) => {
                        if (next === 'date') return dt(a).localeCompare(dt(b));
                        if (next === 'dateDesc') return dt(b).localeCompare(dt(a));
                        if (next === 'nameDesc') return nm(b).localeCompare(nm(a), 'zh');
                        return nm(a).localeCompare(nm(b), 'zh');
                    });
                    app.state.videos = arr;
                    if (typeof app.renderGridView === 'function') app.renderGridView();
                };
            }

            if (hasFolderBack) {
                const backBtn = document.getElementById('gridFolderBackBtn');
                if (backBtn) {
                    backBtn.onclick = (e) => {
                        e.stopPropagation();
                        app.drama.popFolder();
                    };
                }
            }

            searchBar.className = `w-full px-3 pb-2.5 pt-0.5 ${app.state.searchTerm ? '' : 'hidden'}`;
            if (!searchBar.innerHTML) {
                searchBar.innerHTML = `
                    <div class="flex items-center gap-2 bg-white/10 rounded-lg px-3 py-2">
                        <i data-lucide="search" class="w-4 h-4 text-white flex-shrink-0"></i>
                        <input id="gridSearchInput" type="search"
                               value="${app.state.searchTerm}"
                               placeholder="视频名、演员、描述…"
                               class="flex-1 bg-transparent text-white text-sm outline-none placeholder-white/80 min-w-0">
                    </div>
                    <!-- v1.2.12 第 9 项：搜索记录（聚焦时展开，点条目直接搜，× 删除单条） -->
                    <div id="gridSearchHistory" class="hidden mt-1.5 rounded-lg bg-black/60 backdrop-blur-xl border border-white/10 overflow-hidden"></div>
                `;
            }

            /* clean5：顶栏高度不变，封面区域再上提 15px */
            scrollArea.style.paddingTop = isSearchActive ?
                'calc(7.25rem + var(--safe-top) - 15px)' :
                'calc(3.75rem + var(--safe-top) - 15px)';
            // v1.2.12：底部留白按底栏真实高度计算（用户在图标区域调过底色高度后不再留一条空挡）
            const navEl = document.querySelector('.bottom-nav');
            const navH = navEl ? Math.round(navEl.getBoundingClientRect().height) : 60;
            scrollArea.style.paddingBottom = (navH + 12) + 'px';

            const shuffleBtn = document.getElementById('gridShuffleBtn');
            if (shuffleBtn) {
                const curLibId = app.state.currentLibraryId;
                const libArg = (!curLibId || curLibId === 'favorites' || app.state.currentPerson || app.state.searchTerm) ? null : curLibId;
                shuffleBtn.onclick = (e) => {
                    e.stopPropagation();
                    app.state.startIndex = 0;
                    app.fetchVideos(libArg, null, false, true);
                };
            }

            const curLibId = app.state.currentLibraryId;
            const libArg = (!curLibId || curLibId === 'favorites' || app.state.currentPerson) ? null : curLibId;

            const prevBtn = document.getElementById('gridPrevBtn');
            if (prevBtn && currentPage > 1) {
                prevBtn.onclick = (e) => {
                    e.stopPropagation();
                    app.state.startIndex = Math.max(0, startIndex - PAGE_SIZE);
                    app.fetchVideos(libArg, null, true, false, false, app.state.searchTerm);
                };
            }
            const nextBtn = document.getElementById('gridNextBtn');
            if (nextBtn && currentPage < totalPages) {
                nextBtn.onclick = (e) => {
                    e.stopPropagation();
                    app.state.startIndex = startIndex + PAGE_SIZE;
                    app.fetchVideos(libArg, null, true, false, false, app.state.searchTerm);
                };
            }

            // v1.2.5 第 4 项：点页码直接跳到指定页（不用 window.prompt，Android WebView 会吞掉）
            const jumpBtn = document.getElementById('gridPageJumpBtn');
            if (jumpBtn) {
                jumpBtn.onclick = (e) => {
                    e.stopPropagation();
                    openPageJump(currentPage, totalPages, n => {
                        app.state.startIndex = (n - 1) * PAGE_SIZE;
                        app.fetchVideos(libArg, null, true, false, false, app.state.searchTerm);
                    });
                };
            }

            // 清空并重新构建卡片容器
            scrollArea.innerHTML = '';
            const gridWrapper = document.createElement('div');
            gridWrapper.className = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-1 content-start w-full relative z-10 px-1 pt-2';
            scrollArea.appendChild(gridWrapper);

            const rawList = (app.state.currentPerson || app.state.isFilteredByTag) ? app.state.personVideos : app.state.videos;
            const listToRender = (rawList || []).filter(item => item && item.Type !== 'Photo' && item.MediaType !== 'Photo' && item.Type !== 'PhotoAlbum');
            // v1.3.2：文件夹浏览态标记 —— 此时 currentIndex 属于「进入文件夹前」的旧列表，
            // 不能拿来判断高亮，改由 folder-nav 记录的「正在播放」Id 定位。
            const navApi = window.EmbyProFolderNav;
            const navOpen = !!(navApi && typeof navApi.isFolderOpen === 'function' && navApi.isFolderOpen());
            const navPlayingId = (navApi && typeof navApi.playingItemId === 'function') ? navApi.playingItemId() : null;
            const curItem = !navOpen ? app.state.videos[app.state.currentIndex] : null;
            const nowPlayingId = navPlayingId
                ? String(navPlayingId)
                : (curItem && curItem.Id != null && !curItem.IsFolder ? String(curItem.Id) : null);
            // v1.2.13 第 5 项：每个卡片的 A-Z 首字母桶（供右侧定位条使用）
            const letters = [];
            listToRender.forEach((item, index) => {
                const isSeries = item.Type === 'Series';
                const isSeason = item.Type === 'Season';
                // v1.2.6 第 1 项：文件夹浏览状态下，单视频文件夹不再「穿透套娃直接起播」，
                // 而是作为普通文件夹下钻进入宫格视频列表（避免误跳到正在播放的视频）。
                const isSingleMovie = !!(app.drama?.isSingleVideoFolder(item)) && !app.drama?.forceFolderMode;
                const isFolder = (item.IsFolder || item.Type === 'Folder' || isSeries || isSeason) && !isSingleMovie;
                const el = document.createElement('div');
                const isActive = !app.state.currentPerson && !isFolder && !navOpen && (index === app.state.currentIndex);
                const isLastWatchedTarget = !isFolder && app.drama?.lastFocusedEpisodeId && String(item.Id) === String(app.drama.lastFocusedEpisodeId);
                // v1.3.2：正在播放标记（文件夹定位后左上角显示「正在播放」）
                const isNowPlaying = !isFolder && nowPlayingId && String(item.Id) === nowPlayingId;

                el.setAttribute('tabindex', '0');
                el.setAttribute('data-index', index);
                // v1.2.3：供头像长按进入所在文件夹后定位并滚动到「正在播放」的视频
                if (item.Id != null) el.setAttribute('data-item-id', String(item.Id));
                // v1.2.15 第 1 项：多选模式标记 + 长按 450ms 进入多选并选中本卡
                el.setAttribute('data-sel-id', String(item.Id));
                this.attachLongPressSelect(el, item.Id);
                const letter0 = nameLetter(item.Name || item.SeriesName || item.Album || '');
                letters.push(letter0);
                el.setAttribute('data-ep-letter', letter0);
                el.className = `focusable-item aspect-[3/4] relative cursor-pointer overflow-hidden rounded-sm active:scale-95 transition-transform ${
                    isLastWatchedTarget ? 'ring-2 ring-primary ring-offset-2 ring-offset-black border-2 border-primary box-border' :
                    isActive ? 'border-2 border-primary box-border' : 'bg-gray-800'
                }`;

                // 封面图（OpenList 直链未必放行 CORS，强制 anonymous 会直接加载失败）
                const img = document.createElement('img');
                if (!item._isOpenList) img.crossOrigin = 'anonymous';
                img.referrerPolicy = 'no-referrer';
                img.src = app.getImageSrc(item);
                img.className = 'w-full h-full object-cover';
                img.loading = 'lazy';
                img.onerror = () => {
                    img.onerror = null;
                    img.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"%3E%3Crect width="1" height="1" fill="%23333"%2F%3E%3C%2Fsvg%3E';
                };
                el.appendChild(img);

                // v1.3.2：左上角「正在播放」角标（长按头像定位到所在文件夹后一眼可见）
                if (isNowPlaying) {
                    const badge = document.createElement('div');
                    badge.className = 'ep-playing-badge';
                    badge.innerHTML = '<span class="ep-playing-dot"></span>正在播放';
                    el.appendChild(badge);
                }

                // ═══ 分支 1: 文件夹 / 电视剧 / 季卡片 ═══
                if (isFolder) {
                    el.onclick = () => {
                        if (app.drama) {
                            app.drama.enterItem(item);
                        }
                    };

                    // 居中或顶部遮罩：剧集名称
                    const topLayer = document.createElement('div');
                    topLayer.className = 'absolute inset-0 z-10 bg-gradient-to-t from-black/90 via-black/30 to-black/60 p-2 flex flex-col justify-between';

                    // 图标 (Series / Season / Folder)
                    const iconDiv = document.createElement('div');
                    iconDiv.className = 'self-end text-primary/90';
                    const iconName = item.Type === 'Series' ? 'tv' : item.Type === 'Season' ? 'layers' : 'folder';
                    iconDiv.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5 drop-shadow"></i>`;
                    topLayer.appendChild(iconDiv);

                    // 居中/主体标题
                    const titleDiv = document.createElement('div');
                    titleDiv.className = 'text-white text-sm font-bold text-center line-clamp-3 drop-shadow-md px-1';
                    titleDiv.textContent = item.Name;
                    topLayer.appendChild(titleDiv);

                    // 底部：集数与进度（统一基准线：与视频卡片共享 8px 底部内边距与 items-center）
                    const botDiv = document.createElement('div');
                    botDiv.className = 'w-full flex items-center justify-between text-[11px] text-gray-300 font-mono leading-none';
                    let countBadge = '文件夹';
                    if (item.Type === 'Series') {
                        const epCount = app.drama?.getSeriesEpisodeCount(item) || item.RecursiveItemCount || 0;
                        countBadge = epCount ? `共 ${epCount} 集` : '短剧';
                    } else if (item.Type === 'Season') {
                        countBadge = item.IndexNumber != null ? `第 ${item.IndexNumber} 季` : '分季';
                    } else {
                        const childCount = item.ChildCount || item.RecursiveItemCount;
                        if (childCount) countBadge = `共 ${childCount} 项`;
                    }

                    let progressStr = '';
                    const progress = app.drama?.getDramaProgress(item.Id);
                    if (progress && progress.lastEp) {
                        progressStr = `第 ${progress.lastEp} 集`;
                    }

                    botDiv.innerHTML = `
                        <span ${item.Type === 'Series' ? `data-series-badge="${item.Id}"` : ''}>${countBadge}</span>
                        ${progressStr ? `<span class="text-primary font-bold">${progressStr}</span>` : ''}
                    `;
                    topLayer.appendChild(botDiv);
                    el.appendChild(topLayer);
                }
                // ═══ 分支 2: 普通单集视频卡片 / 单片电影 ═══
                else {
                    el.onclick = () => {
                        // 若是单视频电影文件夹，穿透套娃直接起播
                        if (isSingleMovie) {
                            if (app.drama) {
                                app.drama.enterItem(item);
                            }
                            return;
                        }

                        // v1.3.2 修复：文件夹浏览态下点视频必须「就地起播」。
                        // 旧实现直接调 toggleViewMode()，而它开头就把文件夹态当成
                        // 「点四宫格退出文件夹」处理（v1.2.7 行为），于是永远不播放。
                        if (navOpen && navApi && typeof navApi.playInFolder === 'function') {
                            navApi.playInFolder(index);
                            return;
                        }

                        if (app.state.currentPerson) {
                            app.state.videos = [...app.state.personVideos];
                            app.state.isFilteredByPerson = true;
                        }
                        // 如果在短剧模式且在某个文件夹/剧集内播放，记录该剧进度并绑定 activePlayingFolderId
                        if (app.drama) {
                            const dramaId = app.drama.currentFolderId || item.SeriesId;
                            if (dramaId) {
                                app.drama.activePlayingFolderId = dramaId;
                                app.drama.saveDramaProgress(dramaId, item.Id, item.IndexNumber || (index + 1));
                            }
                        }
                        app.state.currentIndex = index;
                        app.toggleViewMode();
                    };

                    const isShortDrama = app.config.shortDrama;
                    const pad = n => String(n).padStart(2, '0');
                    const hasSeason = item.ParentIndexNumber != null;
                    const hasEp = item.IndexNumber != null;
                    const isMovieType = item.Type === 'Movie' || isSingleMovie;
                    const isEpisodeType = item.Type === 'Episode' || hasSeason || hasEp;

                    // 时长格式化：电影/电视剧显示 1h45m 或 34m；普通短视频显示 05:30
                    let durationStr = '';
                    if (item.RunTimeTicks) {
                        const totalSec = Math.floor(item.RunTimeTicks / 10000000);
                        const mins = Math.floor(totalSec / 60);
                        const secs = totalSec % 60;
                        const hours = Math.floor(mins / 60);
                        const remMins = mins % 60;

                        if (isMovieType || isEpisodeType) {
                            durationStr = hours > 0 ? `${hours}h${remMins}m` : `${mins}m`;
                        } else {
                            durationStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
                        }
                    }

                    // 统一底部信息区结构：与文件夹卡片共享 px-2 pb-2 及 items-center，保证所有卡片底部在同一水平线上
                    const bottomLayer = document.createElement('div');
                    bottomLayer.className = 'absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-2 pt-6 pb-2 flex items-center justify-between gap-1.5';

                    if (isMovieType) {
                        // 电影：左下角纯电影名（剔除括号年份），右下角时长 (1h45m 或 34m)
                        const cleanName = (item.Name || '').replace(/\s*[\(\[（【]\s*\d{4}\s*[\)\]）】]\s*$/, '').trim();
                        bottomLayer.innerHTML = `
                            <span class="text-white text-[11px] font-medium truncate flex-1 leading-none drop-shadow">${cleanName}</span>
                            ${durationStr ? `<span class="text-white/80 text-[11px] font-mono whitespace-nowrap leading-none drop-shadow flex-shrink-0">${durationStr}</span>` : ''}
                        `;
                    } else if (isShortDrama && (hasSeason || hasEp)) {
                        // 电视剧单集：左下角 S01E01，右下角时长 (1h45m 或 34m)
                        const epLabel = (hasSeason ? `S${pad(item.ParentIndexNumber)}` : '') + (hasEp ? `E${pad(item.IndexNumber)}` : '');
                        bottomLayer.innerHTML = `
                            <span class="text-white/90 text-[11px] font-mono leading-none drop-shadow flex-shrink-0">${epLabel}</span>
                            ${durationStr ? `<span class="text-white/80 text-[11px] font-mono whitespace-nowrap leading-none drop-shadow flex-shrink-0">${durationStr}</span>` : ''}
                        `;
                    } else {
                        // 普通短视频：左下角标题，右下角标准时间码 (05:30)
                        bottomLayer.innerHTML = `
                            <span class="text-white text-[11px] font-medium truncate flex-1 leading-none drop-shadow">${item.Name || ''}</span>
                            ${durationStr ? `<span class="text-white/80 text-[11px] font-mono whitespace-nowrap leading-none drop-shadow flex-shrink-0">${durationStr}</span>` : ''}
                        `;
                    }
                    el.appendChild(bottomLayer);

                    // v1.2.13 第 6 项：右上角「已观看」角标（UserData.Played）
                    if (item.UserData && item.UserData.Played) {
                        const wd = document.createElement('div');
                        wd.className = 'absolute top-1 right-1 z-20 w-4 h-4 rounded-full bg-black/55 border border-white/25 flex items-center justify-center pointer-events-none';
                        wd.innerHTML = '<i data-lucide="check" class="w-2.5 h-2.5" style="color:#52B54B"></i>';
                        el.appendChild(wd);
                    }
                }

                gridWrapper.appendChild(el);
            });

            // v1.2.15 第 1 项：套用多选模式状态（复选角标 / 点击切换 / 顶栏切换）
            this.__gridWrapper = gridWrapper;
            this.__selIds = listToRender.map(it => String(it.Id));
            this.applySelState(gridWrapper);

            // 一言隐藏句
            const eggFooter = document.createElement('div');
            eggFooter.className = 'col-span-full pt-8 pb-24 px-4 text-center text-gray-600 text-[11px] leading-relaxed select-none';
            eggFooter.innerHTML = '<span class="opacity-40">——</span>';
            gridWrapper.appendChild(eggFooter);

            // v1.2.13 第 5 项：右侧 A-Z 快速定位条（视频 / 文件夹列表共用本渲染）
            try { buildLetterBar(container, scrollArea, letters); } catch (e) { }

            if (app.state._hitokotoCache) {
                const data = app.state._hitokotoCache;
                const source = [data.from_who, data.from].filter(Boolean).join(' · ');
                eggFooter.innerHTML = `
                    <p class="text-gray-300">“${data.hitokoto || ''}”</p>
                    ${source ? `<p class="mt-1 text-gray-500 italic">- ${source} -</p>` : ''}
                `;
            } else {
                fetch('https://v1.hitokoto.cn/?encode=json&charset=utf-8')
                    .then(r => r.json())
                    .then(data => {
                        app.state._hitokotoCache = data;
                        const text = data.hitokoto || '';
                        const source = [data.from_who, data.from].filter(Boolean).join(' · ');
                        eggFooter.innerHTML = `
                            <p class="text-gray-300">“${text}”</p>
                            ${source ? `<p class="mt-1 text-gray-500 italic">- ${source} -</p>` : ''}
                        `;
                    })
                    .catch(() => {
                        eggFooter.innerHTML = '';
                    });
            }

            app.updateUI();

            requestAnimationFrame(() => {
                const targetEl = gridWrapper.querySelector('.ring-primary') || gridWrapper.children[app.state.currentIndex];
                if (targetEl && scrollArea) {
                    const elTop = targetEl.offsetTop;
                    const elHeight = targetEl.offsetHeight;
                    const areaHeight = scrollArea.clientHeight;
                    scrollArea.scrollTop = elTop - (areaHeight / 2) + (elHeight / 2);
                }
            });

            const fsBtn = document.getElementById('gridFolderSearchBtn');
            if (fsBtn) {
                fsBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (app.state.searchTerm) {
                        this.searchVideos('');
                    } else {
                        const bar = document.getElementById('gridSearchBar');
                        if (bar) {
                            bar.classList.toggle('hidden');
                            if (scrollArea) {
                                scrollArea.style.paddingTop = bar.classList.contains('hidden') ?
                                    'calc(3.75rem + var(--safe-top) - 15px)' :
                                    'calc(7.25rem + var(--safe-top) - 15px)';
                            }
                            if (!bar.classList.contains('hidden')) {
                                document.getElementById('gridSearchInput')?.focus();
                            }
                        }
                    }
                };
            }

            const searchInput = document.getElementById('gridSearchInput');
            if (searchInput && !searchInput.dataset.bound) {
                searchInput.dataset.bound = 'true';
                let isComposing = false;
                let debounce = null;

                searchInput.addEventListener('compositionstart', () => {
                    isComposing = true;
                });
                searchInput.addEventListener('compositionend', (e) => {
                    isComposing = false;
                    const val = e.target.value.trim();
                    this.searchVideos(val);
                });
                searchInput.addEventListener('input', (e) => {
                    if (isComposing) return;
                    clearTimeout(debounce);
                    const val = e.target.value.trim();
                    debounce = setTimeout(() => this.searchVideos(val), 500);
                });
                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') this.searchVideos('');
                    if (e.key === 'Enter') {
                        const val = searchInput.value.trim();
                        if (!val) return;
                        clearTimeout(debounce);
                        pushSearchTerm(val);
                        hideSearchHistory();
                        this.searchVideos(val);
                    }
                });
                // v1.2.12 第 9 项：聚焦展开搜索记录，失焦延迟收起（留出点击时间）
                searchInput.addEventListener('focus', () => renderSearchHistory());
                searchInput.addEventListener('blur', () => setTimeout(hideSearchHistory, 180));
            }

            if (window.lucide) lucide.createIcons();

            // v1.2.13 第 3 项：渲染完成后自动把当前页图片预热进 CacheStorage（3 分钟节流）
            try {
                if (window.EmbyProGlobalSettings && typeof EmbyProGlobalSettings.autoWarmImageCache === 'function') {
                    EmbyProGlobalSettings.autoWarmImageCache();
                }
            } catch (e) { }
        }

        // ═══════════ v1.2.15 第 1 项：长按多选 + 批量删除 ═══════════
        /** 长按 450ms 进入多选模式并选中该卡；拖动/滚动时取消计时 */
        attachLongPressSelect(el, itemId) {
            let timer = null, pos = null;
            el.addEventListener('touchstart', (e) => {
                if (this.selOn) return;   // 选择态里由点选/拖选处理
                const t = e.touches[0];
                pos = { x: t.clientX, y: t.clientY };
                timer = setTimeout(() => {
                    timer = null;
                    this.enterSelMode();
                    this.toggleSelCard(String(itemId), true);
                }, 450);
            }, { passive: true });
            el.addEventListener('touchmove', (e) => {
                if (!timer || !pos) return;
                const t = e.touches[0];
                if (Math.abs(t.clientX - pos.x) > 12 || Math.abs(t.clientY - pos.y) > 12) {
                    clearTimeout(timer); timer = null;
                }
            }, { passive: true });
            const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
            el.addEventListener('touchend', cancel);
            el.addEventListener('touchcancel', cancel);
        }

        enterSelMode() {
            if (this.selOn) return;
            this.selOn = true;
            this.selSet = new Set();
            if (this.__gridWrapper) this.applySelState(this.__gridWrapper);
            if (this.app) this.app.showToast('已进入多选：点选卡片，或按住左右拖动连选');
        }

        /** 返回键消费：返回 true 表示刚才处于多选态（已退出） */
        exitSelMode() {
            if (!this.selOn) return false;
            this.selOn = false;
            this.selSet = new Set();
            if (this.__gridWrapper) this.applySelState(this.__gridWrapper);
            return true;
        }

        toggleSelCard(id, addOnly) {
            const k = String(id);
            if (addOnly) this.selSet.add(k);
            else if (this.selSet.has(k)) this.selSet.delete(k);
            else this.selSet.add(k);
            try {
                const el = document.querySelector(`#gridScrollArea [data-sel-id="${CSS.escape(k)}"]`);
                if (el) el.classList.toggle('sel-checked', this.selSet.has(k));
            } catch (e) { }
            this.updateSelUI();
        }

        toggleSelAll() {
            const ids = this.__selIds || [];
            const all = ids.length > 0 && ids.every(x => this.selSet.has(x));
            if (all) this.selSet = new Set();
            else this.selSet = new Set(ids);
            if (this.__gridWrapper) {
                this.__gridWrapper.querySelectorAll('[data-sel-id]').forEach(el => {
                    el.classList.toggle('sel-checked', this.selSet.has(el.getAttribute('data-sel-id')));
                });
            }
            this.updateSelUI();
        }

        updateSelUI() {
            const cnt = document.getElementById('selCount');
            const allBtn = document.getElementById('selAllBtn');
            if (!cnt) return;
            const total = (this.__selIds || []).length;
            cnt.textContent = `已选 ${this.selSet.size} / 共 ${total} 项`;
            if (allBtn) allBtn.textContent = (total > 0 && this.selSet.size === total) ? '取消全选' : '全选';
        }

        /** 每次渲染后套用：复选角标一次性创建；选择态接管卡片点击，退出时还原 */
        applySelState(gridWrapper) {
            if (!gridWrapper) return;
            gridWrapper.classList.toggle('sel-on', !!this.selOn);
            gridWrapper.querySelectorAll('[data-sel-id]').forEach(el => {
                if (!el.querySelector('.sel-check')) {
                    const c = document.createElement('div');
                    c.className = 'sel-check';
                    c.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
                    el.appendChild(c);
                }
                const id = el.getAttribute('data-sel-id');
                if (this.selOn) {
                    if (!el.__epOrigClick) el.__epOrigClick = el.onclick;
                    el.onclick = (e) => { e.stopPropagation(); this.toggleSelCard(id); };
                    el.classList.toggle('sel-checked', this.selSet.has(id));
                } else {
                    if (el.__epOrigClick) { el.onclick = el.__epOrigClick; el.__epOrigClick = null; }
                    el.classList.remove('sel-checked');
                }
            });
            // 顶栏切换：多选条 ↔ 常规头部
            const header = document.getElementById('gridSafeHeader');
            const bar = this.ensureSelBar();
            if (header) header.style.display = this.selOn ? 'none' : '';
            if (bar) bar.style.display = this.selOn ? 'block' : 'none';
            if (this.selOn) this.updateSelUI();
        }

        ensureSelBar() {
            const container = this.app && this.app.dom ? this.app.dom.videoContainer : null;
            if (!container) return null;
            let bar = container.querySelector('#gridSelBar');
            if (!bar) {
                bar = document.createElement('div');
                bar.id = 'gridSelBar';
                bar.innerHTML = `
                    <div style="height:var(--safe-top,0px)"></div>
                    <div class="flex items-center gap-3 px-3 py-2 bg-black/75 backdrop-blur-xl border-b border-white/10">
                        <button id="selAllBtn" class="text-white text-sm font-bold px-2 py-1.5 active:opacity-70">全选</button>
                        <span id="selCount" class="flex-1 text-center text-xs text-gray-300 font-mono">已选 0 / 共 0 项</span>
                        <button id="selCancelBtn" class="text-gray-300 text-sm px-2 py-1.5 active:opacity-70">取消</button>
                        <button id="selDelBtn" class="text-red-400 text-sm font-bold px-2 py-1.5 active:opacity-70">删除</button>
                    </div>`;
                container.appendChild(bar);
                bar.querySelector('#selAllBtn').onclick = (e) => { e.stopPropagation(); this.toggleSelAll(); };
                bar.querySelector('#selCancelBtn').onclick = (e) => { e.stopPropagation(); this.exitSelMode(); };
                bar.querySelector('#selDelBtn').onclick = (e) => { e.stopPropagation(); this.requestBatchDelete(); };
            }
            return bar;
        }

        requestBatchDelete() {
            const app = this.app;
            const ids = Array.from(this.selSet);
            if (!app) return;
            if (!ids.length) { app.showToast('请先选择要删除的项目'); return; }
            const nameEl = document.getElementById('deleteFileName');
            if (nameEl) nameEl.textContent = `确认删除选中的 ${ids.length} 个项目吗？删除后不可恢复！`;
            app._batchDeleteIds = ids;
            app.toggleModal('deleteConfirmModal', true);
        }

        async searchVideos(term) {
            if (!this.app) return;
            const app = this.app;
            if (!term) {
                this.restorePreSearch();
                return;
            }
            if (!app.state.preSearchState) {
                app.state.preSearchState = {
                    currentLibraryId: app.state.currentLibraryId,
                    currentLibraryType: app.state.currentLibraryType,
                    videos: [...app.state.videos],
                    totalCount: app.state.totalCount,
                    startIndex: app.state.startIndex,
                    currentIndex: app.state.currentIndex
                };
                app.input?.pushLayer('search');
            }
            pushSearchTerm(term);   // v1.2.12 第 9 项：记录搜索词
            app.state.searchTerm = term;
            app.state.startIndex = 0;
            await app.fetchVideos(null, null, false, false, false, term);
        }

        restorePreSearch() {
            if (!this.app) return;
            const app = this.app;
            if (app.input && app.input.hasHistoryLayer('search') && !app.input._isHandlingPop) {
                window.history.back();
                return;
            }
            if (app.state.preSearchState) {
                Object.assign(app.state, app.state.preSearchState);
                app.state.preSearchState = null;
            }
            app.state.searchTerm = '';
            this.render();
        }

        async filterByTag(tagName) {
            if (!this.app || !tagName) return;
            const app = this.app;
            app.toggleLoading(true);
            try {
                const { server, token, userId } = app.config;
                const sortStr = app.config.shortDrama ? 'SortBy=SeriesName,ParentIndexNumber,IndexNumber&SortOrder=Ascending' : 'SortBy=DateCreated&SortOrder=Descending';
                const url = `${server}/emby/Users/${userId}/Items?api_key=${token}&Recursive=true&IncludeItemTypes=Movie,Episode,Video,MusicVideo&Limit=150&Fields=Overview,Path,RunTimeTicks,MediaSources,Tags,TagItems,SeriesName,ParentIndexNumber,IndexNumber&Tags=${encodeURIComponent(tagName)}&${sortStr}`;
                const res = await fetch(url, { headers: app.getAuthHeaders(token) });
                if (res.ok) {
                    const data = await res.json();
                    app.state.personVideos = data.Items || [];
                    app.state.personTotalCount = data.TotalRecordCount || app.state.personVideos.length;
                    app.state.currentTag = tagName;
                    app.state.isFilteredByTag = true;
                    app.state.currentPerson = null;
                    app.state.viewMode = 'grid';
                    if (app.mediaSession) app.mediaSession.sync(true);
                    app.input?.pushLayer('filter', { type: 'tag', name: tagName });

                    const vBtn = app.dom.viewModeBtn;
                    if (vBtn) {
                        vBtn.innerHTML = `<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>`;
                        if (window.lucide) lucide.createIcons();
                    }

                    const appEl = document.getElementById('app');
                    if (appEl) {
                        appEl.classList.remove('interface-hidden');
                        appEl.classList.add('grid-active');
                    }
                    if (app.dom.videoContainer) app.dom.videoContainer.style.touchAction = 'auto';
                    this.render();
                }
            } catch (e) {
                app.showToast('筛选标签失败');
            } finally {
                app.toggleLoading(false);
            }
        }
    }

    window.GridViewManager = GridViewManager;
})(window);
