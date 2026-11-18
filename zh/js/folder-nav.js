/*
 * folder-nav.js —— EmbyPro v1.2.3 头像手势 + 底部「文件夹」导航（自包含模块）
 *
 * 移植基准：EmbyTok 1.5.19
 *   components/VideoCard.tsx:612-633      头像长按阈值 550ms、avatarPressWasLong()
 *   components/VideoCard.tsx:2169-2191    头像单击 = 该演员全部视频（本工程 personBtn 已有）
 *   StandardRoot.tsx:20-36                orderAncestors()：把祖先链统一成「媒体库 → … → 最深」
 *   StandardRoot.tsx:1140-1158            handleBrowseFolders()：长按进入当前视频所在最深一层文件夹
 *   StandardRoot.tsx:1160-1187            openCurrentFolder()：底部按钮进「正在播放视频所属媒体库」根目录
 *
 * v1.2.4 修正（用户反馈「点击底部文件夹时应为当前媒体库的文件夹」）：
 *   底部按钮优先取用户当前选中的媒体库（emby_lib_id / emby_lib_name），
 *   未明确选库时才用祖先链根兜底；标题不再出现「全部媒体」，
 *   并按参考版用 focusId 高亮通往当前视频的下一级文件夹。
 *   services/EmbyClient.ts:1038-1041      GET /Items/{id}/Ancestors?UserId=...
 *
 * v1.2.3 修正（用户反馈「长按打开的是全部文件夹」）：
 *   ① 不同 Emby 服务返回的祖先链顺序不统一（有的由内到外），此前直接取 list[last] 会
 *      拿到媒体库根 = 全部媒体；现按 1.5.19 的 orderAncestors 校正顺序。
 *   ② 长按路径彻底移除「回退到 currentLibraryId」的逻辑，排除 CollectionFolder/UserView
 *      集合根，祖先链不可用时只用视频自身的 ParentId/SeasonId/SeriesId，绝不打开全部媒体。
 *   ③ 整条链预填 folderStack，返回按钮可一层层往上退，并高亮/滚动到当前视频。
 */
(function () {
    'use strict';

    const LONG_MS = 350;
    let app = null;
    let folderOpen = false;
    let snapshot = null;
    let pressTimer = null;
    let longFired = false;
    let backMode = 'layers';   // v1.2.5：'layers'=逐层返回 / 'playing'=长按进入后手势直接回播放页
    let playingId = null;      // v1.3.2：当前真正在播放的视频 Id（文件夹内定位/角标用）
    let videoListMode = false; // v2.1.8：长按头像进入「所在文件夹的视频列表」（非文件夹层级导航）

    function cfg() { return (app && app.config) || {}; }
    function toast(msg) { if (app && typeof app.showToast === 'function') app.showToast(msg); }
    function currentItem() {
        if (!app || !app.state || !Array.isArray(app.state.videos)) return null;
        return app.state.videos[app.state.currentIndex] || null;
    }

    function saveSnapshot() {
        if (snapshot) return;
        const s = app.state;
        snapshot = {
            videos: Array.isArray(s.videos) ? s.videos.slice() : [],
            index: s.currentIndex || 0,
            libraryId: s.currentLibraryId,
            libraryType: s.currentLibraryType,
            person: s.currentPerson,
            tag: s.currentTag
        };
    }

    function restoreSnapshot() {
        if (!snapshot) return;
        const s = app.state;
        s.videos = snapshot.videos;
        s.currentIndex = snapshot.index;
        s.currentLibraryId = snapshot.libraryId;
        s.currentLibraryType = snapshot.libraryType;
        s.currentPerson = snapshot.person;
        s.currentTag = snapshot.tag;
        snapshot = null;
    }

    /**
     * 沿祖先链进入文件夹（复用 drama 的 forceFolderMode 渲染链）。
     * chain 顺序必须是「媒体库 → … → 目标文件夹」，最后一层为实际打开目录。
     */
    async function openFolder(chain, label, focusId) {
        const d = app && app.drama;
        if (!d) return toast('文件夹视图不可用');
        const list = (chain || []).filter(x => x && x.Id);
        if (!list.length) return toast('未能定位文件夹');

        saveSnapshot();
        d.reset();
        d.forceFolderMode = true;
        // 逐层缓存整条链：点顶栏「返回」能一层层往上退，而不是直接回播放页
        d.folderStack = [{ id: null, name: '播放页', type: '', videos: [], totalCount: 0 }]
            .concat(list.slice(0, -1).map(x => ({
                id: x.Id, name: x.Name || '文件夹', type: 'Folder', videos: [], totalCount: 0
            })));
        const target = list[list.length - 1];
        d.currentFolderId = target.Id;
        d.currentFolderName = target.Name || label || '文件夹';
        d.currentFolderType = 'Folder';
        d.lastFocusedEpisodeId = focusId || null;

        const s = app.state;
        s.currentPerson = null;
        s.currentTag = null;
        s.searchTerm = '';
        s.isFilteredByPerson = false;
        s.isFilteredByTag = false;
        s.startIndex = 0;
        s.viewMode = 'grid';

        const appEl = document.getElementById('app');
        // v1.2.5 第 4 项：文件夹列表里左下角图标不显示
        if (appEl) { appEl.classList.remove('interface-hidden'); appEl.classList.add('grid-active', 'folder-list-active'); }
        if (app.dom && app.dom.videoContainer) app.dom.videoContainer.style.touchAction = 'auto';
        const viewBtn = document.getElementById('viewModeBtn');
        if (viewBtn) {
            viewBtn.innerHTML = '<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>';
            if (window.lucide) window.lucide.createIcons({ root: viewBtn });
        }
        folderOpen = true;
        toast('已进入：' + d.currentFolderName);
        await app.fetchVideos(target.Id);
        if (focusId) {
            try { requestAnimationFrame(() => focusItem(focusId)); }
            catch (e) { setTimeout(() => focusItem(focusId), 40); }
        }
    }

    /**
     * v2.1.8：长按头像 → 直接展示「该视频所在文件夹里的视频列表」并定位当前视频。
     * 与 openFolder 的区别：不建 folderStack 层级导航、不加 folder-list-active，
     * 点四宫格/返回键都直接回播放页；切走前把在播 video 整组保活，回来直接续播。
     */
    async function openFolderVideoList(target, item) {
        const d = app && app.drama;
        const s = app && app.state;
        if (!d || !s) return;

        // 切到 grid 会被 container.innerHTML='' 销毁 video，先整组保活
        try {
            if (window.EmbyProDesktopBridges) window.EmbyProDesktopBridges.suspendStreamView();
        } catch (e) { }

        saveSnapshot();
        d.reset();
        d.forceFolderMode = false;
        d.folderStack = [];
        d.currentFolderId = null;
        d.currentFolderName = target.Name || '所在文件夹';
        d.currentFolderType = 'Folder';
        d.lastFocusedEpisodeId = String(item.Id);

        s.currentPerson = null;
        s.currentTag = null;
        s.searchTerm = '';
        s.isFilteredByPerson = false;
        s.isFilteredByTag = false;
        s.startIndex = 0;
        s.viewMode = 'grid';

        const appEl = document.getElementById('app');
        if (appEl) {
            appEl.classList.remove('interface-hidden', 'folder-list-active');
            appEl.classList.add('grid-active');
        }
        if (app.dom && app.dom.videoContainer) app.dom.videoContainer.style.touchAction = 'auto';
        const viewBtn = document.getElementById('viewModeBtn');
        if (viewBtn) {
            viewBtn.innerHTML = '<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>';
            if (window.lucide) window.lucide.createIcons({ root: viewBtn });
        }

        folderOpen = false;        // 非文件夹导航态：点四宫格走正常 grid → stream
        videoListMode = true;
        playingId = String(item.Id);
        backMode = 'playing';      // 返回键直接回正在播放的视频
        toast('已定位到：' + d.currentFolderName);

        // v2.1.11：nonRecursive=true → 只取 target.Id 这一层文件夹里的视频（对齐 embytok），
        // 否则 Recursive=true 会把整个媒体库递归取出，表现为「媒体库的视频列表」。
        await app.fetchVideos(target.Id, null, false, false, false, '', true);
        // v2.1.9：渲染完成后尽快触发定位；重试 / 抗二次渲染由 focusItem 内部接管
        if (item.Id) {
            try { requestAnimationFrame(() => focusItem(item.Id)); }
            catch (e) { setTimeout(() => focusItem(item.Id), 40); }
        }
    }

    /** 回到播放流时清掉视频列表态，并恢复进入前的视频列表上下文 */
    function clearVideoList() {
        stopFocusWatch();   // v2.1.10：离开列表即停定位守候，避免操作已销毁的宫格
        if (!videoListMode) return;
        videoListMode = false;
        backMode = 'layers';
        playingId = null;
        if (snapshot) restoreSnapshot();   // 列表换成进入前的视频集合，与保活的 slide 对齐
        snapshot = null;
    }

    /**
     * v1.3.2：文件夹列表里「就地起播」某个视频。
     * 旧链路 bug：grid 卡片点击直接调 app.toggleViewMode()，而它的第一段判断是
     * 「文件夹态 + 点四宫格 → 退出文件夹回媒体库宫格」（v1.2.7 行为），
     * 于是在头像长按进入的文件夹里点任何视频都只会退出文件夹、永不播放。
     * 这里带上 fromGridPlay 标记走正常切流分支，并保留文件夹栈供返回。
     */
    function playInFolder(index) {
        if (!app || !folderOpen) return false;
        const d = app && app.drama;
        const list = (app.state && Array.isArray(app.state.videos)) ? app.state.videos : [];
        const item = list[index];
        if (!item) return false;

        // 文件夹 / 剧集 / 季卡片：仍走下钻，不起播
        if (item.IsFolder || item.Type === 'Folder' || item.Type === 'Series' || item.Type === 'Season') {
            if (d) d.enterItem(item);
            return true;
        }

        playingId = item.Id != null ? String(item.Id) : null;
        if (d) {
            const dramaId = d.currentFolderId || item.SeriesId;
            if (dramaId) {
                d.activePlayingFolderId = dramaId;
                d.saveDramaProgress(dramaId, item.Id, item.IndexNumber || (index + 1));
            }
            // 回到文件夹列表时仍能高亮/标出这一集
            d.lastFocusedEpisodeId = item.Id;
        }
        // 已经真正起播：返回手势不再「一次性回原视频」，改为先回文件夹列表
        backMode = 'layers';
        app.state.currentIndex = index;
        try {
            app.toggleViewMode({ fromGridPlay: true });
        } catch (e) {
            console.warn('[FolderNav] playInFolder 失败:', e);
            return false;
        }
        return true;
    }

    /** v1.3.2：从播放页退回「文件夹宫格」（不退出文件夹，保留逐层返回） */
    function backToFolderGrid() {
        if (!app) return;
        const s = app.state || {};
        s.viewMode = 'grid';
        const appEl = document.getElementById('app');
        if (appEl) {
            appEl.classList.remove('interface-hidden');
            appEl.classList.add('grid-active', 'folder-list-active');
        }
        if (app.dom && app.dom.videoContainer) app.dom.videoContainer.style.touchAction = 'auto';
        const viewBtn = document.getElementById('viewModeBtn');
        if (viewBtn) {
            viewBtn.innerHTML = '<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>';
            if (window.lucide) window.lucide.createIcons({ root: viewBtn });
        }
        try { app.renderGridView(); } catch (e) { }
        try { if (app.mediaSession && typeof app.mediaSession.sync === 'function') app.mediaSession.sync(true); } catch (e) { }
    }

    /**
     * v2.1.10：长按头像进入「当前视频所在目录」后，把「当时正在播放的视频」
     * 卡片滚动到可视区并高亮（能看见即可，不强制正中间——首尾卡片本就无法居中）。
     *
     * 真机（Chromium）验证：centerItem 算法本身在「首/中/尾/短列表」四场景
     * 都能把卡片滚进可视区，问题从来不是算法，而是「调用时机」——renderGridView
     * 被 ui-prefs / actors 二次包装，渲染后再次改 DOM 会把刚滚好的 scrollTop 冲掉，
     * 于是 v2.1.9 表现为时灵时不灵。
     * 本版改为「定位意图 + 持续守候」：目标卡片一旦出现或被重建（MutationObserver
     * 观察到 gridScrollArea 子节点变化），立即在双 rAF 后重新定位；另加定时复核，
     * 守候约 3 秒后自动停止，不长期占用。
     *
     * centerItem：按 rect 精确居中并钳制到合法滚动范围；首尾因边界无法居中时，
     * 钳制结果就是「完整可见」，符合用户「不居中也行，要定位到当前视频」的要求。
     */
    let focusWatch = null;   // { id, observer, timers }

    function stopFocusWatch() {
        if (!focusWatch) return;
        try { if (focusWatch.observer) focusWatch.observer.disconnect(); } catch (e) { }
        (focusWatch.timers || []).forEach(t => { try { clearTimeout(t); } catch (e) { } });
        focusWatch = null;
    }

    function centerItem(el, box) {
        if (!el || !box) return false;
        try {
            if (el.isConnected === false) return false;
            const r = el.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            if (!b.height || !r.height) return false;
            const delta = (r.top + r.height / 2) - (b.top + b.height / 2);
            // 已在中间附近（±12px）视为完成，不再强拉，避免打扰用户主动滚动
            if (Math.abs(delta) <= 12) return true;
            const max = Math.max(0, box.scrollHeight - box.clientHeight);
            let t = box.scrollTop + delta;
            if (t < 0) t = 0;
            if (t > max) t = max;
            box.scrollTop = t;
            return true;
        } catch (e) { return false; }
    }

    /** 单次定位：高亮目标卡 + 双 rAF 后滚动；幂等，可反复调用 */
    function locateFocus(id) {
        const safe = String(id == null ? '' : id).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safe) return false;
        const box = document.getElementById('gridScrollArea');
        if (!box) return false;
        const el = box.querySelector('[data-item-id="' + safe + '"]');
        if (!el || el.isConnected === false) return false;
        // 清掉上一次高亮，保证只有当前播放视频那张卡被标记
        try {
            const olds = box.querySelectorAll('.epg-focus-item');
            for (let i = 0; i < olds.length; i++) olds[i].classList.remove('epg-focus-item');
        } catch (e) { }
        el.classList.add('epg-focus-item');
        try {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                centerItem(el, box);
                centerItem(el, box);   // 再算一次，吃掉图片占位撑高后的布局变化
            }));
        } catch (e) { setTimeout(() => centerItem(el, box), 30); }
        return true;
    }

    function focusItem(id, retry) {
        const n = retry || 0;
        const safe = String(id == null ? '' : id).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safe) return;
        const box = document.getElementById('gridScrollArea');
        const el = box && box.querySelector('[data-item-id="' + safe + '"]');
        if (!el || el.isConnected === false) {
            // 卡片还没生成（网络/异步渲染中）：最多重试 ~3s
            if (n < 30) setTimeout(() => focusItem(id, n + 1), 100);
            return;
        }
        // 首次命中：建立「守候」，抗 ui-prefs / actors 的二次渲染
        if (!focusWatch || String(focusWatch.id) !== safe) {
            stopFocusWatch();
            const w = { id: safe, observer: null, timers: [] };
            focusWatch = w;
            try {
                if (typeof MutationObserver !== 'undefined') {
                    w.observer = new MutationObserver(() => {
                        if (focusWatch === w) locateFocus(safe);
                    });
                    // 只观察子节点增删；class/scrollTop 变化不触发，避免自激循环
                    w.observer.observe(box, { childList: true, subtree: true });
                }
            } catch (e) { w.observer = null; }
            [120, 260, 400, 600, 900, 1400, 2200].forEach(ms => {
                w.timers.push(setTimeout(() => {
                    if (focusWatch === w) locateFocus(safe);
                }, ms));
            });
            w.timers.push(setTimeout(() => {
                if (focusWatch === w) stopFocusWatch();
            }, 3200));
        }
        locateFocus(safe);
    }

    /** 返回播放页：还原视频列表快照，再走既有 toggleViewMode 的 stream 分支 */
    function backToPlaying() {
        if (!folderOpen && !videoListMode) return;
        stopFocusWatch();   // v2.1.10：离开即停守候
        const d = app && app.drama;
        if (d) { d.forceFolderMode = false; d.reset(); }
        folderOpen = false;
        videoListMode = false;
        restoreSnapshot();
        app.state.viewMode = 'grid';       // 让 toggleViewMode() 走 grid → stream 分支
        const appEl = document.getElementById('app');
        if (appEl) appEl.classList.add('grid-active');
        try { app.toggleViewMode(); } catch (e) { try { app.renderSlides(); } catch (e2) { } }
        if (appEl) appEl.classList.remove('grid-active', 'folder-list-active');
        backMode = 'layers';
        if (!folderOpen) playingId = null;   // 仍在文件夹里时保留角标
    }

    async function ancestorsOf(itemId) {
        if (window.EmbyXCommon && typeof EmbyXCommon.getItemAncestors === 'function') {
            return await EmbyXCommon.getItemAncestors(cfg(), itemId);
        }
        return [];
    }

    /** 当前媒体库 Id（'all' / 'favorites' 不算真实媒体库，返回 null） */
    function libraryIdOf() {
        const id = app && app.state && app.state.currentLibraryId;
        return (id && id !== 'favorites' && id !== 'all') ? id : null;
    }
    // 媒体库根判定：除官方 CollectionFolder/UserView 外，覆盖 AggregateFolder 等
    // 非常规根类型，并支持用已知的 currentLibraryId 直接命中（解决库根被返回成
    // Folder/AggregateFolder 时 orderAncestors 无法识别根、导致「进入所有文件夹」的回归）。
    const isLibraryRoot = (x, libraryId) => {
        if (!x || !x.Id) return false;
        const t = String(x.Type || '').toLowerCase();
        if (['collectionfolder', 'userview', 'aggregatefolder', 'aggregate', 'userrootfolder', 'userview']
            .indexOf(t) >= 0) return true;
        if (libraryId && String(x.Id) === String(libraryId)) return true;
        return false;
    };

    /**
     * 对齐 1.5.19 StandardRoot.tsx:25-36 orderAncestors：
     * 把不同服务返回的祖先链统一成「从最外层媒体库到最内层文件夹」。
     * 不校正的话，由内到外返回的服务会让「取最后一层」拿到媒体库根（= 全部媒体）。
     */
    function orderAncestors(list, libraryId) {
        const arr = (list || []).filter(x => x && x.Id);
        if (arr.length <= 1) return arr;
        const rootIdx = arr.findIndex(x => isLibraryRoot(x, libraryId));
        if (rootIdx === 0) return arr;                       // 首项即根：已是 外→内
        if (rootIdx > 0) return arr.slice().reverse();        // 根在末尾：内→外，翻转
        // 仍无法识别库根：若末项是顶层集合根而首项不是，推断为内→外翻转
        if (isLibraryRoot(arr[arr.length - 1], libraryId) && !isLibraryRoot(arr[0], libraryId)) return arr.slice().reverse();
        return arr;
    }

    /** 当前媒体库名称（选库时由 index.html 写入 emby_lib_name） */
    function libraryNameOf() {
        try { return localStorage.getItem('emby_lib_name') || ''; } catch (e) { return ''; }
    }

    /**
     * v1.2.4 底部「文件夹」：进入「当前媒体库」的文件夹视图（用户反馈）。
     * 优先用用户当前选中的媒体库；未明确选库（所有媒体）时，以正在播放视频的
     * 祖先链根定位它所属的媒体库，绝不再落到「全部媒体」。
     * 对齐 1.5.19 openCurrentFolder：进入根目录后高亮通往当前视频的下一级文件夹。
     * 已在文件夹视图时则返回主播放界面。
     */
    async function openCurrentFolder() {
        if (folderOpen) return backToPlaying();
        const item = currentItem();
        const libId = libraryIdOf();
        let id = libId;
        let name = libId ? libraryNameOf() : '';
        let ordered = [];
        let focusId = null;

        // 祖先链用于定位「下一级文件夹」，同时作为未选具体媒体库时的兜底
        if (item && item.Id) {
            if (app.toggleLoading) app.toggleLoading(true);
            const raw = await ancestorsOf(item.Id);
            if (app.toggleLoading) app.toggleLoading(false);
            ordered = orderAncestors(raw, libId);
        }
        if (!id && item && item.LibraryId) { id = item.LibraryId; name = libraryNameOf() || ''; }
        if (!id) {
            const root = ordered[0] || null;
            if (root && root.Id) { id = root.Id; name = root.Name || ''; }
        }
        if (!id) return toast('请先选择一个媒体库');
        if (item && item.Id) focusId = ordered.length > 1 ? ordered[1].Id : item.Id;
        // v1.3.2：记住「真正在播的那一条」，供文件夹列表左上角「正在播放」角标
        playingId = (item && item.Id != null) ? String(item.Id) : null;
        // 底部按钮进入的文件夹：返回键仍逐层退（v1.2.4 行为）
        backMode = 'layers';
        await openFolder([{ Id: id, Name: name || '当前媒体库' }], '当前媒体库', focusId);
    }

    /**
     * 头像长按：进入「当前视频所在的媒体库」目录（1.5.19 handleBrowseFolders）。
     * v2.1.6 重写根因修复：
     *   ① 用 item.LibraryId 锁定「真实媒体库根」（即使从「所有媒体」进入也指向具体库，
     *      绝不会是「所有媒体」聚合壳）—— 这是解决「跳进所有媒体」最可靠的依据。
     *   ② 视频直接在媒体库根目录（无独立子文件夹）时，进入的就是该媒体库根目录本身
     *      （如「抖音」库），而非提示「无单独文件夹」、也绝不回退到所有媒体。
     *   ③ 有独立子文件夹则进入该子文件夹。
     */
    async function openDeepestFolder() {
        if (folderOpen) return backToPlaying();
        const item = currentItem();
        if (!item || !item.Id) return toast('请先播放一个视频');

        // 真实媒体库根：item.LibraryId 最可靠（从「所有媒体」进入也指向具体库），
        // 否则退化为 currentLibraryId，再否则靠祖先链识别。
        const realLibId = (item.LibraryId && String(item.LibraryId)) || libraryIdOf() || null;
        const libName = libraryNameOf();

        if (app.toggleLoading) app.toggleLoading(true);
        const raw = await ancestorsOf(item.Id);
        if (app.toggleLoading) app.toggleLoading(false);
        const ordered = orderAncestors(raw, realLibId);   // 统一成 外→内

        // 聚合壳（所有媒体 / 用户根等）不是「真实媒体库」，必须跳过，
        // 否则会把目标误判为聚合根，从而打开「所有媒体」。
        const isAggType = (x) => {
            const t = String((x && x.Type) || '').toLowerCase();
            return ['aggregatefolder', 'aggregate', 'allmedia', 'userrootfolder',
                    'aggregateuserrootfolder', 'userroot'].indexOf(t) >= 0;
        };
        const aggIds = new Set(ordered.filter(isAggType).map(x => String(x.Id)));

        // 真实库根节点：优先祖先链里「是库根且非聚合」；若祖先链只给了聚合壳，
        // 则自行用 item.LibraryId 造一个，确保链从真实媒体库开始。
        let rootNode = ordered.find(x => isLibraryRoot(x, realLibId) && !isAggType(x));
        if (!rootNode && realLibId) {
            rootNode = { Id: realLibId, Name: libName || '当前媒体库', Type: 'CollectionFolder' };
        }

        // v2.1.11 对齐 embytok handleBrowseFolders：目标 = 祖先链里「最深一层」= 视频直接所在文件夹，
        // 而不再用「ParentId 匹配失败就退回媒体库根」。ordered 已统一成 外→内，末项即最深文件夹
        // （剧集会返回 [库, Series, Season]，最深就是 Season，与 embytok 完全一致）。
        // 取数再用 nonRecursive=true（只取这一层），才是「视频所在文件夹里的视频」，而非整库。
        const deepest = [...ordered].reverse().find(x => !isAggType(x));
        const pid = item.ParentId || item.SeasonId || item.SeriesId;
        let targetNode = deepest || null;
        if (!targetNode && pid != null && String(pid) !== String(realLibId) && !aggIds.has(String(pid))) {
            // 祖先链没返回时的兜底（部分服务/数据形态）：用视频自身的 ParentId
            targetNode = { Id: String(pid), Name: item.SeriesName || item.Name || '所在文件夹', Type: 'Folder' };
        }
        if (!targetNode && rootNode) {
            targetNode = rootNode;   // 极端兜底：视频就在媒体库根目录
        }
        if (!targetNode) return toast('未能定位当前视频所在文件夹');

        // 组装外→内链：库根 → … → 目标。优先用祖先链 slice，缺失时退化为 [库根, 目标]。
        let chain;
        const rp = rootNode ? ordered.findIndex(x => String(x.Id) === String(rootNode.Id)) : -1;
        const tp = ordered.findIndex(x => String(x.Id) === String(targetNode.Id));
        if (rp >= 0 && tp >= 0 && rp !== tp) {
            const [a, b] = rp < tp ? [rp, tp] : [tp, rp];
            const seg = ordered.slice(a, b + 1);
            chain = (rp < tp) ? seg : seg.slice().reverse();
        } else {
            chain = [];
            if (rootNode && String(rootNode.Id) !== String(targetNode.Id)) chain.push(rootNode);
            chain.push(targetNode);
        }
        if (!chain.length) return toast('未能定位当前视频所在媒体库');

        // v2.1.8：长按头像 = 直接展示该视频所在文件夹的视频列表并定位当前视频，
        // 不再进入带层级导航的文件夹视图（chain 仅保留作返回栈兼容，不在此使用）。
        await openFolderVideoList(targetNode, item);
    }

    /** 退出临时文件夹状态（供「所有媒体」等全局视图切换调用，不负责切视图） */
    function exitFolder() {
        const d = app && app.drama;
        if (d) { d.forceFolderMode = false; d.reset(); }
        folderOpen = false;
        videoListMode = false;
        snapshot = null;
        backMode = 'layers';
        playingId = null;
        const appEl = document.getElementById('app');
        if (appEl) appEl.classList.remove('folder-list-active');
    }

    /**
     * v1.2.7 第 1 项：文件夹状态下点击底部四宫格 → 退出文件夹临时视图，
     * 直接进入当前媒体库的宫格视频列表（进度条 / 底部栏状态保持正常）。
     */
    async function exitFolderToGrid() {
        if (!folderOpen) return;
        const d = app && app.drama;
        if (d) { d.forceFolderMode = false; d.reset(); }
        folderOpen = false;
        videoListMode = false;
        backMode = 'layers';
        restoreSnapshot();               // 取回进入文件夹前的媒体库上下文
        const s = app.state;
        s.viewMode = 'grid';
        s.isFilteredByPerson = false;
        s.isFilteredByTag = false;
        s.currentPerson = null;
        s.currentTag = null;
        s.startIndex = 0;
        const appEl = document.getElementById('app');
        if (appEl) {
            appEl.classList.remove('interface-hidden', 'folder-list-active');
            appEl.classList.add('grid-active');
        }
        const viewBtn = document.getElementById('viewModeBtn');
        if (viewBtn) {
            viewBtn.innerHTML = '<i data-lucide="layout-grid" class="stroke-current w-5 h-5"></i>';
            if (window.lucide) window.lucide.createIcons({ root: viewBtn });
        }
        const libArg = s.currentLibraryId === 'favorites' ? null : s.currentLibraryId;
        try { await app.fetchVideos(libArg, null, false, false); }
        catch (e) { try { app.renderSlides(); } catch (e2) { } }
    }

    function bindAvatarLongPress() {
        const el = document.getElementById('personBtn');
        if (!el) return;
        const clear = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
        el.addEventListener('pointerdown', () => {
            longFired = false;
            clear();
            pressTimer = setTimeout(() => {
                longFired = true;
                pressTimer = null;
                openDeepestFolder();
            }, LONG_MS);
        }, { passive: true });
        el.addEventListener('pointerup', clear);
        el.addEventListener('pointerleave', clear);
        el.addEventListener('pointercancel', clear);

        // 1) capture 阶段尽量吞掉长按后的那次 click
        el.addEventListener('click', (e) => {
            if (!longFired) return;
            e.stopImmediatePropagation();
            e.preventDefault();
            longFired = false;
        }, true);

        // 2) 目标元素上 capture / onclick 的执行顺序在不同浏览器不完全一致，
        //    这里再包装一次 onclick 兜底，保证长按绝不会顺带触发演员筛选。
        //    init() 在 window.onload 中晚于 app.bindEvents()，因此 orig 已是最终 handler。
        const orig = typeof el.onclick === 'function' ? el.onclick : null;
        el.onclick = function (e) {
            if (longFired) {
                e.stopPropagation();
                e.preventDefault();
                longFired = false;
                return;
            }
            if (orig) return orig.call(this, e);
        };
    }

    function bindFolderButton() {
        const btn = document.getElementById('folderBtn');
        if (btn) {
            btn.onclick = (e) => { e.stopPropagation(); openCurrentFolder(); };
        }
        // grid 顶栏返回按钮：沿预填的祖先链一层层往上退，最后一层才回播放页。
        // 不复用 drama.popFolder 的 input history 分支（那会触发 window.history.back 而非本地换层）。
        const d = app && app.drama;
        if (d && typeof d.popFolder === 'function') {
            const origPop = d.popFolder.bind(d);
            d.popFolder = function () {
                if (!folderOpen) return origPop();
                if (!d.folderStack || d.folderStack.length <= 1) return backToPlaying();
                const prev = d.folderStack.pop();
                d.lastFocusedEpisodeId = null;
                d.currentFolderId = prev.id;
                d.currentFolderName = prev.name || '文件夹';
                d.currentFolderType = prev.type || 'Folder';
                app.state.startIndex = 0;
                app.fetchVideos(prev.id);
                return true;
            };
        }
    }

    function init(appInstance) {
        app = appInstance || null;
        if (!app) return;
        bindAvatarLongPress();
        bindFolderButton();
    }

    window.EmbyProFolderNav = {
        init, openCurrentFolder, openDeepestFolder, backToPlaying, exitFolder,
        exitFolderToGrid, clearVideoList,
        // v1.3.2：文件夹内就地起播 / 回文件夹列表 / 当前播放 Id
        playInFolder, backToFolderGrid,
        playingItemId: () => playingId,
        orderAncestors,
        // v2.1.9：暴露纯定位函数供自动化回归（无副作用）
        focusItem, centerItem,
        isFolderOpen: () => folderOpen,
        gestureBackMode: () => backMode,
        isLongPressFolder: () => (folderOpen && backMode === 'playing') || videoListMode,
        isVideoListMode: () => videoListMode
    };
})();
