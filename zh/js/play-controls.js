/*
 * play-controls.js —— EmbyPro 播放页「左下四键 + 快捷按钮」自包含模块
 * 参考来源：EmbyXPlus v2.2.5 交付包 src/zh/js/servers.js
 *   - 419 / 426 行      GLASS、menuEl
 *   - 746-785 行        openQuickMenu()
 *   - 790-797 行        QUALITY_OPTIONS / RATE_STEPS / RATE_KEY
 *   - 801-967 行        播放控制函数组
 *   - 1102-1115 行      init() 内左下四键绑定
 *   - 1142-1156 行      init() 内 app.updateUI 包装 + 首次套用
 * 额外按钮（randomBtn / autoplayBtn / shortDramaTopBtn / netModeBtn / feed 模式胶囊）
 * 由本模块自行实现，不改动任何既有文件。
 */
(function () {
    'use strict';

    // 由 init(appInstance) 注入，模块内不自行抓取全局 app
    let app = null;

    // ═══════════════════════════════════════════
    // § 1. 快捷菜单（复制自 servers.js 419 / 426 / 746-785）
    // ═══════════════════════════════════════════
    const GLASS = 'bg-black/40 backdrop-blur-xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_20px_40px_rgba(0,0,0,0.5)]';
    let menuEl = null;

    function openQuickMenu(anchor, items, title) {
        if (!anchor || !Array.isArray(items)) return;
        if (!menuEl) {
            menuEl = document.createElement('div');
            menuEl.id = 'quickMenu';
            menuEl.className = 'fixed inset-0 z-[80] hidden';
            document.body.appendChild(menuEl);
        }
        const rows = items.map((it, i) => `
            <div class="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer ${it.active ? 'bg-primary/20 text-primary' : 'text-white/85 hover:bg-white/10'} active:scale-[0.98] transition-all" data-i="${i}">
                <span class="text-sm">${it.label}</span>
                ${it.active ? '<i data-lucide="check" class="w-4 h-4"></i>' : ''}
            </div>`).join('');

        menuEl.innerHTML = `
            <div class="absolute inset-0" data-close="1"></div>
            <div class="absolute ${GLASS} rounded-xl p-2 w-40" id="quickMenuCard">
                <div class="text-[11px] text-white/45 px-2 pb-1">${title}</div>
                ${rows}
            </div>`;
        menuEl.classList.remove('hidden');

        const card = menuEl.querySelector('#quickMenuCard');
        const r = anchor.getBoundingClientRect();
        const cardH = card.offsetHeight || 200;
        let left = r.right + 10;
        if (left + 160 > window.innerWidth - 8) left = Math.max(8, r.left - 170);
        let top = Math.max(8, Math.min(r.top - 4, window.innerHeight - cardH - 8));
        card.style.left = left + 'px';
        card.style.top = top + 'px';

        const closeEl = menuEl.querySelector('[data-close]');
        if (closeEl) closeEl.onclick = () => menuEl.classList.add('hidden');
        menuEl.querySelectorAll('[data-i]').forEach((el) => {
            el.onclick = () => {
                const it = items[Number(el.dataset.i)];
                menuEl.classList.add('hidden');
                if (it && typeof it.onPick === 'function') it.onPick();
            };
        });
        if (window.lucide) window.lucide.createIcons({ root: menuEl });
    }

    // ═══════════════════════════════════════════
    // § 2. 常量（复制自 servers.js 790-797）
    // ═══════════════════════════════════════════
    const QUALITY_OPTIONS = [
        { key: 'direct', label: '直接播放（原画）', short: 'D' },
        { key: 'auto', label: '自动转码', short: 'A' },
        { key: '1080p', label: '1080P · 8Mbps', short: '1' },
        { key: '720p', label: '720P · 4Mbps', short: '7' }
    ];
    const RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    const RATE_KEY = 'emby_play_rate';

    // ═══════════════════════════════════════════
    // § 3. 静默降级小工具（getElementById / app 方法全部做空值保护）
    // ═══════════════════════════════════════════
    function toast(msg) {
        if (app && typeof app.showToast === 'function') app.showToast(msg);
    }
    function keepInterface() {
        if (app && typeof app.showInterfaceTemp === 'function') app.showInterfaceTemp();
    }
    /** 把按钮内的图标替换为 data-lucide 图标；不破坏按钮内其它子元素 */
    function paintIcon(el, name, cls) {
        if (!el) return;
        const old = el.querySelector('[data-lucide]');
        const i = document.createElement('i');
        i.setAttribute('data-lucide', name);
        i.setAttribute('class', cls);
        if (old) old.replaceWith(i);
        else {
            const host = el.querySelector('div') || el;
            host.appendChild(i);
        }
        if (window.lucide) window.lucide.createIcons({ root: el });
    }

    // ═══════════════════════════════════════════
    // § 4. 左下角四键（复制自 servers.js 801-967）
    // ═══════════════════════════════════════════
    const currentQuality = () => (app && app.config.playQuality) || localStorage.getItem('emby_play_quality') || 'direct';
    const currentRate = () => {
        const v = parseFloat(localStorage.getItem(RATE_KEY) || '1');
        return isFinite(v) && v > 0 ? v : 1;
    };

    function currentVideoEl() {
        if (!app || !app.state) return null;
        const idx = app.state.currentIndex;
        const slide = (idx % 3 + 3) % 3;
        return document.getElementById(`video-p${slide}`) || null;
    }

    function updateLeftIcons() {
        const q = currentQuality();
        const opt = QUALITY_OPTIONS.find(o => o.key === q) || QUALITY_OPTIONS[0];
        const ql = document.getElementById('qualityLabel');
        if (ql) ql.textContent = opt.short;

        const rate = currentRate();
        const rl = document.getElementById('rateLabel');
        if (rl) rl.textContent = (rate % 1 === 0 ? rate.toFixed(0) : String(rate)) + 'x';

        // 观看状态：已看 = 实心对勾，未看 = 空心圆
        const item = app && app.state && app.state.videos ? app.state.videos[app.state.currentIndex] : null;
        const played = !!(item && item.UserData && item.UserData.Played);
        const holder = document.getElementById('watchedBtn');
        if (!holder) return;
        const want = played ? 'circle-check' : 'circle';
        holder.classList.toggle('epp-active', played);   // v1.2.7：已看状态色按状态生效
        if (holder.getAttribute('data-watched') === want) return;
        holder.setAttribute('data-watched', want);
        holder.innerHTML = `<div class="w-11 h-11 rounded-full flex items-center justify-center bg-black/25 backdrop-blur-xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_24px_rgba(0,0,0,0.3)]"><i data-lucide="${want}" class="${played ? 'text-primary' : 'stroke-white'} w-5 h-5 drop-shadow-md"></i></div>`;
        if (window.lucide) window.lucide.createIcons({ root: holder });
    }

    /** 重建当前视频的播放源（画质切换 / 刷新共用），可保留播放进度 */
    function reloadCurrent(keepTime) {
        if (!app || !app.player) return;
        const idx = app.state.currentIndex;
        const item = app.state.videos && app.state.videos[idx];
        if (!item) return;
        const p = app.player;
        const v = currentVideoEl();
        if (!v) return;

        const resumeAt = keepTime ? (v.currentTime || 0) : 0;

        // 拆掉旧的 HLS / mpegts 实例，避免请求叠加
        if (p.activeHls) { try { p.activeHls.destroy(); } catch (e) {} p.activeHls = null; window.activeHls = null; }
        if (p.activeMpegts) { try { p.activeMpegts.destroy(); } catch (e) {} p.activeMpegts = null; }

        const q = currentQuality();
        app.config.useStatic = (q === 'direct');
        const src = (q === 'direct')
            ? p.getVideoSrc(item.Id, item, true)
            : p._buildHlsSrc(item.Id, item, true, q);

        p.setVideoSource(v, src, idx, item, { autoplay: true });
        v.dataset.fromReload = 'true';
        if (resumeAt > 1) {
            const onMeta = () => {
                try { v.currentTime = resumeAt; } catch (e) {}
                v.removeEventListener('loadedmetadata', onMeta);
            };
            v.addEventListener('loadedmetadata', onMeta);
        }
        p.playVideo(idx);
    }

    function pickQuality() {
        const anchor = document.getElementById('qualityBtn');
        if (!anchor) return;
        const q = currentQuality();
        const items = QUALITY_OPTIONS.map(o => ({
            label: o.label,
            active: o.key === q,
            onPick: () => {
                if (!app || o.key === currentQuality()) return;
                app.config.playQuality = o.key;
                app.config.useStatic = (o.key === 'direct');
                localStorage.setItem('emby_play_quality', o.key);
                localStorage.setItem('emby_static', o.key === 'direct');
                const sel = document.getElementById('configPlayQuality');
                if (sel) sel.value = o.key;
                updateLeftIcons();
                toast('画质切换为 ' + o.label);
                reloadCurrent(true);
            }
        }));
        openQuickMenu(anchor, items, '画质');
    }

    function pickRate() {
        const anchor = document.getElementById('rateBtn');
        if (!anchor) return;
        const r = currentRate();
        const items = RATE_STEPS.map(step => ({
            label: (step % 1 === 0 ? step.toFixed(0) : String(step)) + 'x' + (step === 1 ? '（正常）' : ''),
            active: Math.abs(step - r) < 0.001,
            onPick: () => {
                localStorage.setItem(RATE_KEY, String(step));
                applyRate(step);
                updateLeftIcons();
                toast('倍速 ' + (step % 1 === 0 ? step.toFixed(0) : step) + 'x');
            }
        }));
        openQuickMenu(anchor, items, '播放倍速');
    }

    function applyRate(rate) {
        const v = currentVideoEl();
        if (v) v.playbackRate = rate;
    }

    async function toggleWatched() {
        if (!app || !app.state || !app.config) return;
        const item = app.state.videos && app.state.videos[app.state.currentIndex];
        if (!item) return;
        const { server, token, userId } = app.config;
        if (!server || !token || !userId) return toast('请先登录服务器');

        const nowPlayed = !!(item.UserData && item.UserData.Played);
        const url = `${server}/emby/Users/${userId}/PlayedItems/${item.Id}?api_key=${token}`;
        try {
            const res = await fetch(url, {
                method: nowPlayed ? 'DELETE' : 'POST',
                headers: app.getAuthHeaders(token)
            });
            if (!res.ok) {
                toast('❌ 操作失败 ' + res.status);
                return;
            }
            item.UserData = item.UserData || {};
            item.UserData.Played = !nowPlayed;
            updateLeftIcons();
            toast(nowPlayed ? '已标记为未看' : '已标记为已看');
        } catch (e) {
            toast('❌ 网络错误，未同步观看状态');
        }
    }

    function refreshCurrent() {
        toast('正在重新连接…');
        reloadCurrent(true);
    }

    // 2.1.8：左下角「刷新」按钮 —— 单击 = 重新连接并继续播放（keepTime）；长按 = 重新连接并从头播放
    function bindRefreshLongPress() {
        const el = document.getElementById('refreshBtn');
        if (!el) return;
        let timer = null;
        let fired = false;
        const LONG_MS = 500;
        const start = () => {
            fired = false;
            timer = setTimeout(() => {
                fired = true;
                toast('重新连接并从头播放');
                reloadCurrent(false);   // currentTime = 0
            }, LONG_MS);
        };
        const end = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            if (fired) { fired = false; return; }   // 长按已处理，短按动作跳过
            refreshCurrent();
            keepInterface();
        };
        el.addEventListener('pointerdown', (e) => { e.stopPropagation(); start(); });
        el.addEventListener('pointerup', (e) => { e.stopPropagation(); end(); });
        el.addEventListener('pointerleave', () => { if (timer) { clearTimeout(timer); timer = null; } });
        el.addEventListener('pointercancel', () => { if (timer) { clearTimeout(timer); timer = null; } });
    }

    // ═══════════════════════════════════════════
    // § 5. 额外快捷按钮（模块内自实现）
    // ═══════════════════════════════════════════

    // 5.1 randomBtn：随机 / 顺序，图标 shuffle / repeat
    function syncRandomIcon() {
        const el = document.getElementById('randomBtn');
        if (!el) return;
        const isRandom = !!(app && app.state && app.state.playMode === 'random');
        el.classList.toggle('epp-active', isRandom);   // v1.2.7：图标区域「开启色」按状态生效
        paintIcon(el, isRandom ? 'shuffle' : 'list-ordered', 'stroke-white w-5 h-5 drop-shadow-md');
    }
    function bindRandom() {
        const el = document.getElementById('randomBtn');
        if (!el) return;
        el.onclick = (e) => {
            e.stopPropagation();
            if (app && typeof app.togglePlayMode === 'function') app.togglePlayMode();
            syncRandomIcon();
            keepInterface();
        };
        syncRandomIcon();
    }

    // 5.2 autoplayBtn：右下角「自动连播」（不使用 playModeBtn，底部导航已占用）
    function syncAutoplayIcon() {
        const on = !!(app && app.config && app.config.autoplay);
        const el = document.getElementById('autoplayBtn');
        if (el) {
            el.classList.toggle('epp-active', on);   // v1.2.7：图标区域「开启色」按状态生效
            paintIcon(el, on ? 'repeat' : 'repeat-1', 'stroke-white w-5 h-5 drop-shadow-md');
        }
    }
    function bindAutoplay() {
        const el = document.getElementById('autoplayBtn');
        if (!el) return;
        el.onclick = (e) => {
            e.stopPropagation();
            if (!app || !app.config) return;
            app.config.autoplay = !app.config.autoplay;
            localStorage.setItem('emby_autoplay', app.config.autoplay ? 'true' : 'false');
            syncAutoplayIcon();
            toast(app.config.autoplay ? '✅ 已开启自动连播' : '已关闭自动连播');
            keepInterface();
        };
        syncAutoplayIcon();
    }

    // 5.3 shortDramaTopBtn：短剧模式（对齐 EmbyTok uiprefs.applyShortDrama）
    function syncShortDramaTop() {
        const on = !!(app && app.config && app.config.shortDrama);
        const inner = document.getElementById('shortDramaTopInner');
        if (inner) inner.classList.toggle('ep-top-active', on);
        const root = inner || document.getElementById('shortDramaTopBtn');
        const holder = document.getElementById('shortDramaTopBtn');
        if (holder) holder.classList.toggle('epp-active', on);   // v1.2.7：开启色按状态生效
        if (!root) return;
        const icon = root.querySelector('[data-lucide]');
        if (icon) icon.classList.toggle('text-primary', on);
    }
    function applyShortDrama(next, silent) {
        if (!app || !app.config) return;
        next = !!next;
        app.config.shortDrama = next;
        localStorage.setItem('emby_shortdrama', next ? 'true' : 'false');
        const chk = document.getElementById('configShortDrama');
        if (chk) chk.checked = next;
        if (app.dom && app.dom.configShortDrama) app.dom.configShortDrama.checked = next;
        syncShortDramaTop();
        if (!silent) toast(next ? '短剧模式已开启，正在按剧集聚合' : '短剧模式已关闭');
        if (next) {
            if (typeof app.toggleModal === 'function') app.toggleModal('profilePage', false);
            setTimeout(() => { if (typeof app.resetFilters === 'function') app.resetFilters(); }, 120);
        }
    }
    function bindShortDramaTop() {
        const el = document.getElementById('shortDramaTopBtn');
        if (!el) return;
        el.onclick = (e) => {
            e.stopPropagation();
            // v1.3.2：未激活时，播放页「短剧模式」按钮点击直达 Lab
            if (window.DonateManager && !window.DonateManager.isPlayerOne()) {
                window.DonateManager.showDonateModal();
                return;
            }
            applyShortDrama(!(app && app.config && app.config.shortDrama));
            keepInterface();
        };
        syncShortDramaTop();
    }

    // 5.4 netModeBtn：A(自动) → N(内网) → W(外网) → A
    const NET_MODES = ['auto', 'lan', 'wan'];
    const NET_LETTERS = { auto: 'A', lan: 'N', wan: 'W' };
    function getNetModeSafe() {
        const a = window.EmbyProAccount;
        if (a && typeof a.getNetMode === 'function') {
            const m = a.getNetMode();
            if (NET_MODES.indexOf(m) >= 0) return m;
        }
        return 'auto';
    }
    function syncNetModeLetter() {
        const el = document.getElementById('netModeLetter');
        if (!el) return;
        el.textContent = NET_LETTERS[getNetModeSafe()] || 'A';
    }
    function bindNetMode() {
        syncNetModeLetter();   // 启动时按 getNetMode() 初始化字母
        const el = document.getElementById('netModeBtn');
        if (!el) return;
        el.onclick = (e) => {
            e.stopPropagation();
            const cur = getNetModeSafe();
            const next = NET_MODES[(NET_MODES.indexOf(cur) + 1) % NET_MODES.length];
            const a = window.EmbyProAccount;
            if (a && typeof a.setNetMode === 'function') a.setNetMode(next);
            const ui = window.EmbyProUI;
            if (ui && typeof ui.refreshNetMode === 'function') ui.refreshNetMode();
            const letter = document.getElementById('netModeLetter');
            if (letter) letter.textContent = NET_LETTERS[next];
            keepInterface();
        };
    }

    // 5.5 feed 模式胶囊：已看 / 未看 / 最新（键名与 EmbyTok 一致：embyx_list_mode）
    const LIST_MODES = ['played', 'unwatched', 'latest'];
    const LIST_MODE_KEY = 'embyx_list_mode';
    const MODE_BTN_IDS = { played: 'modePlayedBtn', unwatched: 'modeUnwatchedBtn', latest: 'modeLatestBtn' };
    function currentListMode() {
        let m = localStorage.getItem(LIST_MODE_KEY);
        if (LIST_MODES.indexOf(m) < 0) {
            m = (app && app.state && LIST_MODES.indexOf(app.state.listMode) >= 0)
                ? app.state.listMode : 'latest';
        }
        return m;
    }
    function syncModePills() {
        const m = currentListMode();
        if (app && app.state) app.state.listMode = m;
        if (app && typeof app.syncListModeUI === 'function') {
            app.syncListModeUI();
        } else {
            Object.keys(MODE_BTN_IDS).forEach((key) => {
                const el = document.getElementById(MODE_BTN_IDS[key]);
                if (el) el.classList.toggle('active', key === m);
            });
        }
    }
    function setListMode(mode) {
        // 主程序已实现真实的 IsPlayed / IsUnplayed 过滤与重新拉取，优先委托
        if (app && typeof app.setListMode === 'function') {
            app.setListMode(mode);
            syncModePills();
            return;
        }
        const m = LIST_MODES.indexOf(mode) >= 0 ? mode : currentListMode();
        localStorage.setItem(LIST_MODE_KEY, m);
        if (app && app.state) app.state.listMode = m;
        syncModePills();
        if (app && typeof app.fetchVideos === 'function') {
            try { app.fetchVideos(null, null, false, false); } catch (e) {}
        }
        document.dispatchEvent(new CustomEvent('embypro:listmode', { detail: { mode: m } }));
    }
    function bindModePills() {
        Object.keys(MODE_BTN_IDS).forEach((key) => {
            const el = document.getElementById(MODE_BTN_IDS[key]);
            if (!el) return;
            el.onclick = (e) => {
                e.stopPropagation();
                setListMode(key);
                keepInterface();
            };
        });
        syncModePills();
    }

    // 5.6 设置页 4 项「切换即生效」：删除登录表单 / 保存按钮后，由这里落盘
    //     键名与 auth.js 的 loadConfig() / savePrefs() 严格对齐
    function bindPrefSwitches() {
        const cfg = (app && app.config) || null;

        const qSel = document.getElementById('configPlayQuality');
        if (qSel) {
            qSel.value = (cfg && cfg.playQuality) || localStorage.getItem('emby_play_quality') || 'direct';
            qSel.onchange = () => {
                const k = qSel.value;
                if (cfg) { cfg.playQuality = k; cfg.useStatic = (k === 'direct'); }
                localStorage.setItem('emby_play_quality', k);
                localStorage.setItem('emby_static', k === 'direct');
                updateLeftIcons();
                if (app && app.state && app.state.viewMode === 'stream') reloadCurrent(true);
                const opt = qSel.options[qSel.selectedIndex];
                toast('画质：' + (opt ? opt.text : k));
            };
        }

        const bindChk = (id, key, storeKey, after) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.checked = !!(cfg && cfg[key]);
            el.onchange = () => {
                if (cfg) cfg[key] = el.checked;
                localStorage.setItem(storeKey, el.checked ? 'true' : 'false');
                if (after) after(el.checked);
                toast('设置已保存');
            };
        };
        bindChk('configAutoplay', 'autoplay', 'emby_autoplay', () => syncAutoplayIcon());
        bindChk('configShortDrama', 'shortDrama', 'emby_shortdrama', (checked) => {
            // silent：由 bindChk 统一提示「设置已保存」，避免重复 toast
            applyShortDrama(checked, true);
        });
        bindChk('configDeleteMode', 'deleteMode', 'emby_delete_mode', () => {
            const am = app && (app.auth || app.authManager);
            if (am && typeof am.syncDeleteBtnVisibility === 'function') am.syncDeleteBtnVisibility();
            // v1.3.1：删除按钮显隐由 ui-prefs 统一裁决（该类在 apply() 里对 deleteBtn 做「双开关」判断）
            if (window.EmbyProUIPrefs && typeof window.EmbyProUIPrefs.apply === 'function') {
                window.EmbyProUIPrefs.apply();
            }
        });

        // v1.2.6：记忆播放（开启后从服务端续播点继续）
        const rememberChk = document.getElementById('configRememberPlay');
        if (rememberChk) {
            const saved = localStorage.getItem('emby_remember_play') === 'true';
            rememberChk.checked = saved;
            if (cfg) cfg.rememberPlay = saved;
            rememberChk.onchange = () => {
                if (cfg) cfg.rememberPlay = rememberChk.checked;
                localStorage.setItem('emby_remember_play', rememberChk.checked ? 'true' : 'false');
                toast('设置已保存');
            };
        }

        // v1.2.6：随机播放（同步左下角 randomBtn 图标；仅随机态用 shuffle，避免与自动连播的 repeat 撞图标）
        const randomChk = document.getElementById('configRandomPlay');
        if (randomChk) {
            randomChk.checked = !!(app && app.state && app.state.playMode === 'random');
            randomChk.onchange = () => {
                const on = randomChk.checked;
                if (app && app.state) {
                    app.state.playMode = on ? 'random' : 'sequence';
                    localStorage.setItem('emby_play_mode', app.state.playMode);
                }
                if (typeof syncRandomIcon === 'function') syncRandomIcon();
                toast('设置已保存');
            };
        }
    }

    // ═══════════════════════════════════════════
    // § 6. init（复制自 servers.js 1102-1115 / 1142-1156，并接入额外按钮）
    // ═══════════════════════════════════════════
    function init(appInstance) {
        app = appInstance || null;
        if (!app) return;

        // 左下角四键
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.onclick = (e) => {
                e.stopPropagation();
                fn();
                keepInterface();
            };
        };
        // v1.3.2：未激活时，左下角「画质」按钮点击直达 Lab（不弹画质菜单）
        bind('qualityBtn', () => {
            if (window.DonateManager && !window.DonateManager.isPlayerOne()) {
                window.DonateManager.showDonateModal();
                return;
            }
            pickQuality();
        });
        bind('rateBtn', pickRate);
        bindRefreshLongPress();   // 刷新：单击继续 / 长按从头
        bind('watchedBtn', toggleWatched);

        // 额外快捷按钮
        bindRandom();
        bindAutoplay();
        bindShortDramaTop();
        bindNetMode();
        bindModePills();
        bindPrefSwitches();

        // 切视频后重新套用倍速与观看状态图标
        if (typeof app.updateUI === 'function') {
            const origUpdateUI = app.updateUI.bind(app);
            app.updateUI = function () {
                const r = origUpdateUI();
                try {
                    applyRate(currentRate());
                    updateLeftIcons();
                } catch (e) {}
                return r;
            };
        }

        updateLeftIcons();
        applyRate(currentRate());
    }

    window.EmbyProPlayControls = {
        init,
        openQuickMenu,
        updateLeftIcons,
        reloadCurrent,
        applyRate,
        syncModePills,
        setListMode
    };
})();
