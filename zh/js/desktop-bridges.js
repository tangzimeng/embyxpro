/**
 * EmbyPro 通用桌面交互兜底（安卓 / Windows 共用前端）
 *
 * 1) 从播放流切到宫格视图时，grid.render() 会 container.innerHTML=''
 *    销毁 <video>，切回来就重新缓冲。这里在切走前把整个 videoContainer
 *    的 slide 子节点（含 3 个 video + HLS + 播放进度）移入隐藏宿主保活；
 *    切回时原样移回并恢复 stage.slides，视频从未卸载 → 直接从原进度续播。
 *    若用户在宫格里点了别的视频起播，则丢弃保活、走正常重建，避免双声。
 *
 * 2) 滚轮切视频兜底：前端 input.js 的 bindWheel 有 viewMode / 弹窗等守卫，
 *    自动恢复登录后状态可能出现守卫拦掉滚轮的情况。这里用 document 级
 *    wheel 监听 + e.defaultPrevented 与前端互斥：前端处理过就不重复切；
 *    前端没处理但确实在播放态时补上。
 *
 * 3) 多窗口失焦降载（v2.1.12）：与抖音等 App 并行时，本 App 退到后台仍
 *    让 3 槽视频拉流/解码会抢占资源致切视频卡顿。失焦时暂停全部视频、
 *    销毁纯预取槽的 HLS（保留当前视频进度/HLS），回前台直接续播不重新缓冲。
 *
 * 注意：隐藏宿主不能用 display:none，部分内核会挂起视频；用移出可视区 +
 * 极小尺寸 + opacity 代替。
 */
(function () {
    'use strict';

    if (window.__embyxDesktopBridges) return;
    window.__embyxDesktopBridges = true;

    var HOST_ID = '__embyx_bg_video_host';
    var watchTimer = null;
    var suspended = null;   // { children, className, styleText, index, active }

    function app() {
        return window.app || null;
    }

    function host() {
        var h = document.getElementById(HOST_ID);
        if (!h) {
            h = document.createElement('div');
            h.id = HOST_ID;
            h.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1';
            (document.body || document.documentElement).appendChild(h);
        }
        return h;
    }

    function destroyHls(v) {
        try { if (v._preloadHls) { v._preloadHls.destroy(); v._preloadHls = null; } } catch (e) { }
        try { if (v.__embyxHls) { v.__embyxHls.destroy(); v.__embyxHls = null; } } catch (e) { }
        var a = app();
        try {
            if (a && a.player && a.player.activeHls && a.player.activeHls.media === v) {
                a.player.activeHls.destroy();
                a.player.activeHls = null;
                window.activeHls = null;
            }
        } catch (e) { }
    }

    function clearHost() {
        var h = document.getElementById(HOST_ID);
        if (!h) return;
        var vs = h.querySelectorAll('video');
        for (var i = 0; i < vs.length; i++) {
            destroyHls(vs[i]);
            try { vs[i].pause(); } catch (e) { }
            try { vs[i].removeAttribute('src'); vs[i].srcObject = null; vs[i].load(); } catch (e) { }
        }
        try { h.innerHTML = ''; } catch (e) { }
    }

    function stopWatch() {
        if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
    }

    /** 放弃保活：宫格里点了别的视频、或视图已回到 stream 却没走 resume 时调用 */
    function discardSuspended() {
        stopWatch();
        if (!suspended) return;
        clearHost();
        suspended = null;
    }

    /** 回到 stream 后，若仍无新片在播则丢弃保活（防止旧视频后台双声） */
    function startWatch() {
        stopWatch();
        watchTimer = setInterval(function () {
            if (!suspended) { stopWatch(); return; }
            var a = app();
            if (a && a.state && a.state.viewMode === 'stream') discardSuspended();
        }, 500);
    }

    /**
     * 切到宫格前调用：把整个 videoContainer 的子节点移入隐藏宿主。
     * 移动 DOM 节点不会中断 WebView/Chromium 播放，进度/HLS 全部保留。
     */
    function suspendStreamView() {
        var box = document.getElementById('videoContainer');
        var a = app();
        if (!box || !a || !a.state) return false;
        if (a.state.viewMode !== 'stream') return false;

        var vs = box.querySelectorAll('video');
        var active = null;
        for (var i = 0; i < vs.length; i++) {
            if (!vs[i].paused && vs[i].readyState >= 1) { active = vs[i]; break; }
        }
        if (!active) return false;

        try {
            if (a.player && a.player.activeHls && a.player.activeHls.media === active) {
                active.__embyxHls = a.player.activeHls;
            }
            var children = [];
            for (var j = 0; j < box.children.length; j++) children.push(box.children[j]);
            suspended = {
                children: children,
                className: box.className,
                styleText: box.getAttribute('style') || '',
                index: a.state.currentIndex,
                active: active
            };
            var h = host();
            for (var k = 0; k < children.length; k++) h.appendChild(children[k]);
            startWatch();
            return true;
        } catch (e) {
            suspended = null;
            return false;
        }
    }

    /**
     * 切回 stream 时调用：把保活的 slide 原样移回，恢复引用。
     * 返回 true 表示已续播，调用方应跳过 renderSlides/loadVideo/playVideo。
     * 若用户在宫格里换了片子（currentIndex 变了），返回 false 走正常重建。
     */
    function resumeStreamView() {
        if (!suspended) return false;
        var a = app();
        var kept = suspended;
        if (kept.index != null && a && a.state && a.state.currentIndex !== kept.index) {
            discardSuspended();
            return false;
        }
        var box = document.getElementById('videoContainer');
        if (!box) { discardSuspended(); return false; }
        try {
            stopWatch();
            box.innerHTML = '';                       // 清掉宫格 DOM
            box.className = kept.className;
            box.setAttribute('style', kept.styleText);
            for (var i = 0; i < kept.children.length; i++) box.appendChild(kept.children[i]);
            // slide 元素 id 未变（video-p0/1/2），重取一遍恢复 stage/dom 引用
            if (a && a.stage) {
                a.stage.slides = [
                    document.getElementById('slide-0'),
                    document.getElementById('slide-1'),
                    document.getElementById('slide-2')
                ];
            }
            if (a && a.dom) a.dom.slides = a.stage ? a.stage.slides : null;
            // HLS 若被别的链路清掉，从保活 video 上恢复
            if (a && a.player && !a.player.activeHls && kept.active.__embyxHls) {
                a.player.activeHls = kept.active.__embyxHls;
                window.activeHls = kept.active.__embyxHls;
            }
            suspended = null;
            return true;
        } catch (e) {
            discardSuspended();
            return false;
        }
    }

    // ── 滚轮兜底 ──────────────────────────────────────────────
    var COOLDOWN = 500;
    var lastSwitch = 0;

    var MODAL_IDS = ['addToPlaylistModal', 'libraryModal', 'mediaInfoModal',
        'castModal', 'deleteConfirmModal', 'syncConfirmModal', 'profilePage',
        'settingsModal', 'globalSettingsModal', 'accountPanel', 'serverModal'];

    function anyModalOpen() {
        for (var i = 0; i < MODAL_IDS.length; i++) {
            var el = document.getElementById(MODAL_IDS[i]);
            if (el && !el.classList.contains('hidden')) return true;
        }
        return !!document.querySelector('.modal:not(.hidden), .overlay:not(.hidden), [data-modal]:not(.hidden)');
    }

    document.addEventListener('wheel', function (e) {
        if (e.defaultPrevented) return;              // 前端 bindWheel 已处理，绝不重复切
        if (e.ctrlKey) return;                       // Ctrl+滚轮留给缩放
        var dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= 100;
        if (Math.abs(dy) < 5) return;

        var a = app();
        if (!a || !a.state) return;

        // 播放态判定：视频容器可见 + 有已加载视频，不依赖 viewMode 字符串
        var box = document.getElementById('videoContainer');
        if (!box || !box.getClientRects || box.getClientRects().length === 0) return;
        var vids = box.querySelectorAll('video');
        var playing = false;
        for (var i = 0; i < vids.length; i++) {
            var v = vids[i];
            if (!v.paused || v.currentTime > 0 || v.readyState >= 2 || v.currentSrc) { playing = true; break; }
        }
        if (!playing) return;

        try { if (typeof a.isAnyModalOpen === 'function' && a.isAnyModalOpen()) return; } catch (err) { }
        if (anyModalOpen()) return;
        var t = e.target;
        if (t && t.closest) {
            var m = t.closest('.modal, .overlay, [data-modal]');
            if (m && m.getClientRects && m.getClientRects().length > 0) return;
        }
        if (a.castManager && a.castManager.isCasting) return;

        var now = Date.now();
        if (now - lastSwitch < COOLDOWN) { e.preventDefault(); return; }
        e.preventDefault();
        lastSwitch = now;
        try {
            if (dy > 0) a.nextVideo();
            else a.prevVideo();
            if (typeof a.showInterfaceTemp === 'function') a.showInterfaceTemp();
        } catch (err) { }
    }, { passive: false });

    // ── 多窗口失焦降载（v2.1.12 播放隔离）───────────────────────────
    // 与抖音等 App 多窗口并行时，本 App 退到后台若仍让 3 槽视频拉流/解码，
    // 会抢占网络与解码资源，导致前台 App 切视频卡顿、本 App 切回也卡。
    // 失焦/隐藏时：暂停全部 video + 销毁纯预取槽的 HLS（这些只为"预加载"，
    // 没有当前进度）；当前视频仅暂停，保留 HLS 实例与播放进度 → 回前台
    // 直接续播、不重新缓冲。离开即释放资源，回来即恢复，互不干扰。
    var bgIdle = false;
    var bgWasPlaying = false;
    var bgBlurTimer = null;

    function curVideo() {
        var a = app();
        if (!a || !a.state || !a.state.videos) return null;
        var idx = ((a.state.currentIndex % 3) + 3) % 3;
        return document.getElementById('video-p' + idx);
    }

    function enterBgIdle() {
        if (bgIdle) return;
        var a = app();
        if (!a || !a.state || a.state.viewMode !== 'stream') return;
        var box = document.getElementById('videoContainer');
        if (!box) return;
        var vs = box.querySelectorAll('video');
        var hasMedia = false;
        for (var i = 0; i < vs.length; i++) {
            if (vs[i].currentSrc || vs[i].readyState > 0) { hasMedia = true; break; }
        }
        if (!hasMedia) return;

        bgIdle = true;
        var cur = curVideo();
        bgWasPlaying = !!(cur && !cur.paused);

        for (var j = 0; j < vs.length; j++) {
            var v = vs[j];
            try { v.pause(); } catch (e) { }
            if (v === cur) continue;                  // 当前视频：保留 HLS + 进度，仅暂停
            try { if (v._preloadHls) { v._preloadHls.destroy(); v._preloadHls = null; } } catch (e) { }
            try { v.dataset.hlsLoading = 'false'; delete v.dataset.pendingPlay; } catch (e) { }
            // 清掉对应 slide 的 id，让回前台 renderBuffer 能重建相邻预取
            var m = /^video-p(\d+)$/.exec(v.id || '');
            if (m) {
                var sl = document.getElementById('slide-' + m[1]);
                if (sl) sl.dataset.id = '';
            }
        }
    }

    function leaveBgIdle() {
        if (!bgIdle) return;
        bgIdle = false;
        var a = app();
        var cur = curVideo();
        if (bgWasPlaying && cur && a) {
            try {
                if (cur.currentSrc || cur.readyState > 0) {
                    var pr = cur.play();
                    if (pr && pr.catch) pr.catch(function () { });
                } else if (typeof a.loadVideo === 'function') {
                    Promise.resolve(a.loadVideo(a.state.currentIndex))
                        .then(function () { return a.player && a.player.playVideo(a.state.currentIndex); })
                        .catch(function () { });
                }
            } catch (e) { }
        }
        bgWasPlaying = false;
        // 回前台稳定后再重建相邻预取，避免抢占刚恢复的当前视频
        setTimeout(function () {
            if (bgIdle) return;
            var a2 = app();
            if (a2 && a2.stage && a2.state && a2.state.viewMode === 'stream'
                && typeof a2.stage.renderBuffer === 'function') {
                try { a2.stage.renderBuffer(); } catch (e) { }
            }
        }, 900);
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { clearTimeout(bgBlurTimer); enterBgIdle(); }
        else { clearTimeout(bgBlurTimer); setTimeout(leaveBgIdle, 120); }
    });
    window.addEventListener('blur', function () {
        clearTimeout(bgBlurTimer);
        // 延迟确认：分屏/其它窗口置前且仍无焦点时才降载，避免瞬时 blur 误触发
        bgBlurTimer = setTimeout(function () {
            if (document.hidden) return;
            try { if (document.hasFocus && document.hasFocus()) return; } catch (e) { }
            enterBgIdle();
        }, 450);
    });
    window.addEventListener('focus', function () {
        clearTimeout(bgBlurTimer);
        setTimeout(leaveBgIdle, 120);
    });

    window.EmbyProDesktopBridges = {
        suspendStreamView: suspendStreamView,
        resumeStreamView: resumeStreamView,
        discardSuspended: discardSuspended,
        hasSuspended: function () { return !!suspended; },
        enterBgIdle: enterBgIdle,
        leaveBgIdle: leaveBgIdle
    };
})();
