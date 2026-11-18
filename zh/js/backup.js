/*
 * backup.js —— EmbyPro v1.3.2「全量设置备份 / 恢复 / 默认值」（自包含模块）
 *
 * v1.3.2 变更：
 *   · 从「图标区域」面板移出，按钮改挂到「设置」页最底部；
 *   · 备份范围由「仅 embyUiPrefs」扩展为全部设置：服务器列表与登录态、字体大小、
 *     主题 / 网络 / 方向、缓存参数、播放质量 / 短剧 / 删除开关、媒体库可见性、
 *     搜索记录、图标区域（含自设默认快照）等所有 localStorage 设置项；
 *   · 恢复后自动重载页面，让各模块按新值重新初始化；
 *   · 兼容 v1.2.x 的旧备份文件（纯 embyUiPrefs JSON 对象）；
 *   · 备份下面的 v1.2.13 注释小字已删除。
 *
 * 只读 window.app / DOM / localStorage / EmbyXNativeFile，不改动其它模块。
 */
(function () {
    'use strict';

    const DEF_KEY = 'embypro_settings_default';   // v1.3.2：全量「自设默认」快照
    const BK_KEY = 'embyUiPrefs_backup';          // 兼容旧版内部副本（仍写一份）
    const UI_DEF_KEY = 'embyUiPrefs_default';     // 兼容 ui-prefs 的图标区域默认快照

    // 大块业务缓存 / 临时时间戳不进备份（不是设置，且可能几 MB）
    const SKIP = [
        'embyproCacheIndex', 'emby_views_cache', 'emby_persons_cache',
        'emby_favorites', 'embyx_last_update_check', BK_KEY
    ];
    // 出厂重置时保留服务器与登录态，避免「恢复默认」把账号清掉
    const KEEP_ON_RESET = [
        'embyx_saved_servers', 'embyx_current_server_id',
        'emby_server', 'emby_server_id', 'emby_user', 'emby_token', 'emby_uid',
        'emby_pwd_len', 'emby_fnOS', 'embyx_server_type',
        'openlist_origin', 'openlist_token', 'openlist_base_path',
        'openlist_dir_pwd', 'openlist_can_remove'
    ];

    let app = null;
    const $ = id => document.getElementById(id);
    const toast = msg => {
        if (app && typeof app.showToast === 'function') app.showToast(msg);
        else if (window.EmbyXCommon && typeof window.EmbyXCommon.toast === 'function') window.EmbyXCommon.toast(msg);
    };

    function isSkipped(k) { return SKIP.indexOf(k) !== -1; }

    /** 采集全部设置项：键 → 字符串值 */
    function collect() {
        const out = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || isSkipped(k)) continue;
                out[k] = localStorage.getItem(k);
            }
        } catch (e) { }
        return out;
    }

    /** 写回全部设置项（先清掉旧设置键，再逐条写入） */
    function applyAll(map, keepAuth) {
        const keep = {};
        KEEP_ON_RESET.forEach(k => { if (isSkipped(k)) return; keep[k] = true; });
        try {
            const doomed = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || isSkipped(k)) continue;
                if (keepAuth && keep[k]) continue;
                doomed.push(k);
            }
            doomed.forEach(k => localStorage.removeItem(k));
            Object.keys(map || {}).forEach(k => {
                if (isSkipped(k)) return;
                try { localStorage.setItem(k, map[k] == null ? '' : String(map[k])); } catch (e) { }
            });
        } catch (e) { }
    }

    function bkName() {
        const d = new Date(), p2 = n => String(n).padStart(2, '0');
        return 'embypro-settings-backup-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate())
            + '-' + p2(d.getHours()) + p2(d.getMinutes()) + '.json';
    }

    function saveFile(name, json) {
        const nf = window.EmbyXNativeFile;
        if (nf && typeof nf.saveToDownloads === 'function') {
            try {
                const loc = nf.saveToDownloads(name, json);
                toast(loc ? '已备份到 ' + loc : '备份失败：文件写入被拒绝');
                return;
            } catch (err) { toast('备份失败：' + err.message); return; }
        }
        try {
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            toast('已导出备份文件（含服务器与全部设置）');
        } catch (err) { toast('已备份（应用内部存储）'); }
    }

    function doBackup() {
        const settings = collect();
        const payload = {
            app: 'EmbyPro',
            format: 2,
            createdAt: new Date().toISOString(),
            note: '含服务器地址与登录凭证，请勿外传',
            settings: settings
        };
        const json = JSON.stringify(payload, null, 2);
        try {
            // 兼容旧逻辑：写一份纯 embyUiPrefs 内部副本
            const ui = settings['embyUiPrefs'];
            if (ui) localStorage.setItem(BK_KEY, ui);
        } catch (e) { }
        saveFile(bkName(), json);
    }

    function doRestore() {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            const r = new FileReader();
            r.onload = () => {
                let raw = null;
                try { raw = JSON.parse(String(r.result)); } catch (err) { }
                if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                    toast('备份文件无效'); return;
                }
                let map;
                if (raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)) {
                    map = raw.settings;                       // v1.3.2 全量格式
                } else if (raw.top || raw.bottom || raw.zones) {
                    map = { embyUiPrefs: JSON.stringify(raw) }; // v1.2.x 旧格式
                } else {
                    toast('备份文件无效'); return;
                }
                try {
                    const ui = map['embyUiPrefs'];
                    if (ui) localStorage.setItem(BK_KEY, ui);
                } catch (e) { }
                applyAll(map, false);
                toast('已恢复全部设置，正在重新加载…');
                setTimeout(() => { try { location.reload(); } catch (e) { } }, 700);
            };
            r.onerror = () => toast('读取文件失败');
            r.readAsText(f);
        };
        inp.click();
    }

    function doSetDefault() {
        try {
            const snap = collect();
            localStorage.setItem(DEF_KEY, JSON.stringify(snap));
            // 兼容 ui-prefs 的「恢复默认」：图标区域部分同步一份
            if (snap['embyUiPrefs']) localStorage.setItem(UI_DEF_KEY, snap['embyUiPrefs']);
            toast('已将当前全部设置设为默认');
        } catch (err) { toast('设为默认失败：' + (err && err.message)); }
    }

    function doResetDefault() {
        try {
            const raw = localStorage.getItem(DEF_KEY);
            if (raw) {
                const snap = JSON.parse(raw);
                if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
                    applyAll(snap, false);
                    toast('已恢复自设默认，正在重新加载…');
                    setTimeout(() => { try { location.reload(); } catch (e) { } }, 700);
                    return;
                }
            }
        } catch (e) { }
        // 无自设默认 → 回出厂默认：保留服务器/登录态，其余设置清空，
        // 图标区域由 ui-prefs 写回内置出厂默认（用户备份文件），字体默认 17px。
        applyAll({}, true);
        try { localStorage.removeItem(DEF_KEY); localStorage.removeItem(UI_DEF_KEY); } catch (e) { }
        try {
            const ui = window.EmbyProUIPrefs;
            if (ui && typeof ui.reset === 'function') ui.reset();
        } catch (e) { }
        toast('已恢复出厂默认，正在重新加载…');
        setTimeout(() => { try { location.reload(); } catch (e) { } }, 700);
    }

    function init(appInstance) {
        app = appInstance || null;
        const bind = (id, fn) => {
            const el = $(id);
            if (el) el.onclick = e => { e.stopPropagation(); fn(); };
        };
        bind('epBackupBtn', doBackup);
        bind('epRestoreBtn', doRestore);
        bind('epSetDefaultBtn', doSetDefault);
        bind('epResetDefaultBtn', doResetDefault);
    }

    window.EmbyProBackup = { init, collect, applyAll, doBackup, doRestore, doSetDefault, doResetDefault };
})();
