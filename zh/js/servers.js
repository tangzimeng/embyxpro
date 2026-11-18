/**
 * EmbyPro 1.2 — 多服务器与账号管理（数据层）
 * 移植自 EmbyTok 1.5.5「账号与服务器」方案（参考 1.5.15 源码与 EmbyX+ 2.2.5 落地实现）
 *
 * 1. ServerStore：多台服务器的地址簿 / 账号 / 令牌 / 记住密码，主/使用中身份与 ServerId 权威判定
 * 2. 三地址自动切换 + 网络模式（自动 / 内网 / 外网）+ 连通性测速
 * 3. 每服务器独立登录态；无令牌时凭记住的密码自动续登
 * 4. 与 EmbyX 原版单配置（emby_server / emby_token …）双向兼容，切换后 reload 生效
 *
 * Zero-dependency Vanilla JS；仅依赖 window.EmbyXCommon.authenticate
 */
(function (window) {
    'use strict';

    const LIST_KEY = 'embyx_saved_servers';
    const CURRENT_KEY = 'embyx_current_server_id';

    // atob/btoa 无法直接处理中文，这里做一次 UTF-8 往返
    const encodePwd = (s) => {
        try { return btoa(unescape(encodeURIComponent(s || ''))); } catch (e) { return ''; }
    };
    const decodePwd = (s) => {
        try { return decodeURIComponent(escape(atob(s || ''))); } catch (e) { return ''; }
    };

    // ═══════════════════════════════════════════
    // § 1. 服务器存储
    // ═══════════════════════════════════════════

    /** 依据地址猜一个名字：内网 IP / 外网域名 */
    function guessAddrLabel(url) {
        const raw = String(url || '').toLowerCase();
        try {
            const host = new URL(raw).hostname;
            if (/^(10\.|192\.168\.|127\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) return '内网';
        } catch (e) { }
        return /^https:/.test(raw) ? '外网' : '外网';
    }

    function newAddrId() {
        return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    }

    const ServerStore = {
        list() {
            try {
                const arr = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
                return Array.isArray(arr) ? arr : [];
            } catch (e) { return []; }
        },
        save(list) {
            localStorage.setItem(LIST_KEY, JSON.stringify(list || []));
        },
        idOf(server, user) {
            return String(server || '').replace(/\/+$/, '') + '|' + String(user || '');
        },
        /** 2.1.17（对齐 EmbyTok）：URL 归一化，用于地址比对 */
        normUrl(u) {
            let x = String(u || '').trim().replace(/\/+$/, '');
            if (x && !/^https?:\/\//i.test(x)) x = 'http://' + x;
            return x.toLowerCase();
        },
        /**
         * 2.1.17（对齐 EmbyTok）：按「用户名 + 任一地址命中 / token 相同」找已有服务器记录。
         * 2.1.22：判定顺序改为 精确主地址 > 地址簿 > token —— 同一台机器重复登录
         * 会拿到同一个 token，token 兜底必须放最后，否则显式新增第二台服务器时
         * 只要用户名相同就会被误并入第一台（「只能有一个服务器」bug 的根因）。
         */
        findBySession(user, url, token) {
            const n = this.normUrl(url);
            const list = this.list();
            const exact = list.find(s => s.user === user && this.normUrl(s.server) === n);
            if (exact) return exact;
            const byAddr = list.find(s => s.user === user && this.addrsOf(s).some(a => this.normUrl(a.url) === n));
            if (byAddr) return byAddr;
            if (token) {
                const byTok = list.find(s => s.user === user && !!s.token && s.token === token);
                if (byTok) return byTok;
            }
            return null;
        },
        /**
         * 2.2.1 需求3：ServerId 权威身份判定。
         * 同一台 Emby 机器的 ServerId 恒定 —— 不同机器（ServerId 不同）绝不合并，
         * 即使旧地址簿里残留过它的地址（这正是「登录第二台只显示一张卡」的历史根因：
         * 第二台的地址曾按旧逻辑并入第一台地址簿，之后每次登录都被 byAddr 吞回）。
         * 无 ServerId 的源（OpenList / 老接口）只认「主地址完全一致」或「token 相同」，
         * 不再用地址簿命中判定（2.2.4 起）。
         */
        findSameMachine(serverId, user, url, token) {
            const list = this.list();
            const n = this.normUrl(url);
            // 1) 精确主地址优先：用户填的就是这张卡的主地址。同一台机器多地址并存时，
            //    内网卡只会被内网地址命中、外网卡只会被外网地址命中，互不吞并。
            if (url) {
                const byMain = list.find(s => (!user || s.user === user) && this.normUrl(s.server) === n);
                if (byMain) return byMain;
            }
            // 2) 地址簿命中：该地址曾登记在某张卡下
            if (url) {
                const byAddr = list.find(s => (!user || s.user === user) && this.addrsOf(s).some(a => this.normUrl(a.url) === n));
                if (byAddr) return byAddr;
            }
            // 3) ServerId 权威：仅当没有任何地址命中时，用于跨地址识别同一台机器、补全老记录
            if (serverId) {
                const byId = list.find(s => s.serverId === serverId);
                if (byId) return byId;
            }
            // 4) token 兜底
            if (token) {
                return list.find(s => (!user || s.user === user) && !!s.token && s.token === token) || null;
            }
            return null;
        },
        currentId() { return localStorage.getItem(CURRENT_KEY) || ''; },
        setCurrent(id) { localStorage.setItem(CURRENT_KEY, id || ''); },
        current() {
            const list = this.list();
            return list.find(s => s.id === this.currentId()) || list.find(s => s.primary) || list[0] || null;
        },

        /** 一台服务器可挂多个地址：主地址（内网）+ 若干备用地址（外网 / 反代） */
        addrsOf(rec) {
            if (!rec) return [];
            let addrs = Array.isArray(rec.addrs) ? rec.addrs.filter(a => a && a.url) : [];
            if (!addrs.some(a => a.id === 'main')) {
                addrs.unshift({ id: 'main', label: guessAddrLabel(rec.server), url: rec.server || '' });
            } else {
                addrs = addrs.map(a => a.id === 'main' ? Object.assign({}, a, { url: rec.server || a.url }) : a);
            }
            return addrs.filter(a => a && a.url);
        },

        /** 当前选中的地址（没有选中就用第一条） */
        activeUrlOf(rec) {
            if (!rec) return '';
            const addrs = this.addrsOf(rec);
            const hit = addrs.find(a => a.id === rec.activeAddrId) || addrs[0];
            return (hit && hit.url) || rec.server || '';
        },

        setActiveAddr(serverId, addrId) {
            const list = this.list();
            const s = list.find(x => x.id === serverId);
            if (!s) return null;
            s.activeAddrId = addrId;
            // 选中的是主地址时，把 server 字段也同步过去（历史逻辑仍读 server）
            const addrs = this.addrsOf(s);
            const hit = addrs.find(a => a.id === addrId);
            if (hit && addrId === 'main') s.server = hit.url;
            this.save(list);
            return s;
        },

        upsertAddr(serverId, addr) {
            const list = this.list();
            const s = list.find(x => x.id === serverId);
            if (!s) return null;
            const addrs = this.addrsOf(s);
            let url = String(addr.url || '').trim().replace(/\/+$/, '');
            if (url && !/^https?:\/\//i.test(url)) url = 'http://' + url;
            if (!url) return null;
            const label = String(addr.label || '').trim() || guessAddrLabel(url);
            if (addr.id && addrs.some(a => a.id === addr.id)) {
                const i = addrs.findIndex(a => a.id === addr.id);
                addrs[i] = Object.assign({}, addrs[i], { label, url });
                if (addr.id === 'main') s.server = url;
            } else {
                const rec = { id: newAddrId(), label, url };
                addrs.push(rec);
                s.activeAddrId = s.activeAddrId || rec.id;
            }
            s.addrs = addrs;
            this.save(list);
            return s;
        },

        removeAddr(serverId, addrId) {
            if (addrId === 'main') return null;
            const list = this.list();
            const s = list.find(x => x.id === serverId);
            if (!s) return null;
            s.addrs = this.addrsOf(s).filter(a => a.id !== addrId);
            if (s.activeAddrId === addrId) s.activeAddrId = 'main';
            this.save(list);
            return s;
        },

        /** 新增或更新一条服务器记录（password 未传时保留原值）。
         *  2.1.17（对齐 EmbyTok）：身份判定内置——
         *  同一用户下，payload 地址命中已有记录的 server 或任一地址（或 token 相同）
         *  → 认定同一台，沿用该记录的主地址与 ID，只做更新；绝不因「当前连接地址」不同而新建。 */
        upsert(rec) {
            const list = this.list();
            // —— 身份解析：先按 EmbyTok 规则找「是不是已有这台服务器」——
            // 2.1.22：rec.__forceNew = 显式「新增服务器」流程，绝不并入已有卡片
            //（主地址+用户名完全一致的除外，那属于对同一张卡重新登录）
            let host = rec;
            if (rec.user && !rec.__forceNew) {
                // 2.2.4：身份判定与启动登记一致（ServerId 优先），不再按地址簿命中合并
                const found = this.findSameMachine(rec.serverId, rec.user, rec.server, rec.token);
                if (found) {
                    host = Object.assign({}, rec, {
                        server: found.server,          // 沿用主地址 → ID 不变
                        serverId: found.serverId || rec.serverId || ''
                    });
                }
            }
            const id = this.idOf(host.server, host.user);
            const idx = list.findIndex(s => s.id === id);
            const prev = idx >= 0 ? list[idx] : {};
            const merged = Object.assign({ online: true, primary: false }, prev, host, {
                id,
                updatedAt: Date.now()
            });
            if (rec.password === undefined) merged.password = prev.password || '';
            // 2.2.1：serverId 不被空值覆盖（老记录补全后，后续身份判定即走 ServerId 权威路径）
            if (!merged.serverId) merged.serverId = (prev && prev.serverId) || rec.serverId || '';
            // 地址簿：新服务器自动把登录地址收进「主地址」
            if (!Array.isArray(merged.addrs) || !merged.addrs.length) {
                merged.addrs = [{ id: 'main', label: guessAddrLabel(merged.server), url: merged.server || '' }];
            }
            merged.activeAddrId = merged.activeAddrId || 'main';
            if (idx >= 0) list[idx] = merged; else list.push(merged);
            if (!list.some(s => s.primary)) merged.primary = true;
            this.save(list);
            return merged;
        },
        /** 2.1.12：编辑服务器卡片 —— 免登录更新名称 / 主备外地址 / 密码 */
        updateServerMeta(id, meta) {
            const list = this.list();
            const s = list.find(x => x.id === id);
            if (!s) return null;
            const normUrl = u => {
                let x = String(u || '').trim().replace(/\/+$/, '');
                if (x && !/^https?:\/\//i.test(x)) x = 'http://' + x;
                return x;
            };
            if (meta.name !== undefined) s.name = String(meta.name).trim();
            if (meta.main) s.server = normUrl(meta.main) || s.server;
            if (meta.backup !== undefined) this._setSlotAddr(s, /备|内网/, '备用内网', normUrl(meta.backup));
            if (meta.external !== undefined) this._setSlotAddr(s, /外|域/, '外网', normUrl(meta.external));
            if (meta.password !== undefined) {
                const raw = String(meta.password || '');
                const isMasked = /^\*+$/.test(raw);
                if (!isMasked) {
                    if (raw && meta.remember !== false) {
                        s.password = encodePwd(raw);
                        s.pwdLen = raw.length;
                        s.hasPassword = true;
                    } else {
                        s.password = '';
                        s.pwdLen = 0;
                        s.hasPassword = false;
                    }
                }
            }
            this.save(list);
            return s;
        },

        /** 2.1.12 内部：按槽位（备用/外网）upsert 一条地址；url 为空时移除该槽位 */
        _setSlotAddr(s, re, label, url) {
            const addrs = this.addrsOf(s);
            const hit = addrs.find(a => a.id !== 'main' && re.test(a.label || ''));
            if (url) {
                if (hit) { hit.label = label; hit.url = url; }
                else addrs.push({ id: newAddrId(), label, url });
                s.addrs = addrs;
            } else if (hit) {
                s.addrs = addrs.filter(a => a !== hit);
                if (s.activeAddrId === hit.id) s.activeAddrId = 'main';
            }
        },

        remove(id) {
            const list = this.list().filter(s => s.id !== id);
            // 删掉主服务器时，把「主」让给第一条
            if (list.length && !list.some(s => s.primary)) list[0].primary = true;
            this.save(list);
            if (this.currentId() === id) this.setCurrent((list[0] || {}).id || '');
        },
        setPrimary(id) {
            const list = this.list();
            list.forEach(s => { s.primary = (s.id === id); });
            this.save(list);
        },

        /** 2.1.16：合并重复服务器（同一用户且地址重叠 / token 相同），清理误建产生的重复卡片 */
        mergeDuplicates() {
            const norm = u => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
            const list = this.list();
            const curId = this.currentId();
            let changed = false;
            let i = 0;
            while (i < list.length) {
                const a = list[i];
                if (!a) { i++; continue; }
                let j = i + 1, merged = false;
                while (j < list.length) {
                    const b = list[j];
                    if (b && b.user === a.user) {
                        const aAddrs = this.addrsOf(a), bAddrs = this.addrsOf(b);
                        // 2.2.5（EmbyPro 1.2 修复「同机两地址被并成一张卡」）：
                        // 仅当「主地址完全一致」才算重复并合并（真正的误建重复卡）。
                        // 同一台机器用内网+外网两个地址登录时，两张卡主地址不同 → 不合并 →
                        // 保留 2 张独立卡；两张卡只在用户误把同一地址加了两次时才合并去重。
                        const sameMachine = norm(a.server) === norm(b.server);
                        if (sameMachine) {
                            // 保留分高的一张：当前使用 > 有登录态 > 地址更多
                            const score = r => ((r.id === curId) ? 4 : 0) + (r.token ? 2 : 0) + Math.min(this.addrsOf(r).length, 3);
                            const keep = score(b) > score(a) ? b : a;
                            const drop = keep === a ? b : a;
                            // 把被并卡片特有的地址搬过去
                            const keepAddrs = this.addrsOf(keep);
                            this.addrsOf(drop).forEach(d => {
                                if (d && d.url && !keepAddrs.some(k => norm(k.url) === norm(d.url))) {
                                    keepAddrs.push(Object.assign({}, d, { id: 'addr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }));
                                }
                            });
                            keep.addrs = keepAddrs;
                            if (drop.primary && !keep.primary) keep.primary = true;
                            if (!keep.name && drop.name) keep.name = drop.name;
                            if (!keep.token && drop.token) { keep.token = drop.token; keep.userId = drop.userId || ''; }
                            if (!keep.hasPassword && drop.hasPassword) { keep.password = drop.password; keep.pwdLen = drop.pwdLen; keep.hasPassword = true; }
                            list.splice(list.indexOf(drop), 1);
                            if (curId === drop.id) this.setCurrent(keep.id);
                            changed = true;
                            merged = true;
                            continue;   // 同一位置重新检查（可能还有更多重复）
                        }
                    }
                    j++;
                }
                if (!merged) i++;
            }
            if (changed) this.save(list);
            return changed;
        },
        /**
         * 2.2.4：纠历史残留 —— 旧逻辑会把第二台机器的地址并进第一台的地址簿，
         * 表现为「新增服务器后地址还在第一张卡里」。这里把属于别的卡「主地址」的
         * 地址从本卡地址簿中剔除（本卡自己的主地址永不删除）。
         */
        separateMachines() {
            const list = this.list();
            let changed = false;
            const mains = list.map(s => ({ id: s.id, url: this.normUrl(s.server) }));
            list.forEach(s => {
                const own = this.normUrl(s.server);
                const addrs = this.addrsOf(s);
                const kept = addrs.filter(a => {
                    const u = this.normUrl(a.url);
                    if (!u || u === own) return true;
                    return !mains.some(m => m.id !== s.id && m.url === u);
                });
                if (kept.length !== addrs.length) {
                    s.addrs = kept;
                    if (s.activeAddrId && !kept.some(a => a.id === s.activeAddrId)) s.activeAddrId = 'main';
                    changed = true;
                }
            });
            if (changed) this.save(list);
            return changed;
        },
        /** 2.1.17：把每台服务器的地址簿按归一化 URL 持久去重（保留使用中/主地址那条） */
        persistDedupe() {
            const list = this.list();
            let changed = false;
            list.forEach(s => {
                const addrs = this.addrsOf(s);
                const seen = new Map();
                const kept = [];
                addrs.forEach(a => {
                    const k = this.normUrl(a.url);
                    const prev = seen.get(k);
                    if (!prev) { seen.set(k, a); kept.push(a); return; }
                    // 重复：优先保留主地址 / 使用中的那条
                    const better = (a.id === 'main' || a.id === s.activeAddrId) && !(prev.id === 'main' || prev.id === s.activeAddrId)
                        ? a : (String(a.label || '').length > String(prev.label || '').length ? a : prev);
                    kept[kept.indexOf(seen.get(k))] = better;
                    seen.set(k, better);
                    changed = true;
                });
                s.addrs = kept;
                if (s.activeAddrId && !kept.some(a => a.id === s.activeAddrId)) s.activeAddrId = (kept[0] || {}).id || 'main';
            });
            if (changed) this.save(list);
            return changed;
        },
        toggleOnline(id) {
            const list = this.list();
            const s = list.find(x => x.id === id);
            if (s) s.online = (s.online === false);
            this.save(list);
        },
        /** 把一条记录写回 EmbyX 的单配置存储，然后刷新页面生效（用当前选中的地址）
         *  v1.2.5：可选 targetLib —— 副服务器媒体库折叠页点库卡片时，切服务器后直接进该库 */
        activate(rec, targetLib) {
            if (!rec) return;
            const url = this.activeUrlOf(rec);
            localStorage.setItem('emby_server', url || '');
            localStorage.setItem('emby_user', rec.user || '');
            localStorage.setItem('emby_token', rec.token || '');
            localStorage.setItem('emby_uid', rec.userId || '');
            localStorage.setItem('emby_pwd_len', rec.pwdLen ? String(rec.pwdLen) : '0');
            if (rec.serverType) localStorage.setItem('embyx_server_type', rec.serverType);
            else localStorage.removeItem('embyx_server_type');
            if (rec.fnOS) localStorage.setItem('emby_fnOS', 'true');
            else localStorage.removeItem('emby_fnOS');
            this.setCurrent(rec.id);
            localStorage.removeItem('emby_views_cache');
            localStorage.removeItem('emby_favorites');
            localStorage.removeItem('emby_lib_id');
            localStorage.removeItem('emby_lib_type');
            localStorage.removeItem('embyx_lib_id');
            localStorage.removeItem('embyx_lib_type');
            // v1.2.5：切到副服务器后，直接进入用户点选的那个媒体库
            if (targetLib && targetLib.Id) {
                localStorage.setItem('emby_lib_id', String(targetLib.Id));
                localStorage.setItem('emby_lib_type', 'library');
                localStorage.setItem('emby_lib_name', String(targetLib.Name || ''));
                localStorage.setItem('embyx_lib_id', String(targetLib.Id));
                localStorage.setItem('embyx_lib_type', 'library');
            }
            location.reload();
        }
    };


    // ═══════════════════════════════════════════════════════════════
    // § 2. 连通性探测 / 测速 / 网络模式 / 三地址自动切换
    //     移植自 EmbyTok 1.5.5「多服务器与账号管理方案」
    // ═══════════════════════════════════════════════════════════════
    let app = null;
    const pingCache = new Map();

    function normalizeUrl(raw) {
        let x = String(raw || '').trim().replace(/\/+$/, '');
        if (x && !/^https?:\/\//i.test(x)) x = 'http://' + x;
        return x;
    }

    /**
     * 延迟测量：用与真实 API 一致的普通 fetch（不用 no-cors）。
     * 拿到任何 HTTP 响应（含 401/404/500）都算服务器存活；拒连 / DNS 失败 / 超时记 -1。
     */
    function measurePing(raw, force = false) {
        const base = normalizeUrl(raw);
        if (!base) return Promise.resolve(-1);
        const key = ServerStore.normUrl(base);
        const hit = pingCache.get(key);
        if (!force && hit && Date.now() - hit.t < 60000) return Promise.resolve(hit.ms);
        return new Promise(resolve => {
            let done = false;
            const finish = ms => {
                if (!done) { done = true; pingCache.set(key, { t: Date.now(), ms }); resolve(ms); }
            };
            const ctrl = new AbortController();
            const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { } finish(-1); }, 4000);
            const t0 = performance.now();
            fetch(base + '/emby/System/Info/Public', { cache: 'no-store', signal: ctrl.signal })
                .then(() => { clearTimeout(timer); finish(Math.round(performance.now() - t0)); })
                .catch(() => {
                    // 飞牛等非 Emby 网关：再试一次它的 ping 接口
                    fetch(base + '/v/api/v1/system/ping', { cache: 'no-store', signal: ctrl.signal })
                        .then(() => { clearTimeout(timer); finish(Math.round(performance.now() - t0)); })
                        .catch(() => { clearTimeout(timer); finish(-1); });
                });
        });
    }

    /** 卡片头部的延迟徽标：绿 <=150ms / 黄 <=500ms / 红 >500ms / 灰 = 不可达 */
    function pingBadgeHtml(ms) {
        if (ms < 0) return '<span class="ep-ping ep-ping-off" title="无法连通">离线</span>';
        const cls = ms <= 150 ? 'ep-ping-ok' : (ms <= 500 ? 'ep-ping-mid' : 'ep-ping-bad');
        return `<span class="ep-ping ${cls}" title="连通延迟">${ms}ms</span>`;
    }

    /** 网络模式：auto / lan / wan，持久化到 emby_net_mode（与 EmbyTok 方案一致） */
    function getNetMode() {
        const m = localStorage.getItem('emby_net_mode');
        return (m === 'lan' || m === 'wan') ? m : 'auto';
    }

    function setNetMode(mode) {
        const m = (mode === 'lan' || mode === 'wan') ? mode : 'auto';
        localStorage.setItem('emby_net_mode', m);
        if (window.EmbyProUI && typeof window.EmbyProUI.refreshNetMode === 'function') window.EmbyProUI.refreshNetMode();
        reselectAddress('embypro_netmode_' + Date.now());
        return m;
    }

    /** 自动 = 主地址 > 备用内网 > 外网；内网 = 主 + 备；外网 = 仅外网（无外网退回主+备） */
    function candidatesFor(mode, addrs) {
        const main = addrs.find(a => a.id === 'main') || null;
        const rest = addrs.filter(a => a.id !== 'main');
        const lan = rest.filter(a => !/外|域/.test(a.label || ''));
        const wan = rest.filter(a => /外|域/.test(a.label || ''));
        const lanAll = [main].filter(Boolean).concat(lan);
        if (mode === 'lan') return lanAll;
        if (mode === 'wan') return wan.length ? wan : lanAll;
        return lanAll.concat(wan);
    }

    /**
     * 按优先级逐个探测并切换地址，只在「当前选中的服务器」内部切换，绝不跨服务器。
     * onceKey 用 sessionStorage 保证每次启动 / 每次手动触发只切换一次，避免 reload 循环。
     */
    async function reselectAddress(onceKey) {
        const rec = ServerStore.current();
        if (!rec || !rec.server) return null;
        if (onceKey) {
            try {
                if (sessionStorage.getItem(onceKey)) return null;
                sessionStorage.setItem(onceKey, '1');
            } catch (e) { }
        }
        const addrs = candidatesFor(getNetMode(), ServerStore.addrsOf(rec));
        for (const a of addrs) {
            const ms = await measurePing(a.url, true);
            if (ms >= 0) {
                ServerStore.setActiveAddr(rec.id, a.id);
                if (ServerStore.normUrl(localStorage.getItem('emby_server')) !== ServerStore.normUrl(a.url)) {
                    localStorage.setItem('emby_server', a.url);
                    location.reload();
                }
                return a;
            }
        }
        return null;
    }

    // ═══════════════════════════════════════════════════════════════
    // § 3. 登录态：记住当前服务器 / 自动续登 / 退出 / 新增加密
    // ═══════════════════════════════════════════════════════════════

    /** 登录成功后登记（auth.js 与账号面板新增登录共用） */
    function rememberCurrent(payload) {
        if (!payload || !payload.server || !payload.user) return null;
        const rawPwd = payload.password || '';
        const isMasked = /^\*+$/.test(rawPwd);   // 密码框回显的星号掩码不能当真实密码

        const base = {
            user: payload.user,
            userId: payload.userId || '',
            token: payload.token || '',
            serverId: payload.serverId || '',
            serverType: payload.serverType || 'emby',
            fnOS: !!payload.fnOS,
            online: true
        };
        if (payload.name) base.name = payload.name;
        if (payload.remember && !isMasked && rawPwd) {
            base.password = encodePwd(rawPwd);
            base.pwdLen = rawPwd.length;
            base.hasPassword = true;
        } else if (payload.remember === false) {
            base.password = '';
            base.pwdLen = 0;
            base.hasPassword = false;
        }

        // ServerId 权威判定：同一台机器换地址只补地址簿，不多出一张卡
        const same = payload.forceNew ? null
            : ServerStore.findSameMachine(payload.serverId, payload.user, payload.server, payload.token);
        const up = Object.assign({ server: same ? same.server : payload.server }, base);
        if (payload.forceNew) up.__forceNew = true;
        const saved = ServerStore.upsert(up);
        if (saved.id) {
            const l = ServerStore.list();
            const hit0 = l.find(x => x.id === saved.id);
            if (hit0 && hit0.__forceNew) { delete hit0.__forceNew; ServerStore.save(l); }
        }

        if (same) {
            const addrs = ServerStore.addrsOf(saved);
            if (!addrs.some(a => a.url === payload.server)) {
                ServerStore.upsertAddr(saved.id, { label: guessAddrLabel(payload.server), url: payload.server });
            }
            const fresh = ServerStore.list().find(s => s.id === saved.id);
            const hit = ServerStore.addrsOf(fresh).find(a => a.url === payload.server);
            if (hit) ServerStore.setActiveAddr(saved.id, hit.id);
        }
        ServerStore.setCurrent(saved.id);
        return saved;
    }

    /** 账号面板「添加 / 登录服务器」：认证 → 写单配置 → 登记 → 重启生效 */
    async function loginNew(form) {
        const server = normalizeUrl(form.server);
        if (!server || !form.user) throw new Error('请填写服务器地址与用户名');
        const auth = await EmbyXCommon.authenticate({
            server,
            user: form.user,
            pwd: form.pwd || '',
            deviceName: (app && app.config.deviceName) || 'EmbyPro',
            deviceId: (app && app.config.deviceId) || '',
            appVersion: (app && app.config.appVersion) || '1.2'
        });
        const { data, userId, fnOS, serverType, finalServer } = auth;
        const url = finalServer || server;
        const serverId = data.ServerId || (data.User && data.User.ServerId) || '';

        localStorage.setItem('emby_server', url);
        localStorage.setItem('emby_user', form.user);
        localStorage.setItem('emby_token', data.AccessToken);
        localStorage.setItem('emby_uid', userId);
        localStorage.setItem('emby_pwd_len', form.pwd ? String(form.pwd.length) : '0');
        if (serverId) localStorage.setItem('emby_server_id', serverId);
        if (serverType) localStorage.setItem('embyx_server_type', serverType);
        if (fnOS) localStorage.setItem('emby_fnOS', 'true'); else localStorage.removeItem('emby_fnOS');

        const saved = rememberCurrent({
            server: url, user: form.user, userId, token: data.AccessToken,
            serverId, serverType, fnOS, name: form.name,
            password: form.pwd, remember: form.remember !== false,
            forceNew: true
        });
        if (saved) {
            if (form.backup) ServerStore.upsertAddr(saved.id, { label: '备用内网', url: form.backup });
            if (form.external) ServerStore.upsertAddr(saved.id, { label: '外网', url: form.external });
        }
        localStorage.removeItem('emby_views_cache');
        localStorage.removeItem('emby_favorites');
        localStorage.removeItem('emby_lib_id');
        localStorage.removeItem('emby_lib_type');
        return saved;
    }

    /** 无 token 但记住了密码 → 自动换令牌 */
    async function tryAutoLogin() {
        if (localStorage.getItem('emby_token')) return;
        const rec = ServerStore.current();
        if (!rec || !rec.password) return;
        const pwd = decodePwd(rec.password);
        if (!pwd) return;
        try {
            const auth = await EmbyXCommon.authenticate({
                server: ServerStore.activeUrlOf(rec) || rec.server,
                user: rec.user,
                pwd,
                deviceName: (app && app.config.deviceName) || 'EmbyPro',
                deviceId: (app && app.config.deviceId) || '',
                appVersion: (app && app.config.appVersion) || '1.2'
            });
            localStorage.setItem('emby_server', ServerStore.activeUrlOf(rec) || rec.server);
            localStorage.setItem('emby_user', rec.user);
            localStorage.setItem('emby_token', auth.data.AccessToken);
            localStorage.setItem('emby_uid', auth.userId);
            if (rec.serverType) localStorage.setItem('embyx_server_type', rec.serverType);
            if (rec.fnOS) localStorage.setItem('emby_fnOS', 'true');
            location.reload();
        } catch (e) {
            console.warn('[EmbyPro] 自动登录失败，请手动登录：', e);
        }
    }

    /** 退出当前登录：保留服务器与地址簿，清掉登录态与记住的密码 */
    function logout(id) {
        const list = ServerStore.list();
        const rec = list.find(s => s.id === id) || ServerStore.current();
        if (rec) {
            rec.token = '';
            rec.password = '';
            rec.pwdLen = 0;
            rec.hasPassword = false;
            ServerStore.save(list);
        }
        ['emby_token', 'emby_pwd_len', 'emby_views_cache', 'emby_favorites',
            'emby_lib_id', 'emby_lib_type', 'emby_can_delete'].forEach(k => localStorage.removeItem(k));
        location.reload();
    }

    // ═══════════════════════════════════════════════════════════════
    // § 4. 初始化
    // ═══════════════════════════════════════════════════════════════
    function init(appInstance) {
        app = appInstance;
        if (!app) return;

        // 历史数据清洗：合并重复卡 / 剥离误并入的地址 / 地址簿去重
        try {
            ServerStore.mergeDuplicates();
            ServerStore.separateMachines();
            ServerStore.persistDedupe();
        } catch (e) { console.warn('[EmbyPro] ServerStore cleanup:', e); }

        // 启动登记只「查找并更新」，绝不新建；全新安装（列表为空）才创建首卡
        if (app.config && app.config.server && app.config.user) {
            const found = ServerStore.findSameMachine(
                app.config.serverId, app.config.user, app.config.server, app.config.token);
            if (found) {
                const addrs = ServerStore.addrsOf(found);
                const hit = addrs.find(a => ServerStore.normUrl(a.url) === ServerStore.normUrl(app.config.server));
                if (!hit) {
                    ServerStore.upsertAddr(found.id, { label: guessAddrLabel(app.config.server), url: app.config.server });
                    const hit2 = ServerStore.addrsOf(ServerStore.list().find(s => s.id === found.id))
                        .find(a => ServerStore.normUrl(a.url) === ServerStore.normUrl(app.config.server));
                    if (hit2) ServerStore.setActiveAddr(found.id, hit2.id);
                } else if (hit.id !== found.activeAddrId) {
                    ServerStore.setActiveAddr(found.id, hit.id);
                }
                ServerStore.setCurrent(found.id);
            } else if (!ServerStore.list().length) {
                ServerStore.upsert({
                    server: app.config.server,
                    user: app.config.user,
                    userId: app.config.userId,
                    token: app.config.token,
                    serverId: app.config.serverId || '',
                    serverType: app.config.serverType || (window.EmbyXCommon ? EmbyXCommon.getServerType() : 'emby'),
                    fnOS: !!app.config.fnOS
                });
                ServerStore.setCurrent(ServerStore.idOf(app.config.server, app.config.user));
            }
        }

        // 登录表单「记住密码」回显
        const rememberBox = document.getElementById('configRememberPwd');
        if (rememberBox) {
            const rec = ServerStore.current();
            rememberBox.checked = !rec || rec.hasPassword !== false;
        }

        // 账号与服务器 UI（设置页卡片 + 头像浮层）
        if (window.EmbyProUI && typeof window.EmbyProUI.init === 'function') {
            try { window.EmbyProUI.init(app); } catch (e) { console.warn('[EmbyPro] UI init:', e); }
        }

        // 网络模式变化时重新选地址；启动时也做一次（sessionStorage 保证只一次）
        try {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn && conn.addEventListener) {
                conn.addEventListener('change', () => reselectAddress('embypro_netfailover_' + Date.now()));
            }
        } catch (e) { }
        reselectAddress('embypro_failover_done');
        tryAutoLogin();
    }

    window.EmbyProAccount = {
        init,
        store: ServerStore,
        rememberCurrent,
        loginNew,
        tryAutoLogin,
        logout,
        measurePing,
        pingBadgeHtml,
        getNetMode,
        setNetMode,
        reselectAddress,
        normalizeUrl
    };
})(window);
