/**
 * EmbyX Common Utilities (Zero-dependency, Vanilla JS)
 * 1. Server URL normalization and authentication (Jellyfin 10.x & 12 compatible)
 * 2. Media library Views fetching and caching
 * 3. Favorites synchronization and toggling
 * 4. Media item deletion
 * 5. Poster and person avatar URL builder
 * 6. GitHub release update checker
 */
(function (window) {
    'use strict';

    const SERVER_TYPE_KEY = 'embyx_server_type';

    function getServerType() {
        return (typeof localStorage !== 'undefined' && localStorage.getItem(SERVER_TYPE_KEY)) || 'emby';
    }

    function setServerType(type) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SERVER_TYPE_KEY, type || 'emby');
        }
    }

    const SERVER_TYPE_ICONS = {
        emby: 'img/emby.webp',
        jellyfin: 'img/jellyfin.webp',
        fnos: 'img/fnos.webp',
        openlist: 'img/openlist.webp'
    };

    // 登录态下在服务器地址输入框右侧回显类型图标（飞牛 OAuth 仅写 emby_fnOS，故优先判断）
    function updateServerTypeIcon(imgEl) {
        if (!imgEl || typeof localStorage === 'undefined') return;
        if (!localStorage.getItem('emby_server') || !localStorage.getItem('emby_token')) {
            imgEl.classList.add('hidden');
            return;
        }
        const type = localStorage.getItem('emby_fnOS') === 'true' ? 'fnos' : getServerType();
        imgEl.src = SERVER_TYPE_ICONS[type] || SERVER_TYPE_ICONS.emby;
        imgEl.classList.remove('hidden');
    }

    // 页面级公共工具：两页 EmbyApp 逐字节相同的实现，挂到原型上一次生效
    function installPageUtilities(AppClass) {
        if (!AppClass || !AppClass.prototype) return;
        const proto = AppClass.prototype;
        proto.getAuthHeaders = function (token = '', extra = {}) {
            return Object.assign(getAuthHeaders(this.config, token), extra);
        };
        proto.toggleLoading = function (show) {
            const el = this.dom.loading;
            if (!el) return;
            if (show) {
                el.classList.remove('hidden');
                // 加载中强制隐藏当前播放按钮，避免状态冲突导致的闪烁
                const slideIdx = (this.state.currentIndex % 3 + 3) % 3;
                const btn = document.getElementById(`playBtn-${slideIdx}`);
                if (btn) btn.classList.remove('paused');
            } else {
                el.classList.add('hidden');
            }
        };
        proto.showToast = function (msg, duration = 3000) {
            // 清除上一个计时器，防止快速连发 Toast 时提前消失
            if (this._toastTimer) clearTimeout(this._toastTimer);
            const t = this.dom.toast;
            if (!t) return;
            t.textContent = msg;
            t.classList.remove('opacity-0');
            this._toastTimer = setTimeout(() => t.classList.add('opacity-0'), duration);
        };
        proto.escapeHtml = function (str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
    }

    // 1. Jellyfin authentication and route compatibility interceptor
    function enableJellyfinFetchProxy() {
        if (window._jellyfinProxyEnabled) return;
        const origFetch = window.fetch;
        window.fetch = function (url, options) {
            let isTargetReq = false;
            if (getServerType() === 'jellyfin' && typeof url === 'string') {
                const savedServer = localStorage.getItem('emby_server');
                if (savedServer) {
                    try {
                        const target = new URL(savedServer, location.href);
                        const request = new URL(url, location.href);
                        const basePath = target.pathname.replace(/\/+$/, '');
                        isTargetReq = request.origin === target.origin &&
                            (request.pathname === basePath || request.pathname.startsWith(basePath + '/'));
                    } catch (e) {}
                }
            }
            if (isTargetReq) {
                // 1. URL normalization (strip /emby/, rewrite lowercase api_key to ApiKey, inject required Client param for DisplayPreferences)
                if (url.includes('/emby/')) {
                    url = url.replace(/\/emby(?=\/|\?|$)/, '');
                }
                url = url.replace(/([?&])api_key=/i, '$1ApiKey=');
                if (url.includes('/DisplayPreferences/') && !/[?&]client=/i.test(url)) {
                    url += (url.includes('?') ? '&' : '?') + 'Client=EmbyX';
                }

                options = options ? Object.assign({}, options) : {};
                let headers = options.headers;

                let token = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_token')) || '';
                let deviceName = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_device_name')) || 'Web Browser';
                let deviceId = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_device_id')) || '';
                let appVersion = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_app_version')) || '1.1';

                // 检查传入的 headers 中是否已有 token 或 deviceId 信息
                let existingAuth = '';
                if (headers) {
                    if (typeof headers.get === 'function') {
                        existingAuth = headers.get('Authorization') || headers.get('X-Emby-Authorization') || '';
                    } else if (typeof headers === 'object') {
                        existingAuth = headers['Authorization'] || headers['authorization'] || headers['X-Emby-Authorization'] || headers['x-emby-authorization'] || '';
                    }
                }

                if (existingAuth) {
                    const tokenMatch = existingAuth.match(/Token="([^"]+)"/i);
                    if (tokenMatch) token = tokenMatch[1];
                    const deviceMatch = existingAuth.match(/Device="([^"]+)"/i);
                    if (deviceMatch) deviceName = deviceMatch[1];
                    const deviceIdMatch = existingAuth.match(/DeviceId="([^"]+)"/i);
                    if (deviceIdMatch) deviceId = deviceIdMatch[1];
                    const verMatch = existingAuth.match(/Version="([^"]+)"/i);
                    if (verMatch) appVersion = verMatch[1];
                }

                const standardAuth = buildAuthHeader({ client: 'EmbyX', deviceName, deviceId, appVersion, token });

                if (headers && typeof headers.set === 'function') {
                    headers.set('Authorization', standardAuth);
                    headers.set('X-Emby-Authorization', standardAuth);
                } else {
                    headers = Object.assign({}, headers);
                    headers['Authorization'] = standardAuth;
                    headers['X-Emby-Authorization'] = standardAuth;
                    options.headers = headers;
                }
            }
            return origFetch.call(this, url, options);
        };
        window._jellyfinProxyEnabled = true;
    }

    // 2. Media and image URL path normalization
    function normalizeUrl(url) {
        if (typeof url === 'string' && getServerType() === 'jellyfin') {
            return url.replace(/\/emby(?=\/|\?|$)/, '').replace(/([?&])api_key=/i, '$1ApiKey=');
        }
        return url;
    }
    const fixUrlForJellyfin = normalizeUrl;

    // 3. Detect fnOS Video /v endpoint
    async function detectFnOS(server) {
        try {
            const res = await fetch(`${server}/v/api/v1/sys/version`, {
                headers: { 'Accept': 'application/json' }
            });
            if (!res.ok) return false;
            const data = await res.json();
            return data?.code === 0 && !!data?.data?.version;
        } catch (e) {
            return false;
        }
    }

    // 4. Server URL auto-completion and normalization
    function normalizeServerUrl(rawServer) {
        let server = (rawServer || '').trim().replace(/\/+$/, '');
        let isAutoFilled = false;
        if (server && !server.startsWith('http')) {
            const host = server.split(':')[0];
            const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(host) || host === 'localhost' || host === '127.0.0.1';

            if (location.protocol === 'https:' && isIP) {
                server = location.origin + '/app/juneix-embyx/proxy/8096';
                isAutoFilled = true;
            } else if (isIP && !server.includes(':')) {
                server = `http://${server}:8096`;
                isAutoFilled = true;
            } else {
                server = (isIP ? 'http://' : 'https://') + server;
            }
        }
        return { server, isAutoFilled };
    }

    /**
     * v1.3.2：HTTP 头值必须是 ByteString（ISO-8859-1）。中文版本号 / 设备名会让 fetch()
     * 在构造 RequestInit.headers 时抛 "String contains non ISO-8859-1 code point"。
     * 统一把非 Latin-1 字符按 UTF-8 百分号编码成 ASCII，并清理 CRLF / 引号。
     */
    function safeHeaderValue(value) {
        let s = String(value == null ? '' : value);
        let out = '';
        for (const ch of s) {
            const code = ch.codePointAt(0);
            if (code <= 0xFF && code >= 0x20 && code !== 0x7F) out += ch;
            else if (code <= 0xFF) out += ' ';
            else out += encodeURIComponent(ch);
        }
        return out.replace(/"/g, ' ');
    }

    // Build standard and Jellyfin 12 / Emby compatible Authorization header
    function buildAuthHeader({ client = 'EmbyX', deviceName = '', deviceId = '', appVersion = '', token = '' } = {}) {
        const c = safeHeaderValue(client || 'EmbyX');
        const d = safeHeaderValue(deviceName || (typeof localStorage !== 'undefined' && localStorage.getItem('emby_device_name')) || 'Web Browser');
        const id = safeHeaderValue(deviceId || (typeof localStorage !== 'undefined' && localStorage.getItem('emby_device_id')) || ('EmbyX-' + Math.random().toString(36).slice(2, 10)));
        const v = safeHeaderValue(appVersion || (typeof localStorage !== 'undefined' && localStorage.getItem('emby_app_version')) || '1.1');
        let header = `MediaBrowser Client="${c}", Device="${d}", DeviceId="${id}", Version="${v}"`;
        if (token) header += `, Token="${safeHeaderValue(token)}"`;
        return header;
    }

    // Convenient helper to generate dual-auth headers object
    function getAuthHeaders(config = {}, token = '') {
        const t = token || config.token || (typeof localStorage !== 'undefined' && localStorage.getItem('emby_token')) || '';
        const header = buildAuthHeader({
            client: 'EmbyX',
            deviceName: config.deviceName,
            deviceId: config.deviceId,
            appVersion: config.appVersion,
            token: t
        });
        return {
            'Authorization': header,
            'X-Emby-Authorization': header
        };
    }

    // 5. Core authentication flow with fallback handling
    async function authenticate({ server, user, pwd, deviceName, deviceId, appVersion, isAutoFilled }) {
        const performAuth = async (targetServer) => {
            const fnOS = await detectFnOS(targetServer);

            // Determine server type (Priority: fnOS > Jellyfin > Emby > OpenList)
            let serverType = 'emby';
            let isEmbyOrJellyfin = false;
            if (fnOS) {
                serverType = 'fnos';
            } else {
                for (const path of ['/System/Info/Public', '/emby/System/Info/Public']) {
                    try {
                        const res = await fetch(`${targetServer}${path}`);
                        if (!res.ok) continue;
                        const d = await res.json();
                        const prod = (d.ProductName || '').toLowerCase();
                        if (prod.includes('jellyfin')) {
                            serverType = 'jellyfin';
                            isEmbyOrJellyfin = true;
                            break;
                        } else if (d.Id || d.Version || prod.includes('emby')) {
                            serverType = 'emby';
                            isEmbyOrJellyfin = true;
                            break;
                        }
                    } catch (e) {}
                }
            }

            // If not fnOS and not Emby/Jellyfin, detect OpenList
            if (!fnOS && !isEmbyOrJellyfin && window.OpenListManager && typeof window.OpenListManager.detect === 'function') {
                try {
                    const isOpenList = await window.OpenListManager.detect(targetServer);
                    if (isOpenList) {
                        setServerType('openlist');
                        const openListAuth = await window.OpenListManager.authenticate({ server: targetServer, user, pwd });
                        return {
                            data: { AccessToken: openListAuth.token, ServerId: openListAuth.serverId },
                            userId: openListAuth.userId,
                            serverType: 'openlist',
                            fnOS: false,
                            finalServer: openListAuth.server
                        };
                    }
                } catch (oe) {
                    console.warn('[OpenList] Detection/Auth error:', oe);
                    throw oe;
                }
            }

            setServerType(serverType);
            if (serverType === 'jellyfin') {
                enableJellyfinFetchProxy();
            }

            const authHeader = buildAuthHeader({ client: 'EmbyX', deviceName, deviceId, appVersion });
            const headers = {
                'Content-Type': 'application/json',
                'X-Emby-Authorization': authHeader,
                'Authorization': authHeader
            };
            const reqBody = JSON.stringify({
                Username: user,
                Pw: pwd || '',
                Password: pwd || ''
            });

            // Jellyfin 12 completely removed the /emby/ route; prefer root path for Jellyfin and fallback on 404
            const primaryPath = serverType === 'jellyfin' ? '/Users/AuthenticateByName' : '/emby/Users/AuthenticateByName';
            const fallbackPath = serverType === 'jellyfin' ? '/emby/Users/AuthenticateByName' : '/Users/AuthenticateByName';

            let res = await fetch(`${targetServer}${primaryPath}`, {
                method: 'POST',
                headers,
                body: reqBody
            });

            // If primary path returns 404, try alternative path
            if (res.status === 404) {
                try {
                    const fallbackRes = await fetch(`${targetServer}${fallbackPath}`, {
                        method: 'POST',
                        headers,
                        body: reqBody
                    });
                    if (fallbackRes.ok) {
                        res = fallbackRes;
                    }
                } catch (e) {}
            }

            if (!res.ok) {
                throw { status: res.status };
            }

            const data = await res.json();
            if (!data.AccessToken) {
                throw { status: 'NO_TOKEN' };
            }

            const userId = (data.SessionInfo && data.SessionInfo.UserId) || (data.User && data.User.Id) || (data.SessionInfo && data.SessionInfo.Id) || '';

            return { data, userId, serverType, fnOS: serverType === 'fnos' };
        };

        try {
            const auth = await performAuth(server);
            return { ...auth, finalServer: auth.finalServer || server };
        } catch (err) {
            if (isAutoFilled && server.endsWith(':8096')) {
                const fallbackServer = server.replace(/:8096$/, ':8090');
                try {
                    const auth = await performAuth(fallbackServer);
                    return { ...auth, finalServer: fallbackServer };
                } catch (fallbackErr) {
                    throw err;
                }
            } else if (isAutoFilled && server.endsWith('/proxy/8096')) {
                const fallbackServer = server.replace(/\/proxy\/8096$/, '');
                try {
                    const auth = await performAuth(fallbackServer);
                    return { ...auth, finalServer: fallbackServer };
                } catch (fallbackErr) {
                    throw err;
                }
            } else {
                throw err;
            }
        }
    }

    // 6. Media library Views and Playlists fetching
    async function fetchLibrariesData({ server, token, userId, deviceName, deviceId, appVersion }) {
        if (getServerType() === 'openlist') {
            const playlistsData = { Items: [] };
            let viewsDataRaw = { Items: [] };
            if (window.OpenListManager && typeof window.OpenListManager.fetchViews === 'function') {
                viewsDataRaw = await window.OpenListManager.fetchViews();
            }
            // 与 Emby 分支保持同一份缓存键，媒体库弹窗可秒开并复用目录名称
            localStorage.setItem('emby_views_cache', JSON.stringify({ playlists: playlistsData, views: viewsDataRaw }));
            return { playlistsData, viewsDataRaw };
        }
        if (!server || !token || !userId) return { playlistsData: { Items: [] }, viewsDataRaw: { Items: [] } };
        const headers = getAuthHeaders({ deviceName, deviceId, appVersion, token });

        let playlistsData = { Items: [] };
        try {
            const playlistsRes = await fetch(`${server}/emby/Users/${userId}/Items?Recursive=true&IncludeItemTypes=Playlist&api_key=${token}`, {
                headers
            });
            if (playlistsRes.ok) {
                playlistsData = await playlistsRes.json();
            }
        } catch (e) {}

        const viewsRes = await fetch(`${server}/emby/Users/${userId}/Views?api_key=${token}`, {
            headers
        });
        const viewsDataRaw = viewsRes.ok ? await viewsRes.json() : { Items: [] };

        // Cache full views and playlists data
        localStorage.setItem('emby_views_cache', JSON.stringify({ playlists: playlistsData, views: viewsDataRaw }));

        return { playlistsData, viewsDataRaw };
    }

    /**
     * v1.2.15 第 4 项：拉取播放列表（带兜底）。
     * 不少 Emby 服务器的播放列表收在 CollectionType='playlists' 的专用文件夹里，
     * 直接 IncludeItemTypes=Playlist 的查询返回空；此时改按该文件夹的 ParentId 二次查询。
     */
    async function fetchPlaylists(cfg) {
        const d = await fetchLibrariesData(cfg);
        let items = (d.playlistsData && d.playlistsData.Items) || [];
        if (items.length) return items;
        if (getServerType() === 'openlist' || !cfg || !cfg.server || !cfg.token || !cfg.userId) return items;
        const views = (d.viewsDataRaw && d.viewsDataRaw.Items) || [];
        const plFolder = views.find(v => v && v.CollectionType === 'playlists');
        if (plFolder && plFolder.Id != null) {
            try {
                const headers = getAuthHeaders({ deviceName: cfg.deviceName, deviceId: cfg.deviceId, appVersion: cfg.appVersion, token: cfg.token });
                const res = await fetch(`${cfg.server}/emby/Users/${cfg.userId}/Items?ParentId=${plFolder.Id}&SortBy=SortName&api_key=${cfg.token}`, { headers });
                if (res.ok) {
                    const j = await res.json();
                    items = j.Items || [];
                }
            } catch (e) { }
        }
        return items;
    }

    // 7. Favorites management
    async function fetchFavorites({ server, token, userId, deviceName, deviceId, appVersion }) {
        if (getServerType() === 'openlist') {
            const raw = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_favorites')) || '[]';
            try {
                return new Set(JSON.parse(raw));
            } catch (e) {
                return new Set();
            }
        }
        if (!server || !token || !userId) return null;
        const headers = getAuthHeaders({ deviceName, deviceId, appVersion, token });
        const res = await fetch(`${server}/emby/Users/${userId}/Items?api_key=${token}&Recursive=true&Filters=IsFavorite&Fields=Id`, {
            headers
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const favIds = (data && data.Items) ? data.Items.map(i => String(i.Id)) : [];
        localStorage.setItem('emby_favorites', JSON.stringify(favIds));
        return new Set(favIds);
    }

    async function syncFavoriteStatus({ server, token, userId, itemId, isFav, deviceName, deviceId, appVersion }) {
        if (getServerType() === 'openlist') {
            const raw = (typeof localStorage !== 'undefined' && localStorage.getItem('emby_favorites')) || '[]';
            let list = [];
            try { list = JSON.parse(raw); } catch (e) {}
            const strId = String(itemId);
            if (isFav) {
                if (!list.includes(strId)) list.push(strId);
            } else {
                list = list.filter(id => id !== strId);
            }
            localStorage.setItem('emby_favorites', JSON.stringify(list));
            return true;
        }
        if (!server || !token || !userId || !itemId) return false;
        const method = isFav ? 'POST' : 'DELETE';
        const headers = getAuthHeaders({ deviceName, deviceId, appVersion, token });
        const res = await fetch(`${server}/emby/Users/${userId}/FavoriteItems/${itemId}?api_key=${token}`, {
            method,
            headers
        });
        return res.ok;
    }

    // 8. Delete media item
    // Emby / Jellyfin 的删除路由在 Jellyfin 12 已迁至根路径 /Items/{id}，
    // 且 /emby/* 兼容层没有 DELETE 路由（返回 404），因此 Jellyfin 必须显式走根路径。
    // 返回 { ok, status, reason }：reason 用于区分权限不足 / 服务端错误 / 已不存在。
    async function deleteMediaItem({ server, token, itemId, deviceName, deviceId, appVersion }) {
        if (!server || !token || !itemId) return { ok: false, status: 400, reason: 'bad-request' };

        const type = getServerType();
        if (type === 'openlist') {
            if (!window.OpenListManager || typeof window.OpenListManager.remove !== 'function') {
                return { ok: false, status: 0, reason: 'unsupported' };
            }
            return window.OpenListManager.remove(itemId);
        }

        const headers = getAuthHeaders({ deviceName, deviceId, appVersion, token });
        const basePath = type === 'jellyfin' ? '' : '/emby';
        const res = await fetch(`${server}${basePath}/Items/${encodeURIComponent(itemId)}?api_key=${token}`, {
            method: 'DELETE',
            headers
        });

        if (res.ok) return { ok: true, status: res.status };

        let reason = 'error';
        if (res.status === 401 || res.status === 403) reason = 'forbidden';
        else if (res.status === 404) reason = 'not-found';
        else if (res.status >= 500) reason = 'server-error';
        return { ok: false, status: res.status, reason };
    }

    // 8.1 当前账号是否具备删除权限
    // Emby / Jellyfin：登录响应里的 User.Policy（IsAdministrator 或 EnableContentDeletion）
    // OpenList：/api/me 的 permission 第 7 位（128 = PermRemove）
    function canDeleteMedia(config = {}) {
        const type = config.serverType || getServerType();
        if (type === 'openlist') {
            return !!(config.openlistCanRemove);
        }
        if (type === 'fnos') return false;
        return !!config.canDelete;
    }

    // 9. Poster and avatar URL builder
    function getItemImageUrl(server, item, token, fallback = 'img/poster.webp') {
        if (item && item.thumb) {
            return item.thumb;
        }
        if (item && item.ImageTags && item.ImageTags.Primary) {
            if (item.ImageTags.Primary.startsWith('http://') || item.ImageTags.Primary.startsWith('https://')) {
                return item.ImageTags.Primary;
            }
            return fixUrlForJellyfin(`${server}/emby/Items/${item.Id}/Images/Primary?api_key=${token}`);
        }
        return fallback;
    }

    function getPersonImageUrl(server, personName) {
        if (!server || !personName) return 'img/avatar.webp';
        return fixUrlForJellyfin(`${server}/emby/Persons/${encodeURIComponent(personName)}/Images/Primary`);
    }

    // 11. v1.2.2 对齐 EmbyTok 1.5.19：祖先链 / 全量演员 / 演员作品
    function _apiBase(config) {
        return String((config && config.server) || '').replace(/\/$/, '');
    }

    /** GET /Items/{id}/Ancestors —— 当前视频的文件夹链（由顶层媒体库到最深一层） */
    async function getItemAncestors(config, itemId) {
        const server = _apiBase(config);
        const token = (config && config.token) || '';
        const userId = (config && config.userId) || '';
        if (!server || !itemId) return [];
        const url = fixUrlForJellyfin(
            `${server}/emby/Items/${encodeURIComponent(itemId)}/Ancestors?UserId=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(token)}`);
        try {
            const res = await fetch(url, { headers: getAuthHeaders(config, token) });
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data) ? data : (data.Items || []);
        } catch (e) { return []; }
    }

    /** 分页拉全：v1.2.12 修复「Emby 里有、这里没有」——原来只取第 1 页 500 条且成功后提前 break，
     *  演员多（几千位）或主接口结果不全时后半部分直接丢失。这里按 TotalRecordCount 翻页到取完（上限 5000）。 */
    async function _fetchPersonsPaged(config, baseUrl, token) {
        const pageSize = 200;
        const hardCap = 5000;
        const out = [];
        let start = 0;
        while (start < hardCap) {
            let data = null;
            try {
                const res = await fetch(`${baseUrl}&StartIndex=${start}&Limit=${pageSize}`,
                    { headers: getAuthHeaders(config, token) });
                if (!res.ok) break;
                data = await res.json();
            } catch (e) { break; }
            const items = (data && data.Items) || [];
            if (!items.length) break;
            out.push(...items);
            start += items.length;
            const total = Number(data && data.TotalRecordCount) || 0;
            if (total && start >= total) break;
            if (items.length < pageSize) break;
        }
        return out;
    }

    /** GET /Persons（并集 /Users/{id}/Items?IncludeItemTypes=Person）—— 全服务器演员 */
    async function getLibraryPersons(config) {
        const server = _apiBase(config);
        const token = (config && config.token) || '';
        const userId = (config && config.userId) || '';
        if (!server || !token) return [];
        const fields = 'Fields=PrimaryImageAspectRatio,DateCreated,PremiereDate,ProductionYear,OfficialRating'
            + '&EnableImages=true&EnableUserData=true&SortBy=SortName&SortOrder=Ascending';
        const bases = [
            fixUrlForJellyfin(`${server}/emby/Persons?UserId=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(token)}&${fields}`),
            fixUrlForJellyfin(`${server}/emby/Users/${encodeURIComponent(userId)}/Items?api_key=${encodeURIComponent(token)}&Recursive=true&IncludeItemTypes=Person&${fields}`)
        ];
        const merged = new Map();
        // v1.2.12：两个接口都翻页拉全后取并集（不再「主接口有结果就跳过兜底」）
        for (const url of bases) {
            const list = await _fetchPersonsPaged(config, url, token);
            list.forEach(p => {
                if (p && p.Id && !merged.has(String(p.Id))) merged.set(String(p.Id), p);
            });
        }
        return Array.from(merged.values());
    }

    /** 服务端「收藏的演员」—— 用于本机收藏丢失/换机后仍能看到 Emby 里已收藏的演员 */
    async function getFavoritePersons(config) {
        const server = _apiBase(config);
        const token = (config && config.token) || '';
        const userId = (config && config.userId) || '';
        if (!server || !token) return [];
        const fields = 'Fields=PrimaryImageAspectRatio,DateCreated,PremiereDate,ProductionYear,OfficialRating'
            + '&EnableImages=true&EnableUserData=true&SortBy=SortName&SortOrder=Ascending';
        const bases = [
            fixUrlForJellyfin(`${server}/emby/Persons?UserId=${encodeURIComponent(userId)}&api_key=${encodeURIComponent(token)}&IsFavorite=true&${fields}`),
            fixUrlForJellyfin(`${server}/emby/Users/${encodeURIComponent(userId)}/Items?api_key=${encodeURIComponent(token)}&Recursive=true&IncludeItemTypes=Person&Filters=IsFavorite&${fields}`)
        ];
        const merged = new Map();
        for (const url of bases) {
            const list = await _fetchPersonsPaged(config, url, token);
            list.forEach(p => {
                if (p && p.Id && !merged.has(String(p.Id))) merged.set(String(p.Id), p);
            });
        }
        return Array.from(merged.values());
    }

    /** PersonIds 优先、Person 名称兜底 —— 某演员的全部视频 */
    async function getPersonItems(config, personId, personName) {
        const server = _apiBase(config);
        const token = (config && config.token) || '';
        const userId = (config && config.userId) || '';
        if (!server || !token || (!personId && !personName)) return { Items: [], TotalRecordCount: 0 };
        const by = personId ? `PersonIds=${encodeURIComponent(personId)}` : `Person=${encodeURIComponent(personName)}`;
        const fields = 'Fields=Overview,Path,RunTimeTicks,MediaSources,Tags,TagItems,SeriesName,ParentIndexNumber,IndexNumber,UserData';
        const url = fixUrlForJellyfin(
            `${server}/emby/Users/${encodeURIComponent(userId)}/Items?api_key=${encodeURIComponent(token)}`
            + `&Recursive=true&IncludeItemTypes=Movie,Episode,Video,MusicVideo&Limit=500`
            + `&SortBy=DateCreated&SortOrder=Descending&${fields}&${by}`);
        try {
            const res = await fetch(url, { headers: getAuthHeaders(config, token) });
            if (!res.ok) return { Items: [], TotalRecordCount: 0 };
            return await res.json();
        } catch (e) { return { Items: [], TotalRecordCount: 0 }; }
    }

    // 10. GitHub update check
    async function checkGitHubUpdate(currentVersion) {
        const lastCheck = localStorage.getItem('embyx_last_update_check');
        const now = Date.now();
        if (lastCheck && now - parseInt(lastCheck) < 24 * 60 * 60 * 1000) return null;

        try {
            const response = await fetch('https://api.github.com/repos/tangzimeng/embyxpro/releases/latest');
            if (!response.ok) return null;
            const data = await response.json();
            localStorage.setItem('embyx_last_update_check', now.toString());

            const latestTag = data.tag_name || '';
            const latestVersion = latestTag.replace('v', '').trim();

            const isNewer = (latest, current) => {
                const l = latest.split('.').map(Number);
                const c = current.split('.').map(Number);
                for (let i = 0; i < Math.max(l.length, c.length); i++) {
                    if ((l[i] || 0) > (c[i] || 0)) return true;
                    if ((l[i] || 0) < (c[i] || 0)) return false;
                }
                return false;
            };

            return {
                hasUpdate: isNewer(latestVersion, currentVersion),
                latestVersion,
                releaseUrl: data.html_url
            };
        } catch (e) {
            return null;
        }
    }

    // 11. PWA 安装提示与环境感知控制器（支持 Chromium beforeinstallprompt + iOS/其他浏览器图文引导，云构建 APK 静默跳过）
    const PWA_BANNER_DISMISSED_KEY = 'embyx_pwa_banner_dismissed';
    let _deferredInstallPrompt = null;
    let _pwaInstalled = false;
    let _pwaUiUpdater = null;

    function isApkEnv() {
        try {
            if (window.EmbyXNative || window.EmbyXNativeMedia || window.EmbyXCastDlna || window.Capacitor) {
                return true;
            }
            if (location.protocol === 'file:' || location.protocol === 'capacitor:') {
                return true;
            }
            const ua = navigator.userAgent || '';
            if (/Android/i.test(ua) && /; wv\)/i.test(ua)) {
                return true;
            }
        } catch (e) {}
        return false;
    }

    function isStandalonePwa() {
        if (_pwaInstalled) return true;
        try {
            if (window.navigator.standalone === true) return true;
            if (window.matchMedia) {
                if (window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches) {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function isIosDevice() {
        try {
            return /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && /Mobile/i.test(navigator.userAgent));
        } catch (e) {
            return false;
        }
    }

    function isMacSafari() {
        try {
            const ua = navigator.userAgent || '';
            return /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
        } catch (e) {
            return false;
        }
    }

    // 提前在脚本加载阶段挂载全局监听，防止错过早于 DOM 初始化触发的 beforeinstallprompt
    try {
        if (!isApkEnv()) {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                _deferredInstallPrompt = e;
                if (typeof _pwaUiUpdater === 'function') _pwaUiUpdater();
            });
            window.addEventListener('appinstalled', () => {
                _deferredInstallPrompt = null;
                _pwaInstalled = true;
                if (typeof _pwaUiUpdater === 'function') _pwaUiUpdater(true);
            });
        }
    } catch (e) {}

    function initPwaInstallPrompt(app) {
        const banner = document.getElementById('pwaInstallBanner');
        const bannerInstallBtn = document.getElementById('pwaBannerInstallBtn');
        const bannerCloseBtn = document.getElementById('pwaBannerCloseBtn');
        const cardInstallBtn = document.getElementById('pwaCardInstallBtn');
        const cardInstalledBadge = document.getElementById('pwaCardInstalledBadge');
        const accessMethodsSection = document.getElementById('accessMethodsSection');

        // 注册 Service Worker：v1.2.10 起 APK 内也注册（Capacitor https://localhost 为安全上下文），
        // SW 负责海报/图片的真实缓存（缓存优先 + LRU 裁剪），「缓存设置-已用缓存」因此有真实数据
        try {
            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.register('./sw.js').then(reg => {
                    try {
                        // 向 SW 同步缓存偏好（自动清理时长）
                        const p = JSON.parse(localStorage.getItem('embyCachePrefs') || '{}');
                        const w = navigator.serviceWorker.controller || (reg.active || (reg.installing || reg.waiting));
                        if (w && w.postMessage) {
                            w.postMessage({ type: 'embypro-cache-prefs', prefs: { maxAgeH: Number(p.cacheMaxAgeH) || 168 } });
                        }
                    } catch (e) {}
                }).catch(() => {});
            }
        } catch (e) {}

        const showManualInstallHint = () => {
            if (!app || typeof app.showToast !== 'function') return;
            if (isIosDevice()) {
                app.showToast('📲 请点击浏览器底部「分享」按钮 -> 选择「添加到主屏幕」', 4500);
            } else if (isMacSafari()) {
                app.showToast('💻 请点击顶部菜单栏「文件」->「添加到程序坞」', 4500);
            } else {
                app.showToast('💡 请点击浏览器地址栏右侧安装图标或菜单「添加到主屏幕 / 安装应用」', 4500);
            }
        };

        const triggerInstall = async (e) => {
            if (e) e.stopPropagation();
            if (isApkEnv() || isStandalonePwa()) return;

            if (_deferredInstallPrompt) {
                try {
                    _deferredInstallPrompt.prompt();
                    const choiceResult = await _deferredInstallPrompt.userChoice;
                    if (choiceResult && choiceResult.outcome === 'accepted') {
                        _deferredInstallPrompt = null;
                    }
                    syncUi();
                } catch (err) {
                    showManualInstallHint();
                }
            } else {
                showManualInstallHint();
            }
        };

        const syncUi = (justInstalled = false) => {
            const apk = isApkEnv();
            const standalone = isStandalonePwa();

            if (apk) {
                if (banner) banner.classList.add('hidden');
                if (accessMethodsSection) accessMethodsSection.classList.add('hidden');
                if (cardInstallBtn) cardInstallBtn.classList.add('hidden');
                if (cardInstalledBadge) cardInstalledBadge.classList.add('hidden');
                return;
            }

            if (accessMethodsSection) accessMethodsSection.classList.remove('hidden');

            if (standalone) {
                if (banner) banner.classList.add('hidden');
                if (cardInstallBtn) cardInstallBtn.classList.add('hidden');
                if (cardInstalledBadge) cardInstalledBadge.classList.remove('hidden');
                if (justInstalled && app && typeof app.showToast === 'function') {
                    app.showToast('✅ PWA 应用已安装');
                }
                return;
            }

            if (cardInstalledBadge) cardInstalledBadge.classList.add('hidden');
            if (cardInstallBtn) cardInstallBtn.classList.remove('hidden');

            const dismissed = typeof localStorage !== 'undefined' && localStorage.getItem(PWA_BANNER_DISMISSED_KEY) === 'true';
            const canShowBanner = !dismissed && (Boolean(_deferredInstallPrompt) || isIosDevice() || isMacSafari());
            if (banner) {
                if (canShowBanner) {
                    banner.classList.remove('hidden');
                    if (window.lucide) window.lucide.createIcons();
                } else {
                    banner.classList.add('hidden');
                }
            }
        };

        _pwaUiUpdater = syncUi;

        if (bannerInstallBtn) {
            bannerInstallBtn.onclick = triggerInstall;
        }
        if (cardInstallBtn) {
            cardInstallBtn.onclick = triggerInstall;
        }
        if (bannerCloseBtn) {
            bannerCloseBtn.onclick = (e) => {
                e.stopPropagation();
                try {
                    localStorage.setItem(PWA_BANNER_DISMISSED_KEY, 'true');
                } catch (err) {}
                if (banner) banner.classList.add('hidden');
            };
        }

        try {
            if (window.matchMedia) {
                const mq = window.matchMedia('(display-mode: standalone)');
                if (typeof mq.addEventListener === 'function') {
                    mq.addEventListener('change', () => syncUi());
                }
            }
        } catch (e) {}

        syncUi();
    }

    // Enable fetch proxy on startup if server type is Jellyfin
    try {
        if (getServerType() === 'jellyfin') {
            enableJellyfinFetchProxy();
        }
    } catch (e) {}

    // 检测 iOS PWA (主屏幕应用) 并为 <html> 注入 .ios-pwa 标记
    // 用于精确区分 iOS 状态栏强制避让与其他设备（常规浏览器、Android APK）的自然间距
    try {
        if (isIosDevice() && isStandalonePwa() && document.documentElement) {
            document.documentElement.classList.add('ios-pwa');
        }
    } catch (e) {}

    // Mount to global window
    window.EmbyXCommon = {
        getServerType,
        setServerType,
        updateServerTypeIcon,
        installPageUtilities,
        normalizeUrl,
        enableFetchProxy: enableJellyfinFetchProxy,
        enableJellyfinFetchProxy,
        fixUrlForJellyfin,
        detectFnOS,
        normalizeServerUrl,
        buildAuthHeader,
        getAuthHeaders,
        authenticate,
        fetchLibrariesData,
        fetchPlaylists,
        fetchFavorites,
        syncFavoriteStatus,
        deleteMediaItem,
        canDeleteMedia,
        getItemImageUrl,
        getPersonImageUrl,
        getItemAncestors,
        getLibraryPersons,
        getPersonItems,
        getFavoritePersons,
        checkGitHubUpdate,
        isApkEnv,
        isStandalonePwa,
        initPwaInstallPrompt
    };

    // Direct exports for compatibility
    window.enableJellyfinFetchProxy = enableJellyfinFetchProxy;
    window.fixUrlForJellyfin = fixUrlForJellyfin;
    window.normalizeUrl = normalizeUrl;
})(window);
