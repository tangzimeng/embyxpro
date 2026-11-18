/*
 * ui-prefs.js —— EmbyPro v1.2.3「图标区域」设置（自包含模块）
 *
 * 移植基准：EmbyTok 1.5.19
 *   components/LibrarySelect.tsx:837-1093  zonesPanel（5 分区 / 竖横屏 / 三块 / 图标卡片）
 *   components/LibrarySelect.tsx:744-802  PxSlider + IconCfgRow（−/滑块/+ 与 9 色调色板）
 *   services/prefs.ts:99-313             ZoneStyle / TopBlocks / ICON_COLORS / ZONE_LIMITS
 *   services/prefs.ts:482                存储键 embyUiPrefs
 *
 * 与 v1.2.2 的关系：沿用 embyUiPrefs 中已有的 5 组布尔开关，新增
 *   zones（横竖屏各一套，只存用户改过的字段）、iconColors（只存改过色的图标）、orders。
 * 旧版开关配置可平滑迁移；未显式调整过的项目不注入任何 CSS，默认外观 100% 不变。
 * 只读 window.app / DOM / localStorage / lucide，不改动 servers.js / account-panel.js。
 */
(function () {
    'use strict';

    const KEY = 'embyUiPrefs';
    const DEF_KEY = 'embyUiPrefs_default';   // v1.2.13：用户自设的「默认状态」快照
    const STYLE_ID = 'epp-style';
    const ZSTYLE_ID = 'epp-zone-style';
    const PANEL_ID = 'buttonPrefsModal';
    const HIDE = 'epp-hidden';
    const PREVIEW = 'epp-preview';
    const TEMP_HIDE = 'epp-temp-hide';

    // 参考版 9 色：红 / 橙 / 黄 / 绿 / 青 / 蓝 / 紫 / 白 / 灰
    const COLORS = ['#ef4444', '#fb923c', '#facc15', '#4ade80', '#22d3ee',
                    '#60a5fa', '#c084fc', '#ffffff', '#9ca3af'];
    const DEFAULT_ON = '#52B54B';     // 未改色时的「开启色」显示值（EmbyPro 绿）
    const DEFAULT_OFF = '#ffffff';    // 未改色时的「关闭线条色」显示值（保持工程现状白）

    const LIMITS = {
        opacity: [0, 100], sizePx: [0, 44], gapPx: [0, 32],
        barHeightPx: [0, 88], barOpacity: [0, 100], barBlurPx: [0, 24],
        offsetPx: [0, 120], bottomPx: [0, 300], edgePx: [0, 240],
        progressHeightPx: [0, 12], heightPx: [0, 12], timeOffsetPx: [0, 300],
        titleSizePx: [10, 36], titleBottomPx: [0, 300], timeSizePx: [9, 22]
    };

    let app = null;
    let panelEl = null;
    let zoneTab = 'top';
    let orient = (window.matchMedia && window.matchMedia('(orientation: landscape)').matches)
        ? 'landscape' : 'portrait';
    let topBlock = 'left';
    let ppHidden = false;

    /* ── v1.2.2 已有的 5 组显隐开关（字段名保持兼容） ── */
    const SW_DEFAULTS = {
        top: {
            watched: true, unwatched: true, latest: true,
            volume: true, expand: true, shortDrama: true,
            netMode: true, cast: true, fullscreen: true
        },
        bottom: { grid: true, folder: true, library: true, settings: true, progress: true },
        left: { shuffle: true, quality: true, rate: true, refresh: true, watched: true, title: true },
        right: { avatar: true, like: true, favorite: true, delete: true, autoplay: true },
        list: { back: true, libName: true, sort: true, page: true, search: true }
    };

    /* ── v1.3.2 出厂默认：来自用户 2026-11-08 设置备份（完整快照） ──
       新安装 / 恢复默认 / 清除数据后直接采用这套参数；用户改过的字段仍由 localStorage 覆盖。 */
    const BUILTIN_DEFAULTS = {
    "top": {
        "watched": true,
        "unwatched": true,
        "latest": true,
        "volume": true,
        "expand": true,
        "shortDrama": false,
        "netMode": false,
        "cast": true,
        "fullscreen": true
    },
    "bottom": {
        "grid": true,
        "folder": true,
        "library": true,
        "settings": true,
        "progress": true
    },
    "left": {
        "shuffle": true,
        "quality": true,
        "rate": true,
        "refresh": true,
        "watched": true,
        "title": true
    },
    "right": {
        "avatar": true,
        "like": true,
        "favorite": true,
        "delete": true,
        "autoplay": true
    },
    "list": {
        "back": true,
        "libName": true,
        "sort": true,
        "page": true,
        "search": true
    },
    "zones": {
        "portrait": {
            "bottom": {
                "barBlur": false,
                "title": {
                    "titleBottomPx": 84,
                    "titleSizePx": 15
                },
                "offsetPx": 0,
                "barHeightPx": 50,
                "barOpacity": 100,
                "progress": {
                    "enabled": true,
                    "heightPx": 3,
                    "offsetPx": 71,
                    "timeSizePx": 12,
                    "timeOffsetPx": 53
                },
                "sizePx": 16,
                "opacity": 0,
                "barBlurPx": 5
            },
            "right": {
                "gapPx": 5,
                "bottomPx": 100,
                "sizePx": 23,
                "offsetPx": 20
            },
            "top": {
                "blocks": {
                    "left": {
                        "edgePx": 16,
                        "sizePx": 18,
                        "offsetPx": 37
                    },
                    "center": {
                        "sizePx": 12,
                        "offsetPx": 45
                    },
                    "right": {
                        "sizePx": 18,
                        "offsetPx": 37
                    }
                },
                "gapPx": 3
            },
            "left": {
                "gapPx": 13,
                "sizePx": 12,
                "opacity": 0,
                "bottomPx": 118
            },
            "list": {
                "blocks": {
                    "left": {
                        "sizePx": 10,
                        "offsetPx": 7
                    },
                    "right": {
                        "sizePx": 18
                    },
                    "center": {
                        "sizePx": 14
                    }
                },
                "barHeightPx": 45,
                "barOpacity": 100,
                "gapPx": 8
            }
        },
        "landscape": {
            "top": {
                "blocks": {
                    "left": {
                        "edgePx": 12,
                        "offsetPx": 30,
                        "sizePx": 16
                    },
                    "right": {
                        "sizePx": 16,
                        "edgePx": 15,
                        "offsetPx": 40
                    },
                    "center": {
                        "offsetPx": 20,
                        "sizePx": 15
                    }
                },
                "barHeightPx": 17,
                "barOpacity": 100
            },
            "left": {
                "sizePx": 17,
                "gapPx": 6,
                "offsetPx": 40,
                "bottomPx": 121
            },
            "bottom": {
                "sizePx": 18,
                "barHeightPx": 47,
                "progress": {
                    "enabled": true,
                    "heightPx": 3,
                    "offsetPx": 68,
                    "timeOffsetPx": 52,
                    "timeSizePx": 12
                },
                "offsetPx": 0,
                "title": {
                    "titleSizePx": 13,
                    "titleBottomPx": 74
                },
                "barOpacity": 100
            },
            "right": {
                "gapPx": 8,
                "sizePx": 18,
                "bottomPx": 89
            }
        }
    },
    "iconColors": {
        "randomBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "rateBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "watchedBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "refreshBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "qualityBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "fullscreenBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "castBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "shortDramaTopBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "muteBtn": {
            "activeMode": "stroke",
            "activeColor": "#ef4444"
        },
        "scaleBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        },
        "modePlayedBtn": {
            "activeMode": "stroke",
            "activeColor": "#ffffff"
        },
        "modeLatestBtn": {
            "activeMode": "stroke",
            "activeColor": "#ffffff"
        },
        "autoplayBtn": {
            "activeMode": "stroke",
            "activeColor": "#4ade80"
        }
    },
    "orders": {
        "left": [
            "randomBtn",
            "qualityBtn",
            "rateBtn",
            "watchedBtn",
            "refreshBtn",
            "metaInfoContainer"
        ]
    }
};

    /* ── 区域样式显示初值（对齐 1.5.19 DEFAULT_ZONES / DEFAULT_TOP_BLOCKS） ── */
    const ZD = {
        portrait: { opacity: 0, sizePx: 24, gapPx: 8, offsetPx: 12, bottomPx: 130, barHeightPx: 52, barOpacity: 45, barBlurPx: 12 },
        landscape: { opacity: 0, sizePx: 22, gapPx: 8, offsetPx: 12, bottomPx: 84, barHeightPx: 40, barOpacity: 45, barBlurPx: 12 }
    };
    const BD = {
        portrait: {
            left: { sizePx: 24, offsetPx: 14, edgePx: 12 },
            center: { sizePx: 14, offsetPx: 19, edgePx: 0 },
            right: { sizePx: 24, offsetPx: 14, edgePx: 12 }
        },
        landscape: {
            left: { sizePx: 22, offsetPx: 9, edgePx: 12 },
            center: { sizePx: 13, offsetPx: 14, edgePx: 0 },
            right: { sizePx: 22, offsetPx: 9, edgePx: 12 }
        }
    };

    /* ── 5 个分区的图标清单：[配色键, 名称, DOM id, lucide 图标, 开关组, 开关键] ── */
    const ZONES = [
        {
            id: 'top', label: '顶部', desc: '播放页顶部：分类页签 + 左上角 / 右上角图标',
            groups: [
                { title: '已看 / 未看 / 最新', items: [
                    ['modePlayedBtn', '已看', 'modePlayedBtn', 'circle-check', 'top', 'watched'],
                    ['modeUnwatchedBtn', '未看', 'modeUnwatchedBtn', 'circle-dot', 'top', 'unwatched'],
                    ['modeLatestBtn', '最新', 'modeLatestBtn', 'sparkles', 'top', 'latest']
                ] },
                { title: '顶部图标', items: [
                    ['muteBtn', '静音', 'muteBtn', 'volume-2', 'top', 'volume'],
                    ['scaleBtn', '画面比例', 'scaleBtn', 'maximize-2', 'top', 'expand'],
                    ['shortDramaTopBtn', '短剧模式', 'shortDramaTopBtn', 'clapperboard', 'top', 'shortDrama'],
                    ['netModeBtn', '网络模式', 'netModeBtn', 'wifi', 'top', 'netMode'],
                    ['castBtn', '投屏', 'castBtn', 'cast', 'top', 'cast'],
                    ['fullscreenBtn', '全屏', 'fullscreenBtn', 'maximize', 'top', 'fullscreen']
                ] }
            ]
        },
        {
            id: 'list', label: '列表', desc: '宫格 / 文件夹顶栏（与播放页顶部完全隔离）',
            groups: [{ title: '列表顶栏', items: [
                ['gridFolderBackBtn', '返回上级', 'gridFolderBackBtn', 'chevron-left', 'list', 'back'],
                ['gridLibName', '媒体库名', 'gridLibName', 'layers', 'list', 'libName'],
                ['gridSortBtn', '排序', 'gridSortBtn', 'arrow-up-down', 'list', 'sort'],
                ['gridPageInfo', '页码', 'gridPageInfo', 'hash', 'list', 'page'],
                ['gridFolderSearchBtn', '搜索', 'gridFolderSearchBtn', 'search', 'list', 'search']
            ] }]
        },
        {
            id: 'bottom', label: '底部', desc: '底部导航 4 格与播放进度条',
            groups: [{ title: '底部图标', items: [
                ['viewModeBtn', '宫格', 'viewModeBtn', 'layout-grid', 'bottom', 'grid'],
                ['folderBtn', '文件夹', 'folderBtn', 'folder-open', 'bottom', 'folder'],
                ['libraryBtn', '媒体库', 'libraryBtn', 'menu', 'bottom', 'library'],
                ['myBtn', '设置', 'myBtn', 'settings', 'bottom', 'settings'],
                ['progressBarContainer', '进度条', 'progressBarContainer', 'minus', 'bottom', 'progress']
            ] }]
        },
        {
            id: 'left', label: '左侧', desc: '播放页左下角操作列（可上下调整顺序）',
            groups: [{ title: '左下角按钮', items: [
                ['randomBtn', '随机', 'randomBtn', 'shuffle', 'left', 'shuffle'],
                ['qualityBtn', '画质', 'qualityBtn', 'sliders-horizontal', 'left', 'quality'],
                ['rateBtn', '倍速', 'rateBtn', 'gauge', 'left', 'rate'],
                ['refreshBtn', '刷新', 'refreshBtn', 'rotate-cw', 'left', 'refresh'],
                ['watchedBtn', '已看 / 未看', 'watchedBtn', 'circle-check', 'left', 'watched'],
                ['metaInfoContainer', '名称', 'metaInfoContainer', 'type', 'left', 'title']
            ] }]
        },
        {
            id: 'right', label: '右侧', desc: '播放页右下角操作列（可上下调整顺序）',
            groups: [{ title: '右侧图标', items: [
                ['personBtn', '头像 / 缩略图', 'personBtn', 'circle-user-round', 'right', 'avatar'],
                ['favoriteBtn', '收藏 / 点赞', 'favoriteBtn', 'heart', 'right', 'like'],
                ['addToPlaylistBtn', '加入播放列表', 'addToPlaylistBtn', 'star', 'right', 'favorite'],
                ['deleteBtn', '删除', 'deleteBtn', 'trash-2', 'right', 'delete'],
                ['autoplayBtn', '自动连播', 'autoplayBtn', 'infinity', 'right', 'autoplay']
            ] }]
        }
    ];

    const zoneById = id => ZONES.find(z => z.id === id) || ZONES[0];
    const clone = o => JSON.parse(JSON.stringify(o));
    const clamp = (v, field) => {
        const lim = LIMITS[field] || [0, 100];
        const n = Number(v);
        return Math.min(lim[1], Math.max(lim[0], isFinite(n) ? Math.round(n) : lim[0]));
    };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function toast(msg) { if (app && typeof app.showToast === 'function') app.showToast(msg); }

    /* ── 读写：只存「用户显式改过」的样式字段，未改的不注入 CSS ── */
    function read() {
        // v1.3.2：出厂默认改为用户备份快照（含 zones / iconColors / orders 完整值）
        const p = clone(BUILTIN_DEFAULTS);
        try {
            const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
            if (raw && typeof raw === 'object') {
                Object.keys(SW_DEFAULTS).forEach(z => {
                    if (raw[z] && typeof raw[z] === 'object') {
                        Object.keys(SW_DEFAULTS[z]).forEach(k => {
                            if (typeof raw[z][k] === 'boolean') p[z][k] = raw[z][k];
                        });
                    }
                });
                if (raw.zones && typeof raw.zones === 'object') p.zones = raw.zones;
                if (raw.iconColors && typeof raw.iconColors === 'object') p.iconColors = raw.iconColors;
                if (raw.orders && typeof raw.orders === 'object') p.orders = raw.orders;
            }
        } catch (e) { }
        return p;
    }
    function write(p) {
        try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { }
    }
    function storedZone(o, z) {
        const p = read();
        return (p.zones && p.zones[o] && p.zones[o][z]) || {};
    }
    function zoneVal(o, z) { return Object.assign({}, ZD[o], storedZone(o, z)); }
    function blockVal(o, z, bk) {
        const st = storedZone(o, z);
        return Object.assign({}, BD[o][bk], (st.blocks && st.blocks[bk]) || {});
    }
    function patchStored(fn) {
        const p = read();
        fn(p);
        write(p);
        applyStyles();
    }

    /* ── 显隐 + data-ep-icon 打标（供颜色 CSS 选择器使用） ── */
    function apply() {
        const p = read();
        ZONES.forEach(z => z.groups.forEach(g => g.items.forEach(it => {
            const el = document.getElementById(it[2]);
            if (!el) return;                       // 动态顶栏尚未生成，renderGridView 后会重跑
            el.dataset.epIcon = it[0];
            // v1.3.1：删除按钮「双开关任一开启即显示」——
            // 设置页「允许删除媒体」开着时，即便图标区域里删除被关过也强制显示，
            // 避免用户在两处开关之间反复切换却始终看不见按钮。
            const forceShow = it[2] === 'deleteBtn'
                && !!(window.app && window.app.config && window.app.config.deleteMode);
            el.classList.toggle(HIDE, !forceShow && p[it[4]][it[5]] === false);
            // 同时清掉旧版本权限逻辑写入的 inline display:none（否则 class 移除也无效）
            if (it[2] === 'deleteBtn' && el.style.display === 'none') el.style.display = '';
        })));
        const on = p.top;
        const feed = document.getElementById('feedModeBar');
        if (feed) feed.classList.toggle(HIDE, !(on.watched || on.unwatched || on.latest));
        const anyLeft = Object.keys(p.left).some(k => p.left[k]);
        const anyRight = Object.keys(p.right).some(k => p.right[k]);
        document.querySelectorAll('.left-toolbar').forEach(el => el.classList.toggle(HIDE, !anyLeft));
        document.querySelectorAll('.right-toolbar').forEach(el => el.classList.toggle(HIDE, !anyRight));
        const l = document.getElementById('topLeftGroup');
        const r = document.getElementById('topRightGroup');
        if (l) l.classList.toggle(HIDE, !(on.volume || on.expand || on.shortDrama));
        if (r) r.classList.toggle(HIDE, !(on.netMode || on.cast || on.fullscreen));
        try { fitToolbars(); } catch (e) { }
    }

    /* v1.2.11 第 1 项：横屏时左右操作列「底部固定、向上生长」（对齐参考版 EmbyTok），
       屏幕矮 + 用户调大图标 / 间距 / 上移排序后，列顶会超出屏幕顶被裁掉
       ——表现就是「横屏右下角没有删除按钮」（删除被排到列上部时整颗看不见）。
       处理：测量列顶若越过保留区（状态栏下 48px），整列以底部为锚等比缩小到刚好放得下。 */
    const TB_TOP_KEEP = 48;
    function fitToolbars() {
        ['.right-toolbar', '.left-toolbar'].forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                el.style.transform = '';
                el.style.transformOrigin = sel === '.right-toolbar' ? 'bottom right' : 'bottom left';
                const r = el.getBoundingClientRect();
                if (!r.height) return;
                const avail = r.bottom - TB_TOP_KEEP;      // 列可用的最大高度
                if (avail > 0 && r.height > avail) {
                    // v1.3.0：下限 0.55 → 0.30。横屏 + 用户把图标/间距调到最大时，
                    // 0.55 仍放不下，列顶被裁 → 表现为「右下角没有删除按钮」。
                    const s = Math.max(0.30, avail / r.height);
                    el.style.transform = 'scale(' + s.toFixed(3) + ')';
                }
            });
        });
    }

    /* v1.3.0：视口尺寸变化（旋转屏幕 / 键盘收起 / 系统栏变化）后重新适配一次。
       此前只在 apply() 与面板保存时调用，横竖屏切换后列不重新缩放，
       列顶可能被顶出屏幕，看起来就是「图标被吞了」。 */
    let _fitTimer = null;
    function scheduleFit() {
        clearTimeout(_fitTimer);
        _fitTimer = setTimeout(() => { try { fitToolbars(); } catch (e) { } }, 120);
    }
    window.addEventListener('resize', scheduleFit);
    window.addEventListener('orientationchange', scheduleFit);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit);

    /* ── 实时样式：按 @media 生成横竖屏两套，仅包含显式改过的字段 ── */
    const SEL = {
        top: '#topLeftGroup, #topRightGroup, #feedModeBar',
        list: '#gridHeaderNav',
        bottom: '.bottom-nav',
        left: '.left-toolbar',
        right: '.right-toolbar'
    };
    function svgSel(sel) {
        return sel.split(',').map(x => `${x.trim()} svg, ${x.trim()} i`).join(', ');
    }
    function descSel(sel, suffix) {
        return sel.split(',').map(x => `${x.trim()} ${suffix}`).join(', ');
    }
    /** v1.2.4：圆形底板跟随图标尺寸一起缩放。默认 v=24 → 48px(w-12)、v=22 → 44px(w-11) */
    function bubbleCss(v) {
        const c = Math.max(0, Math.round(v * 2));
        return `width:${c}px !important; height:${c}px !important; min-width:${c}px !important; min-height:${c}px !important;`;
    }
    const BUBBLE = '[data-ep-icon] > div[class*="rounded-full"]';
    function cssForZone(o, z, s) {
        const sel = SEL[z];
        let css = '';
        const add = (selector, body) => { css += `  ${selector} { ${body} }\n`; };

        if ('opacity' in s) add(sel, `opacity:${((100 - s.opacity) / 100).toFixed(3)} !important;`);
        if ('sizePx' in s) {
            const v = s.sizePx;
            add(svgSel(sel), `width:${v}px !important; height:${v}px !important;`);
            // v1.2.4：圆圈（圆形底板）与里面的图标一起变大变小，不再只有 svg 缩放
            add(descSel(sel, BUBBLE), bubbleCss(v));
            if (z === 'top' || z === 'list') add('#feedModeBar .feed-mode-pill, #gridLibName', `font-size:${Math.max(9, Math.round(v * 0.55))}px !important;`);
        }
        if ('gapPx' in s) {
            if (z === 'left' || z === 'right') add(`${sel} > * + *`, `margin-top:${s.gapPx}px !important;`);
            else add(z === 'top' ? '#topLeftGroup, #topRightGroup, #feedModeBar' : sel, `gap:${s.gapPx}px !important;`);
        }
        if ('offsetPx' in s) {
            if (z === 'left') add(sel, `left:${s.offsetPx}px !important;`);
            else if (z === 'right') add(sel, `right:${s.offsetPx}px !important;`);
            // v1.2.14 第 2/9 项：图标行改绝对定位锚定在容器底边，bottom = 滑杆值直译
            // （0 = 圆圈底边真实贴屏幕物理底边，与「距顶部/距左侧/距右侧」标准统一）
            else if (z === 'bottom') add('#bottomNavInner', `position:absolute !important; left:0 !important; right:0 !important;` +
                `bottom:${('offsetPx' in s ? (Number(s.offsetPx) || 0) : 12)}px !important; top:auto !important;`);
        }
        if ('bottomPx' in s && (z === 'left' || z === 'right')) add(sel, `bottom:${s.bottomPx}px !important;`);
        if ('barHeightPx' in s) {
            // v1.2.14 第 2 项：底部「底色高度」= 色带真实高度（图标行绝对定位，不参与撑高）。
            // 0 = 色带完全消失（内边距/顶边框一并清零）；>0 = 精确到该 px。
            if (z === 'bottom') {
                const bh = Math.round(Number(s.barHeightPx) || 0);
                const off = ('offsetPx' in s ? (Number(s.offsetPx) || 0) : 12);
                add('#bottomNavInner', `position:absolute !important; left:0 !important; right:0 !important;` +
                    `bottom:${off}px !important; top:auto !important;`);
                if (bh <= 0) {
                    add(sel, 'height:0 !important; min-height:0 !important; padding:0 !important;' +
                        'border-top:none !important; overflow:visible !important;');
                } else {
                    add(sel, `height:${bh}px !important; min-height:0 !important; padding:0 !important;`);
                }
            }
            else if (z === 'list') add(sel, `height:${s.barHeightPx}px !important; min-height:${s.barHeightPx}px !important;`);
            else if (z === 'top') add('#feedModeBar', `height:${s.barHeightPx}px !important;`);
        }
        if (z === 'bottom' && ('barBlurPx' in s || 'barBlur' in s)) {
            // v1.2.14 第 3 项：底色模糊层开关 → 模糊度滑杆（px，0=不模糊）。
            // 兼容旧布尔字段：false=0，true/未设置=默认 12px
            const bp = ('barBlurPx' in s) ? Math.round(Number(s.barBlurPx) || 0) : (s.barBlur === false ? 0 : 12);
            const bl = bp > 0 ? `blur(${bp}px)` : 'none';
            add(sel, `backdrop-filter:${bl} !important; -webkit-backdrop-filter:${bl} !important;`);
        }
        if ('barOpacity' in s) {
            const a = (1 - s.barOpacity / 100).toFixed(3);
            const bg = `background-color:rgba(0,0,0,${a}) !important;`;
            if (z === 'bottom' || z === 'list') add(sel, bg);
            else if (z === 'top') add('#feedModeBar', `${bg} border-radius:9999px !important;`);
        }
        // 顶部 / 列表三块：左上角 / 中间文字 / 右上角
        if (s.blocks && (z === 'top' || z === 'list')) {
            ['left', 'center', 'right'].forEach(bk => {
                if (!s.blocks[bk]) return;
                const b = Object.assign({}, BD[o][bk], s.blocks[bk]);
                if (z === 'top') {
                    if (bk === 'left') {
                        add('#topLeftGroup', `top:${b.offsetPx}px !important; left:${b.edgePx}px !important;`);
                        add('#topLeftGroup svg', `width:${b.sizePx}px !important; height:${b.sizePx}px !important;`);
                        if ('sizePx' in s.blocks[bk]) add(`#topLeftGroup ${BUBBLE}`, bubbleCss(b.sizePx));
                    } else if (bk === 'right') {
                        add('#topRightGroup', `top:${b.offsetPx}px !important; right:${b.edgePx}px !important;`);
                        add('#topRightGroup svg', `width:${b.sizePx}px !important; height:${b.sizePx}px !important;`);
                        if ('sizePx' in s.blocks[bk]) add(`#topRightGroup ${BUBBLE}`, bubbleCss(b.sizePx));
                    } else {
                        add('#feedModeBar', `top:${b.offsetPx}px !important;`);
                        add('#feedModeBar .feed-mode-pill', `font-size:${b.sizePx}px !important;`);
                    }
                } else {
                    const pad = bk === 'center' ? 'padding-top' : (bk === 'left' ? 'padding-left' : 'padding-right');
                    const pv = bk === 'center' ? b.offsetPx : (b.edgePx || b.offsetPx);
                    add('#gridHeaderNav', `${pad}:${pv}px !important;`);
                    // v1.2.8：列表三块「各调各的」——大小不再共用同一组选择器
                    if (bk === 'center') add('#gridLibName', `font-size:${b.sizePx}px !important;`);
                    else if (bk === 'left') add('#gridFolderBackBtn svg, #gridFolderBackBtn i', `width:${b.sizePx}px !important; height:${b.sizePx}px !important;`);
                    else add('#gridSortBtn svg, #gridSortBtn i, #gridFolderSearchBtn svg, #gridFolderSearchBtn i', `width:${b.sizePx}px !important; height:${b.sizePx}px !important;`);
                }
            });
        }
        // v1.2.6 第 2 项：底部「视频名称大小 / 距底部高度」（只控视频名称，不再绑定进度时间位置）
        // v1.2.7 第 2 项：距底高度只移动视频名称自身（#metaInfoContainer 外边距），进度条保持原位。
        //   80 为原默认值（旧版 .bottom-info bottom），12 为容器默认 mb-3，保证滑到 80 时外观与旧版一致。
        if (s.title && z === 'bottom') {
            const t = s.title;
            if ('titleSizePx' in t) add('#videoTitle', `font-size:${t.titleSizePx}px !important;`);
            if ('titleBottomPx' in t) {
                // v1.2.12 第 1 项：滑块数值 = 标题文字底边到屏幕底边的真实 px。
                // 原做法改 #metaInfoContainer 的 margin-bottom，但负外边距只能吃到 .bottom-info 的
                // padding-bottom(40px)，再往下就被父盒底边卡住（地板 ~92px），所以数值偏大且不线性。
                // 现直接移动 .bottom-info 的 bottom：63 = 实测常量（标题距底 143 - 容器 bottom 80）
                add('.bottom-info', `bottom:${Math.round(t.titleBottomPx) - 63}px !important;`);
            }
        }
        // 底部进度条
        if (s.progress && z === 'bottom') {
            const pr = s.progress;
            // v1.2.8 第 4 项：进度条组（#progressDock）独立于 .bottom-info，
            // bottom 直接以手机屏幕底边为基准，与距顶部 / 距左侧 / 距右侧标准统一。
            if (pr.enabled === false) add('#progressDock', 'display:none !important;');
            if ('heightPx' in pr) add('#progressBarContainer > div', `height:${pr.heightPx}px !important;`);
            if ('offsetPx' in pr) {
                // v1.2.10 复核修正：距底部以进度条线体自身为基准（时间行改为绝对定位挂靠，
                // 不再占据 Dock 流内高度）——0 = 进度条贴屏幕底边（配合原生 edge-to-edge）。
                // v1.2.14 复核：#progressBarContainer 自带 py-2 底部内边距会把线体垫高 8px，
                // 注入距底值时一并清零，保证「滑杆值 = 线体底边到屏幕底边的真实 px」。
                add('#progressDock', `bottom:${pr.offsetPx}px !important;`);
                add('#progressBarContainer', 'padding-bottom:0 !important; margin-bottom:0 !important;');
                if ('timeOffsetPx' in pr) {
                    // v1.2.14 第 5 项：时长行与进度条彻底解耦 —— 时长行 bottom 相对 Dock 底边换算：
                    // 时长行底边距屏幕底 = offsetPx + rel = timeOffsetPx，与进度条互不影响、允许重叠。
                    const rel = Math.round(pr.timeOffsetPx) - Math.round(pr.offsetPx);
                    add('#progressTimeRow', 'position:absolute !important; left:0 !important; right:0 !important;' +
                        `top:auto !important; bottom:${rel}px !important; margin:0 !important;`);
                } else if (pr.offsetPx < 30) {
                    // 兼容旧行为：未设独立时长滑杆时，距底 < 30px 时间行自动翻到上方
                    add('#progressTimeRow', 'position:absolute !important; left:0 !important; right:0 !important;' +
                        'top:auto !important; bottom:100% !important; margin:0 0 3px 0 !important;');
                } else {
                    add('#progressTimeRow', 'position:absolute !important; left:0 !important; right:0 !important;' +
                        'top:100% !important; bottom:auto !important; margin:3px 0 0 0 !important;');
                }
            }
            // 进度条时间行的字号（即时间高度），与进度条控制条一起调节。
            // v1.2.8：补 line-height（text-xs 固定 1rem 会压制视觉变化），行高随字号走。
            if ('timeSizePx' in pr) add('#progressTimeRow', `font-size:${pr.timeSizePx}px !important; line-height:${Math.round(pr.timeSizePx * 1.3)}px !important; gap:${Math.max(2, Math.round(pr.timeSizePx * 0.18))}px !important;`);
        }
        return css;
    }
    function cssForColors(map) {
        let vars = '', rules = '';
        // v1.2.6 第 7 项：图标设置里加颜色时，圆圈内线条（svg stroke）一并加粗。
        // 画质/随机/倍速等左下角图标会被 paintIcon() 重绘，CSS 实时生效可覆盖 lucide 默认 stroke-width。
        const BOLD = '2.75';
        Object.keys(map).forEach(k => {
            const c = map[k] || {};
            const safe = k.replace(/[^a-zA-Z0-9_-]/g, '');
            if (c.offColor) {
                vars += `--epc-${safe}-off:${c.offColor};`;
                // v1.2.7：关闭色同时作用于纯文字图标（顶部分类页签等无 svg 的元素）
                rules += `[data-ep-icon="${safe}"] svg,[data-ep-icon="${safe}"] i{stroke:${c.offColor} !important;color:${c.offColor} !important;stroke-width:${BOLD} !important;}` +
                         `[data-ep-icon="${safe}"].feed-mode-pill{color:${c.offColor} !important;}`;
            }
            if (c.activeColor) {
                vars += `--epc-${safe}-on:${c.activeColor};`;
                const fill = c.activeMode === 'fill' ? `fill:${c.activeColor} !important;` : '';
                // v1.2.7：开启色同时作用于元素本体（.active 页签 / .epp-active 状态图标）
                rules += `[data-ep-icon="${safe}"].active svg,[data-ep-icon="${safe}"].epp-active svg,[data-ep-icon="${safe}"][data-state="on"] svg` +
                         `{stroke:${c.activeColor} !important;color:${c.activeColor} !important;stroke-width:${BOLD} !important;${fill}}` +
                         `[data-ep-icon="${safe}"].active,[data-ep-icon="${safe}"].epp-active{color:${c.activeColor} !important;}`;
            }
        });
        return vars ? `:root{${vars}}\n${rules}\n` : '';
    }
    function cssForOrders(orders) {
        let css = '';
        ['left', 'right'].forEach(z => {
            const arr = orders[z];
            if (!Array.isArray(arr)) return;
            arr.forEach((k, i) => {
                const safe = String(k).replace(/[^a-zA-Z0-9_-]/g, '');
                css += `[data-ep-icon="${safe}"]{order:${i} !important;}`;
            });
        });
        return css ? css + '\n' : '';
    }
    function applyStyles() {
        const p = read();
        let css = '';
        ['portrait', 'landscape'].forEach(o => {
            let body = '';
            ['top', 'list', 'bottom', 'left', 'right'].forEach(z => {
                const st = (p.zones && p.zones[o] && p.zones[o][z]) || {};
                body += cssForZone(o, z, st);
            });
            if (body) css += `@media (orientation: ${o}) {\n${body}}\n`;
        });
        css += cssForColors(p.iconColors || {}) + cssForOrders(p.orders || {});
        let st = document.getElementById(ZSTYLE_ID);
        if (!st) {
            st = document.createElement('style');
            st.id = ZSTYLE_ID;
            document.head.appendChild(st);
        }
        st.textContent = css;
    }

    /* ── 基础样式 ── */
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = `
            .${HIDE} { display:none !important; }
            .${TEMP_HIDE} { opacity:0 !important; pointer-events:none !important; }
            #app.${PREVIEW}.interface-hidden .bottom-info:not(.show-progress),
            #app.${PREVIEW}.interface-hidden .bottom-nav,
            #app.${PREVIEW}.interface-hidden .left-toolbar,
            #app.${PREVIEW}.interface-hidden .right-toolbar,
            #app.${PREVIEW}.interface-hidden #topLeftGroup,
            #app.${PREVIEW}.interface-hidden #topRightGroup,
            #app.${PREVIEW}.interface-hidden #feedModeBar,
            body.pip-active #app.${PREVIEW} .bottom-nav,
            body.pip-active #app.${PREVIEW} .left-toolbar,
            body.pip-active #app.${PREVIEW} .right-toolbar {
                opacity:1 !important; pointer-events:auto !important; visibility:visible !important;
            }
            #${PANEL_ID} { font-family:inherit; }
            .epp-tabs { display:flex; gap:3px; overflow-x:auto; padding-bottom:3px; }
            .epp-tab { flex:1 0 auto; padding:4px 6px; border-radius:8px; font-size:10px; font-weight:800;
                color:rgba(255,255,255,.65); background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.10); }
            .epp-tab.active { color:#fff; background:rgba(82,181,75,.34); border-color:rgba(82,181,75,.80); }
            .epp-card { border-radius:10px; background:rgba(0,0,0,.32); border:1px solid rgba(255,255,255,.08); }
            .epp-sl { padding:4px 8px 2px; }
            /* v1.2.8：标签左对齐；v1.2.10：px 数值移入托杆行，−/+ 与托杆、px 整行居中，
               托杆缩短 1/3（flex:0 1 58%），不再贴浮窗边缘 */
            .epp-sl > div:first-child { display:flex; align-items:center; justify-content:space-between; gap:8px; }
            .epp-sl .lb { font-size:10px; color:rgba(255,255,255,.62); min-width:0; flex:1; }
            .epp-sl .vl { font-size:10px; color:#fff; font-variant-numeric:tabular-nums;
                min-width:38px; text-align:left; flex-shrink:0; }
            .epp-sl .rw { display:flex; align-items:center; justify-content:center; gap:7px; margin-top:2px; }
            .epp-sl .pm { width:20px; height:20px; flex-shrink:0; border-radius:6px; font-weight:900;
                color:#fff; background:rgba(255,255,255,.14); }
            .epp-sl input[type=range] { flex:0 1 58%; min-width:0; height:18px; accent-color:#52B54B; }
            /* v1.2.4：小窗内图标卡片改单列，横屏才恢复双列 */
            .epp-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
            .epp-ic { border-radius:10px; padding:5px 7px; background:rgba(0,0,0,.30);
                border:1px solid rgba(255,255,255,.08); }
            .epp-ic.off { opacity:.62; }
            .epp-ic .nm { flex:1; min-width:0; font-size:11px; color:rgba(255,255,255,.90); }
            .epp-ic.off .nm { color:rgba(255,255,255,.45); }
            .epp-ic .ico { width:14px; height:14px; color:#8dd18a; flex-shrink:0; }
            .epp-ic.off .ico { color:rgba(255,255,255,.35); }
            .epp-mode { flex-shrink:0; padding:2px 6px; border-radius:6px; font-size:9px; font-weight:800;
                color:#fff; background:rgba(255,255,255,.14); }
            .epp-mode.fill { background:#52B54B; }
            .epp-sw { width:32px; height:18px; border-radius:9999px; flex-shrink:0; position:relative;
                background:rgba(255,255,255,.18); }
            .epp-sw::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px;
                border-radius:50%; background:#fff; transition:transform .2s; }
            .epp-ic.on .epp-sw { background:#52B54B; }
            .epp-ic.on .epp-sw::after { transform:translateX(14px); }
            .epp-crow { display:flex; align-items:center; gap:6px; margin-top:4px; }
            .epp-dots { flex:1; min-width:0; display:grid; grid-template-columns:repeat(9,minmax(0,1fr)); gap:2px; }
            .epp-dot { width:100%; aspect-ratio:1/1; border-radius:50%; border:1px solid rgba(255,255,255,.35); }
            .epp-dot.cur { border-color:#fff; box-shadow:0 0 0 2px rgba(82,181,75,.85); }
            .epp-tag { width:26px; flex-shrink:0; text-align:right; font-size:9px; font-weight:800; }
            .epp-tag.on { color:#f87171; }
            .epp-tag.off { color:rgba(255,255,255,.42); }
            .epp-ord { display:flex; gap:3px; margin-top:5px; }
            .epp-ord button { flex:1; padding:3px 0; border-radius:6px; font-size:10px;
                color:rgba(255,255,255,.75); background:rgba(255,255,255,.08); }
            .epp-hint { font-size:9px; line-height:1.5; color:rgba(255,255,255,.42); }
            .epp-hint.epp-fold { display:none; }
            .epp-win { background:rgba(20,20,22,.82); }
            /* v1.2.5 第 1 项：居中布置；v1.2.6 第 3 项：左右再各缩窄 5mm、上下各缩窄 1cm
               → 左右各 1.5cm（共 3cm）、上下各 3cm（共 6cm）
               v1.2.7 第 9 项：横屏时上部留白增加 1cm（3→4cm）、下部增加 5mm（3→3.5cm）
               v1.2.9 第 3 项（更正版）：竖屏保持 3cm 不变；仅横屏左右各缩窄 1cm（共 3.5cm）；
               内容区左右各加 16px 空隙，防止滑杆贴边误触 */
            #${PANEL_ID} { align-items:center !important; justify-content:center !important; padding:0 !important; }
            #${PANEL_ID} .epp-win {
                width:calc(100% - 3cm) !important; max-width:none !important;
                height:calc(100% - 6cm) !important; max-height:none !important;
            }
            #${PANEL_ID} .epp-body { padding-left:16px !important; padding-right:16px !important; }
            @media (orientation: landscape) {
                #${PANEL_ID} .epp-grid { grid-template-columns:repeat(3,minmax(0,1fr)) !important; }
                /* v1.2.8：横屏居中，上下各 1.5cm；v1.2.9：左右各缩窄 1cm（共 3.5cm）；
                   v1.2.10：横屏宽度再变窄 1/5（×0.8）并保持居中 */
                #${PANEL_ID} { align-items:center !important; justify-content:center !important; padding:0 !important; }
                #${PANEL_ID} .epp-win {
                    width:calc((100% - 3.5cm) * 0.8) !important;
                    height:calc(100% - 3cm) !important;
                }
            }
        `;
        document.head.appendChild(st);
    }

    /* ── 面板片段 ── */
    function sliderHtml(field, label, value, unit, min, max, scope) {
        return `<div class="epp-sl" data-sl="${esc(field)}">
            <div><span class="lb">${esc(label)}</span></div>
            <div class="rw">
                <button class="pm" data-step="-1" data-field="${esc(field)}" data-scope="${esc(scope)}">−</button>
                <input type="range" min="${min}" max="${max}" step="1" value="${value}"
                       data-field="${esc(field)}" data-scope="${esc(scope)}" data-unit="${esc(unit)}">
                <button class="pm" data-step="1" data-field="${esc(field)}" data-scope="${esc(scope)}">+</button>
                <span class="vl" data-vl>${value}${unit}</span>
            </div>
        </div>`;
    }
    function swatchHtml(key, which, c, cur) {
        return `<button class="epp-dot ${c === cur ? 'cur' : ''}" style="background:${c}"
            data-color="${esc(key)}" data-which="${which}" data-c="${c}" title="${c}"></button>`;
    }
    function iconCardHtml(it, p, zid) {
        const [key, label, domId, ico, swZone, swKey] = it;
        const checked = p[swZone][swKey] !== false;
        const c = p.iconColors[key] || { activeMode: 'stroke' };
        const onC = c.activeColor || DEFAULT_ON;
        const offC = c.offColor || DEFAULT_OFF;
        const orderBtns = (zid === 'left' || zid === 'right')
            ? `<div class="epp-ord">
                 <button data-order="${esc(key)}" data-zone="${zid}" data-dir="-1" title="上移">↑ 上移</button>
                 <button data-order="${esc(key)}" data-zone="${zid}" data-dir="1" title="下移">↓ 下移</button>
               </div>` : '';
        return `<div class="epp-ic ${checked ? 'on' : 'off'}" data-icon="${esc(key)}">
            <div style="display:flex;align-items:center;gap:6px;">
                <button data-toggle="${esc(key)}" data-swzone="${swZone}" data-swkey="${swKey}"
                        style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;text-align:left;">
                    <i data-lucide="${ico}" class="ico"></i><span class="nm">${esc(label)}</span>
                </button>
                <button class="epp-mode ${c.activeMode === 'fill' ? 'fill' : ''}"
                        data-mode="${esc(key)}">${c.activeMode === 'fill' ? '填充' : '线条'}</button>
                <button data-toggle="${esc(key)}" data-swzone="${swZone}" data-swkey="${swKey}" class="epp-sw"></button>
            </div>
            ${checked ? `<div class="epp-crow"><div class="epp-dots">${COLORS.map(x => swatchHtml(key, 'activeColor', x, onC)).join('')}</div><span class="epp-tag on">开启</span></div>` : ''}
            <div class="epp-crow"><div class="epp-dots">${COLORS.map(x => swatchHtml(key, 'offColor', x, offC)).join('')}</div><span class="epp-tag off">关闭</span></div>
            ${orderBtns}
        </div>`;
    }
    function zoneSlidersHtml() {
        const z = zoneTab;
        const v = zoneVal(orient, z);
        const L = LIMITS;
        let out = '';
        out += sliderHtml('opacity', '图标透明度', v.opacity, '%', ...L.opacity, 'zone');
        if (z !== 'top' && z !== 'list') out += sliderHtml('sizePx', '图标大小', v.sizePx, 'px', ...L.sizePx, 'zone');
        if (z !== 'bottom') out += sliderHtml('gapPx', '图标间距', v.gapPx, 'px', ...L.gapPx, 'zone');
        if (z === 'bottom') out += sliderHtml('offsetPx', '图标距底部距离', v.offsetPx, 'px', ...L.offsetPx, 'zone');
        if (z === 'left') out += sliderHtml('offsetPx', '图标距左侧距离', v.offsetPx, 'px', ...L.offsetPx, 'zone');
        if (z === 'right') out += sliderHtml('offsetPx', '图标距右侧距离', v.offsetPx, 'px', ...L.offsetPx, 'zone');
        if (z === 'left' || z === 'right') out += sliderHtml('bottomPx', '末图标距底部距离', v.bottomPx, 'px', ...L.bottomPx, 'zone');
        if (z === 'top' || z === 'list' || z === 'bottom') {
            out += sliderHtml('barHeightPx', '底色高度', v.barHeightPx, 'px', ...L.barHeightPx, 'zone');
            out += sliderHtml('barOpacity', '底色透明度', v.barOpacity, '%', ...L.barOpacity, 'zone');
        }
        if (z === 'bottom') {
            // v1.2.14 第 3 项：底色模糊层开关 → 模糊度滑杆（px，0=不模糊；兼容旧布尔字段）
            const zsb = storedZone(orient, 'bottom');
            const bz = Object.assign({ barBlurPx: 12 }, zsb);
            if (!('barBlurPx' in zsb) && zsb.barBlur === false) bz.barBlurPx = 0;
            out += sliderHtml('barBlurPx', '底色模糊度', bz.barBlurPx, 'px', ...L.barBlurPx, 'zone');
            // v1.2.6 第 2 项：底部「视频名称」单独控制（大小 / 距底高度），不再绑定进度时间位置
            const tv = Object.assign({ titleSizePx: 18, titleBottomPx: 143 },
                                     storedZone(orient, 'bottom').title || {});
            out += `<div class="epp-hint" style="padding:6px 10px 0;font-weight:800;color:#8dd18a;">视频名称</div>`;
            out += sliderHtml('titleSizePx', '视频名称大小', tv.titleSizePx, 'px', ...L.titleSizePx, 'title');
            out += sliderHtml('titleBottomPx', '距底部高度', tv.titleBottomPx, 'px', ...L.titleBottomPx, 'title');
            // v1.2.13 第 7 项：进度条距底部与时长距底部各自独立滑杆（互不关联）
            const pr = Object.assign({ enabled: true, heightPx: 3, offsetPx: 80, timeOffsetPx: 80, timeSizePx: 12 },
                                     storedZone(orient, 'bottom').progress || {});
            out += `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;">
                        <span class="lb" style="flex:1;font-size:10px;color:rgba(255,255,255,.62);">播放进度条</span>
                        <button class="epp-mode ${pr.enabled ? 'fill' : ''}" data-progress="enabled">${pr.enabled ? '开启' : '关闭'}</button>
                    </div>`;
            if (pr.enabled) {
                out += sliderHtml('heightPx', '进度条高度', pr.heightPx, 'px', ...L.progressHeightPx, 'progress');
                out += sliderHtml('offsetPx', '进度条距底部', pr.offsetPx, 'px', ...L.offsetPx, 'progress');
                // v1.2.6 第 2 项：进度时间高度与进度条一起，置于其下的控制条中
                out += `<div class="epp-hint" style="padding:2px 10px 0;font-size:9px;color:rgba(255,255,255,.42);">进度时间</div>`;
                out += sliderHtml('timeOffsetPx', '时长距底部', pr.timeOffsetPx, 'px', ...L.timeOffsetPx, 'progress');
                out += sliderHtml('timeSizePx', '时间字号', pr.timeSizePx, 'px', ...L.timeSizePx, 'progress');
            }
        }
        return out;
    }
    function blockSlidersHtml() {
        const b = blockVal(orient, zoneTab, topBlock);
        const L = LIMITS;
        let out = sliderHtml('sizePx', '大小', b.sizePx, 'px', ...L.sizePx, 'block');
        out += sliderHtml('offsetPx', '距顶部', b.offsetPx, 'px', ...L.offsetPx, 'block');
        if (topBlock !== 'center') {
            out += sliderHtml('edgePx', topBlock === 'left' ? '距左边缘' : '距右边缘',
                              b.edgePx, 'px', ...L.edgePx, 'block');
        }
        return out;
    }

    function renderPanel() {
        if (!panelEl) return;
        const p = read();
        const z = zoneById(zoneTab);
        const scroll = panelEl.querySelector('.epp-body');
        const keepTop = scroll ? scroll.scrollTop : 0;

        const zoneTabs = ZONES.map(x =>
            `<button class="epp-tab ${x.id === zoneTab ? 'active' : ''}" data-zone-tab="${x.id}">${x.label}</button>`).join('');
        const orientTabs = [['portrait', '竖屏'], ['landscape', '横屏']].map(([k, t]) =>
            `<button class="epp-tab ${k === orient ? 'active' : ''}" data-orient="${k}">${t}</button>`).join('');
        const blockTabs = [['left', '左上角'], ['center', '中间文字'], ['right', '右上角']].map(([k, t]) =>
            `<button class="epp-tab ${k === topBlock ? 'active' : ''}" data-block="${k}">${t}</button>`).join('');

        const groups = z.groups.map(g =>
            `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);">
                <div style="font-size:11px;font-weight:800;color:rgba(255,255,255,.55);padding:0 2px 6px;">${esc(g.title)}</div>
                <div class="epp-grid">${g.items.map(it => iconCardHtml(it, p, z.id)).join('')}</div>
             </div>`).join('');

        panelEl.innerHTML = `
            <div class="absolute inset-0" data-close="1"></div>
            <div class="epp-win relative z-10 flex flex-col rounded-xl
                        border border-white/20 shadow-2xl backdrop-blur-md overflow-hidden">
                <div class="flex items-center gap-2 px-2 py-1.5 border-b border-white/10 shrink-0 bg-white/5">
                    <i data-lucide="sliders-horizontal" class="w-3.5 h-3.5 text-[#8dd18a]"></i>
                    <h3 class="text-white text-[11px] font-bold flex-1">图标区域</h3>
                    <button class="px-2.5 py-1 rounded-full bg-[#52B54B] text-white text-[10px] font-black" data-close="1">完成</button>
                </div>
                <div class="epp-hint px-2 pt-1.5 shrink-0">四周图标可见 · 拖动即时生效</div>
                <div class="epp-body flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1.5">
                    <div class="epp-tabs">${zoneTabs}</div>
                    <div class="epp-tabs" style="margin-top:5px;">${orientTabs}</div>
                    <div class="epp-card" style="margin-top:6px;padding:4px 0;">${zoneSlidersHtml()}</div>
                    <div class="epp-hint epp-fold" style="padding:6px 2px 0;">透明度：0=不透明，100=全透明；间距/大小/高度为具体 px；竖屏与横屏分开设置</div>
                    ${(zoneTab === 'top' || zoneTab === 'list') ? `
                    <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);">
                        <div class="epp-tabs">${blockTabs}</div>
                        <div class="epp-card" style="margin-top:8px;padding:4px 0;">${blockSlidersHtml()}</div>
                    </div>` : ''}
                    ${groups}
</div>
                </div>
            </div>`;

        panelEl.querySelectorAll('[data-zone-tab]').forEach(el => {
            el.onclick = e => { e.stopPropagation(); zoneTab = el.dataset.zoneTab; topBlock = 'left'; renderPanel(); };
        });
        panelEl.querySelectorAll('[data-orient]').forEach(el => {
            el.onclick = e => { e.stopPropagation(); orient = el.dataset.orient; renderPanel(); };
        });
        panelEl.querySelectorAll('[data-block]').forEach(el => {
            el.onclick = e => { e.stopPropagation(); topBlock = el.dataset.block; renderPanel(); };
        });

        // 滑块：拖动时不重绘面板，只更新数值并实时套用 CSS
        const change = (field, scope, value) => {
            const v = clamp(value, field);
            patchStored(p => {
                if (!p.zones[orient]) p.zones[orient] = {};
                if (!p.zones[orient][zoneTab]) p.zones[orient][zoneTab] = {};
                const zs = p.zones[orient][zoneTab];
                if (scope === 'zone') zs[field] = v;
                else if (scope === 'block') {
                    if (!zs.blocks) zs.blocks = {};
                    if (!zs.blocks[topBlock]) zs.blocks[topBlock] = {};
                    zs.blocks[topBlock][field] = v;
                } else if (scope === 'progress') {
                    if (!zs.progress) zs.progress = {};
                    zs.progress[field] = v;
                } else if (scope === 'title') {
                    if (!zs.title) zs.title = {};
                    zs.title[field] = v;
                }
            });
            return v;
        };
        panelEl.querySelectorAll('input[type=range]').forEach(inp => {
            inp.oninput = () => {
                const v = change(inp.dataset.field, inp.dataset.scope, inp.value);
                const row = inp.closest('.epp-sl');
                const vl = row && row.querySelector('[data-vl]');
                if (vl) vl.textContent = v + (inp.dataset.unit || '');
            };
        });
        panelEl.querySelectorAll('[data-step]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const row = btn.closest('.epp-sl');
                const inp = row && row.querySelector('input[type=range]');
                if (!inp) return;
                const next = clamp(Number(inp.value) + Number(btn.dataset.step), inp.dataset.field);
                inp.value = next;
                inp.oninput();
            };
        });

        panelEl.querySelectorAll('[data-progress]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                patchStored(p => {
                    if (!p.zones[orient]) p.zones[orient] = {};
                    if (!p.zones[orient][zoneTab]) p.zones[orient][zoneTab] = {};
                    const zs = p.zones[orient][zoneTab];
                    // 必须按「含默认值的显示状态」取反：直接 !undefined 会得到 true，关不掉
                    const pr = Object.assign({ enabled: true, heightPx: 3, offsetPx: 80, timeOffsetPx: 80 }, zs.progress || {});
                    zs.progress = Object.assign({}, pr, { enabled: !pr.enabled });
                });
                renderPanel();
            };
        });
        panelEl.querySelectorAll('[data-toggle]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const swZone = btn.dataset.swzone, swKey = btn.dataset.swkey;
                const next = read()[swZone][swKey] === false;
                patchStored(p => { p[swZone][swKey] = next; });
                apply();
                renderPanel();
            };
        });
        panelEl.querySelectorAll('[data-mode]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const k = btn.dataset.mode;
                patchStored(p => {
                    const c = p.iconColors[k] || {};
                    c.activeMode = c.activeMode === 'fill' ? 'stroke' : 'fill';
                    p.iconColors[k] = c;
                });
                renderPanel();
            };
        });
        panelEl.querySelectorAll('[data-color]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const k = btn.dataset.color, which = btn.dataset.which, c = btn.dataset.c;
                patchStored(p => {
                    const o = p.iconColors[k] || { activeMode: 'stroke' };
                    o[which] = c;
                    p.iconColors[k] = o;
                });
                renderPanel();
            };
        });
        panelEl.querySelectorAll('[data-order]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const zid = btn.dataset.zone, key = btn.dataset.order, dir = Number(btn.dataset.dir);
                patchStored(p => {
                    const base = zoneById(zid).groups[0].items.map(x => x[0]);
                    const arr = Array.isArray(p.orders[zid]) && p.orders[zid].length
                        ? p.orders[zid].slice() : base;
                    const i = arr.indexOf(key);
                    if (i < 0) return;
                    const j = i + dir;
                    if (j < 0 || j >= arr.length) return;
                    arr[i] = arr[j]; arr[j] = key;
                    p.orders[zid] = arr;
                });
                renderPanel();
            };
        });
        panelEl.querySelectorAll('[data-close]').forEach(el => {
            el.onclick = e => { e.stopPropagation(); closePanel(); };
        });
        const body = panelEl.querySelector('.epp-body');
        if (body) body.scrollTop = keepTop;
        if (window.lucide) window.lucide.createIcons({ root: panelEl });
    }

    /** 恢复「预览态」：设置页重新可见、播放页恢复正常自动清屏 */
    function restorePreview() {
        if (ppHidden) {
            const pp = document.getElementById('profilePage');
            if (pp) pp.classList.remove(TEMP_HIDE);
            ppHidden = false;
        }
        const appEl = document.getElementById('app');
        if (appEl) appEl.classList.remove(PREVIEW);
    }

    function ensurePanel() {
        ensureStyle();
        if (panelEl) return panelEl;
        panelEl = document.createElement('div');
        panelEl.id = PANEL_ID;
        // v1.2.4：靠上居中的小窗（具体尺寸见 ensureStyle 的 #buttonPrefsModal 规则）
        // v1.2.5：居中布置（具体留白见 ensureStyle 的 1cm / 2cm 规则）
        panelEl.className = 'fixed inset-0 z-[90] hidden flex items-center justify-center';
        document.body.appendChild(panelEl);
        // 返回键 / closeAllModals 也会给面板加 hidden，用观察者兜底清理预览态，
        // 否则全屏设置页会一直透明、自动清屏也会失效。
        if (window.MutationObserver) {
            new MutationObserver(() => {
                if (panelEl && panelEl.classList.contains('hidden')) restorePreview();
            }).observe(panelEl, { attributes: true, attributeFilter: ['class'] });
        }
        return panelEl;
    }

    function openPanel() {
        ensurePanel();
        // 参考版在播放页上浮出半透明控制窗，四周真实图标可见；
        // 这里临时把全屏设置页透明化，并强制显示播放页 UI（暂停自动清屏）。
        restorePreview();
        const pp = document.getElementById('profilePage');
        if (pp && pp.classList.contains('active')) {
            pp.classList.add(TEMP_HIDE);
            ppHidden = true;
        }
        const appEl = document.getElementById('app');
        if (appEl) appEl.classList.add(PREVIEW);
        if (app && typeof app.showInterfaceTemp === 'function') app.showInterfaceTemp();
        // v1.2.15 第 10 项：横屏播放时打开图标区域 → 自动落到横屏页签。
        // matchMedia 为主，innerWidth/innerHeight 兜底（部分 WebView 视频全屏时媒体查询慢半拍）
        orient = ((window.matchMedia && window.matchMedia('(orientation: landscape)').matches)
            || window.innerWidth > window.innerHeight) ? 'landscape' : 'portrait';
        renderPanel();
        panelEl.classList.remove('hidden');
    }
    function closePanel() {
        if (panelEl) panelEl.classList.add('hidden');
        restorePreview();
    }
    function reset() {
        // v1.2.13 第 8 项：若用户用「设为默认」存过快照，恢复默认 = 回到该快照；
        // 没有快照时保持出厂默认（仅显隐开关，不注入任何样式）。
        try {
            const raw = localStorage.getItem(DEF_KEY);
            if (raw) {
                const snap = JSON.parse(raw);
                if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
                    write(snap);
                    apply();
                    applyStyles();
                    renderPanel();
                    toast('已恢复默认状态（自设默认）');
                    return;
                }
            }
        } catch (e) { }
        write(clone(BUILTIN_DEFAULTS));
        apply();
        applyStyles();
        renderPanel();
        toast('已恢复出厂默认设置');
    }

    function init(appInstance) {
        app = appInstance || null;
        // v1.3.2：覆盖安装后首次启动，把出厂默认（用户备份快照）落到本机；
        // 用户若用「设为默认」存过快照则保持现状，不擅自改动。
        try {
            if (localStorage.getItem('embyUiPrefs_builtin_ver') !== 'v1.3.2') {
                if (!localStorage.getItem(DEF_KEY)) write(clone(BUILTIN_DEFAULTS));
                localStorage.setItem('embyUiPrefs_builtin_ver', 'v1.3.2');
            }
        } catch (e) { }
        ensureStyle();
        ensurePanel();
        apply();
        applyStyles();
        // 宫格 / 文件夹顶栏由 grid.js 动态重建，渲染后必须重新打标并套用
        if (app && typeof app.renderGridView === 'function') {
            const orig = app.renderGridView.bind(app);
            app.renderGridView = function () {
                const r = orig.apply(this, arguments);
                try { apply(); applyStyles(); } catch (e) { }
                return r;
            };
        }
        const entry = document.getElementById('rowButtonPrefs');
        if (entry) entry.onclick = e => { e.stopPropagation(); openPanel(); };
        // 旋转 / 分屏尺寸变化后重新做左右列适配（图标显隐等布局稳定后再量一次）
        const refit = () => {
            try { fitToolbars(); } catch (e) { }
            // v1.2.15 第 10 项：面板打开时旋转手机 → 横竖屏页签自动跟随
            if (panelEl && !panelEl.classList.contains('hidden')) {
                const o = ((window.matchMedia && window.matchMedia('(orientation: landscape)').matches)
                    || window.innerWidth > window.innerHeight) ? 'landscape' : 'portrait';
                if (o !== orient) { orient = o; renderPanel(); }
            }
        };
        window.addEventListener('resize', refit);
        window.addEventListener('orientationchange', () => setTimeout(refit, 350));
        setTimeout(refit, 600);
    }

    window.EmbyProUIPrefs = {
        init, get: read, set: write, apply, applyStyles,
        openPanel, closePanel, reset,
        getBuiltinDefaults: () => clone(BUILTIN_DEFAULTS)
    };
})();
