/**
 * EmbyPro 1.2 — 账号与服务器 UI 层
 * 移植自 EmbyTok 1.5.5「多服务器与账号管理」方案：
 *   - 设置页「账号与服务器」卡片（1.5.5 重做）+ 底部账号面板浮层（AccountPanel）
 *   - EmbyPro 绿 #52B54B + zinc 深色卡片、绿色渐变圆头像、实心「主 / 使用中」徽标
 *   - 卡内 4 字段编辑（名称 / 主地址 / 备用内网 / 外网）带 http(s) 校验与内联错误
 *   - 删除二次确认、空态、添加/退出同行、横屏两列
 *   - 三地址地址簿、网络模式（自动/内网/外网）、延迟测速（绿/黄/红）
 *
 * 依赖：servers.js（window.EmbyProAccount）、window.app、lucide
 */
(function (window) {
    'use strict';

    const A = () => window.EmbyProAccount;
    const $ = id => document.getElementById(id);
    const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const toast = msg => { if (window.app && window.app.showToast) window.app.showToast(msg); };

    let app = null;
    let panelEl = null;
    let loginEl = null;
    let editingId = null;        // 卡内编辑
    let confirmId = null;        // 删除二次确认
    let expandedId = null;       // 展开地址簿
    let addrForm = null;         // { serverId, addrId|null }

    function hostOf(url) {
        try { return new URL(url).host; } catch (e) { return url || ''; }
    }

    // ═══════════════════ 卡片渲染 ═══════════════════

    function editHtml(rec) {
        const st = A().store;
        const addrs = st.addrsOf(rec);
        const main = (addrs.find(a => a.id === 'main') || {}).url || rec.server || '';
        const bk = (addrs.find(a => a.id !== 'main' && !/外|域/.test(a.label || '')) || {}).url || '';
        const ex = (addrs.find(a => a.id !== 'main' && /外|域/.test(a.label || '')) || {}).url || '';
        const field = (key, label, val, ph) => `
            <label class="block">
                <span class="ep-label">${label}</span>
                <input type="text" data-field="${key}" value="${esc(val)}" placeholder="${ph}" class="ep-input">
            </label>`;
        return `<div class="ep-edit" data-account-edit="${esc(rec.id)}">
            ${field('name', '名称', rec.name || '', 'My Emby')}
            ${field('main', '主地址', main, 'http://192.168.1.10:8096')}
            ${field('backup', '备用内网（可选）', bk, 'http://192.168.1.10:8096')}
            ${field('external', '外网地址（可选）', ex, 'https://emby.example.com')}
            <div class="ep-err hidden" data-account-err></div>
            <div class="flex gap-2 pt-1">
                <button class="ep-btn flex-1" data-act="editsave" data-id="${esc(rec.id)}">保存</button>
                <button class="ep-btn-soft px-4" data-act="editcancel" data-id="${esc(rec.id)}">取消</button>
            </div>
        </div>`;
    }

    function addrFormHtml(serverId) {
        const rec = A().store.list().find(x => x.id === serverId);
        const addrs = A().store.addrsOf(rec);
        const editing = addrForm && addrForm.addrId ? addrs.find(a => a.id === addrForm.addrId) : null;
        return `<div class="ep-addrform">
            <input data-role="addrLabel" value="${esc(editing ? editing.label : '')}" placeholder="名称（内网 / 外网 / 域名）" class="ep-input">
            <input data-role="addrUrl" value="${esc(editing ? editing.url : '')}" placeholder="http://外网地址:8096" inputmode="url" autocapitalize="off" class="ep-input">
            <div class="flex gap-1.5">
                <button class="ep-btn flex-1" data-act="saveaddr" data-id="${esc(serverId)}">保存</button>
                <button class="ep-btn-soft flex-1" data-act="canceladdr" data-id="${esc(serverId)}">取消</button>
            </div>
        </div>`;
    }

    function cardHtml(s) {
        const st = A().store;
        const curId = st.currentId();
        const active = s.id === curId;
        const online = s.online !== false;
        const addrs = st.addrsOf(s);
        const activeAddr = addrs.find(a => a.id === s.activeAddrId) || addrs[0] || { id: 'main', url: s.server, label: '' };
        const host = hostOf(activeAddr.url || s.server);
        const title = s.name || s.user || '未知用户';
        const editing = editingId === s.id;
        const confirming = confirmId === s.id;
        const expanded = expandedId === s.id;
        const btn = (act, label, cls, extra) =>
            `<button ${extra || ''} class="ep-row-btn ${cls}" data-act="${act}" data-id="${esc(s.id)}">${label}</button>`;

        return `<div class="ep-card ${active ? 'on' : ''}">
            <div class="flex items-center gap-3">
                <div class="ep-avatar"><i data-lucide="user" class="w-5 h-5 text-white"></i></div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <span class="text-white font-bold text-sm truncate">${esc(title)}</span>
                        ${s.primary ? '<span class="ep-badge ep-badge-main">主</span>' : ''}
                        ${active ? '<span class="ep-badge ep-badge-using">使用中</span>' : ''}
                        ${!online ? '<span class="ep-badge ep-badge-off">已停用</span>' : ''}
                        ${!s.token ? '<span class="ep-badge ep-badge-need">需登录</span>' : ''}
                    </div>
                    <div class="ep-sub truncate"><span class="truncate">${esc(s.user || '-')}</span><span class="opacity-40">@</span><span class="truncate">${esc(host)}</span></div>
                </div>
                <span class="ep-ping-slot shrink-0" data-ping-id="${esc(s.id)}" data-ping-url="${esc(activeAddr.url)}"><span class="ep-ping ep-ping-off">…</span></span>
                <button class="ep-icon-btn" data-act="ping" data-id="${esc(s.id)}" title="测试全部地址延迟"><i data-lucide="gauge" class="w-4 h-4"></i></button>
                <button class="ep-icon-btn ${online ? 'ep-online' : 'ep-offline'}" data-act="online" data-id="${esc(s.id)}" title="${online ? '在线（点击停用）' : '已停用（点击启用）'}"><i data-lucide="${online ? 'wifi' : 'wifi-off'}" class="w-4 h-4"></i></button>
                <button class="ep-icon-btn" data-act="toggle" data-id="${esc(s.id)}" title="服务器地址"><i data-lucide="${expanded ? 'chevron-up' : 'chevron-down'}" class="w-4 h-4"></i></button>
            </div>
            ${editing ? editHtml(s) : ''}
            <div class="flex items-center gap-1.5 mt-2.5">
                ${active ? '' : btn('use', '使用', `ep-btn ${online ? '' : 'opacity-40 pointer-events-none'}`)}
                ${btn('edit', '编辑', editing ? 'ep-btn-edit' : 'ep-btn-soft')}
                ${btn('primary', '设为主', s.primary ? 'ep-btn-off' : 'ep-btn-star', s.primary ? 'disabled' : '')}
                ${confirming
                ? `<div class="flex-1 flex items-center gap-1">
                        <button class="ep-btn-del flex-1" data-act="delconfirm" data-id="${esc(s.id)}">确认删除</button>
                        <button class="ep-btn-soft px-3" data-act="delcancel" data-id="${esc(s.id)}">取消</button>
                   </div>`
                : btn('del', '删除', 'ep-btn-del-soft')}
            </div>
            ${expanded ? `<div class="ep-addrs">
                <div class="flex items-center justify-between mb-1">
                    <span class="ep-label">服务器地址 · 点圆点选择使用中的地址</span>
                    <button class="ep-link" data-act="addaddr" data-id="${esc(s.id)}">+ 备用地址</button>
                </div>
                ${addrs.map(a => `<div class="flex items-center gap-2 py-1">
                    <button class="ep-radio" data-act="useaddr" data-id="${esc(s.id)}" data-addr="${esc(a.id)}">
                        ${a.id === activeAddr.id ? '<span class="ep-radio-dot"></span>' : ''}
                    </button>
                    <div class="flex-1 min-w-0">
                        <div class="text-[11px] text-white/85 truncate">${esc(a.label || '地址')}${a.id === 'main' ? '<span class="ep-tag">主地址</span>' : ''}</div>
                        <div class="text-[10px] text-white/40 truncate">${esc(a.url)}</div>
                    </div>
                    <span class="ep-rowping" data-rowping="${esc(a.url)}" data-srv="${esc(s.id)}"></span>
                    <button class="ep-icon-btn small" data-act="editaddr" data-id="${esc(s.id)}" data-addr="${esc(a.id)}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                    ${a.id === 'main' ? '' : `<button class="ep-icon-btn small" data-act="deladdr" data-id="${esc(s.id)}" data-addr="${esc(a.id)}"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-red-400"></i></button>`}
                </div>`).join('')}
                ${(addrForm && addrForm.serverId === s.id) ? addrFormHtml(s.id) : ''}
            </div>` : ''}
        </div>`;
    }

    /** 渲染后自动测量每张卡片「使用中地址」的延迟并回填徽标 */
    function schedulePing(box) {
        const api = A();
        box.querySelectorAll('[data-ping-id]').forEach(el => {
            const url = el.getAttribute('data-ping-url') || '';
            api.measurePing(url).then(ms => {
                const slot = box.querySelector(`[data-ping-id="${el.getAttribute('data-ping-id')}"]`);
                if (slot) slot.innerHTML = api.pingBadgeHtml(ms);
            });
        });
        // v1.2.5 第 9 项：地址簿里「每个地址后面」都要显示 ping 值。
        // 点「测试全部地址延迟」会强制重测并写入 measurePing 的缓存，
        // 随后 renderAll() 重渲染，这里从缓存即刻回填（绿/黄/红/离线）。
        box.querySelectorAll('[data-rowping]').forEach(el => {
            const url = el.getAttribute('data-rowping') || '';
            el.innerHTML = '<span class="ep-ping ep-ping-off">…</span>';
            api.measurePing(url).then(ms => {
                if (el.isConnected) el.innerHTML = api.pingBadgeHtml(ms);
            });
        });
    }

    /** 供设置页/外部手动触发一次全地址测速并回填 */
    function refreshPings() {
        ['epAccountCards', 'accountServerList'].forEach(id => {
            const box = $(id);
            if (!box) return;
            const api = A();
            const rows = [];
            box.querySelectorAll('[data-ping-id]').forEach(el => rows.push(el.getAttribute('data-ping-url') || ''));
            box.querySelectorAll('[data-rowping]').forEach(el => rows.push(el.getAttribute('data-rowping') || ''));
            Promise.all(rows.filter(Boolean).map(u => api.measurePing(u, true))).then(() => {
                renderAll();
            });
        });
    }

    function renderInto(box) {
        if (!box) return;
        const st = A().store;
        const list = st.list();
        if (!list.length) {
            box.innerHTML = '<button type="button" class="ep-empty-btn" data-act="add"><i data-lucide="plus-circle" class="w-5 h-5 ep-icon"></i>还没有服务器，点此添加 / 登录服务器</button>';
            return;
        }
        box.innerHTML = list.map(cardHtml).join('');

        box.querySelectorAll('[data-act]').forEach(el => {
            el.onclick = e => {
                e.stopPropagation();
                const id = el.dataset.id;
                const act = el.dataset.act;
                const addrId = el.dataset.addr;
                const st2 = A().store;
                const rec = st2.list().find(s => s.id === id);

                if (act === 'toggle') {
                    expandedId = expandedId === id ? null : id;
                    addrForm = null; renderAll();
                } else if (act === 'use') {
                    if (!rec) return;
                    if (!rec.token) { openLogin(rec); toast('这台服务器还没有登录，请先输入密码'); return; }
                    st2.activate(rec);
                } else if (act === 'primary') {
                    st2.setPrimary(id); toast('已设为主服务器'); renderAll();
                } else if (act === 'online') {
                    st2.toggleOnline(id); renderAll();
                } else if (act === 'edit' || act === 'editcancel') {
                    editingId = act === 'edit' ? (editingId === id ? null : id) : null;
                    confirmId = null; renderAll();
                } else if (act === 'editsave') {
                    const form = box.querySelector(`[data-account-edit="${id}"]`);
                    if (!form) return;
                    const errEl = form.querySelector('[data-account-err]');
                    const showErr = msg => {
                        if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
                        else toast(msg);
                    };
                    const val = k => { const x = form.querySelector(`[data-field="${k}"]`); return x ? x.value.trim() : ''; };
                    const strip = u => String(u || '').trim().replace(/\/+$/, '');
                    const main = strip(val('main')), backup = strip(val('backup')), external = strip(val('external'));
                    for (const [label, u] of [['主地址', main], ['备用内网', backup], ['外网地址', external]]) {
                        if (u && !/^https?:\/\//i.test(u)) { showErr(label + '必须以 http:// 或 https:// 开头'); return; }
                    }
                    if (!main) { showErr('主地址不能为空'); return; }
                    st2.updateServerMeta(id, { name: val('name'), main, backup, external });
                    editingId = null;
                    if (id === st2.currentId()) {
                        // 当前服务器主地址可能变了：同步单配置后重连
                        const fresh = st2.list().find(s => s.id === id);
                        if (fresh) localStorage.setItem('emby_server', st2.activeUrlOf(fresh));
                        toast('已保存，正在重新连接…');
                        setTimeout(() => location.reload(), 400);
                    } else { renderAll(); toast('已保存修改'); }
                } else if (act === 'del' || act === 'delcancel') {
                    confirmId = act === 'del' ? id : null; renderAll();
                } else if (act === 'delconfirm') {
                    st2.remove(id); confirmId = null; renderAll(); toast('已删除服务器');
                } else if (act === 'addaddr' || act === 'editaddr') {
                    expandedId = id;
                    addrForm = { serverId: id, addrId: act === 'editaddr' ? addrId : null };
                    renderAll();
                    setTimeout(() => { const x = box.querySelector('[data-role="addrUrl"]'); if (x) x.focus(); }, 60);
                } else if (act === 'canceladdr') {
                    addrForm = null; renderAll();
                } else if (act === 'saveaddr') {
                    const form = box.querySelector('.ep-addrform');
                    if (!form) return;
                    const url = (form.querySelector('[data-role="addrUrl"]') || {}).value || '';
                    const label = (form.querySelector('[data-role="addrLabel"]') || {}).value || '';
                    if (!url.trim()) { toast('请填写服务器地址'); return; }
                    if (!/^https?:\/\//i.test(url.trim())) { toast('地址必须以 http:// 或 https:// 开头'); return; }
                    st2.upsertAddr(id, { id: addrForm && addrForm.addrId ? addrForm.addrId : null, label, url });
                    addrForm = null; renderAll(); toast('已保存地址');
                } else if (act === 'deladdr') {
                    st2.removeAddr(id, addrId); renderAll(); toast('已删除该地址');
                } else if (act === 'useaddr') {
                    const fresh = st2.setActiveAddr(id, addrId);
                    if (!fresh) return;
                    if (id === st2.currentId()) { st2.activate(fresh); return; }
                    renderAll(); toast('已选择该地址');
                } else if (act === 'add') {
                    openLogin();
                } else if (act === 'ping') {
                    if (!rec) return;
                    const icon = el.querySelector('i');
                    if (icon) icon.classList.add('ep-spin');
                    toast('正在测试 ' + st2.addrsOf(rec).length + ' 个地址…');
                    Promise.all(st2.addrsOf(rec).map(async a => ({ url: a.url, ms: await A().measurePing(a.url, true) })))
                        .then(results => {
                            renderAll();
                            const ok = results.filter(r => r.ms >= 0);
                            if (!ok.length) toast('全部 ' + results.length + ' 个地址都连不上');
                            else toast('可用 ' + ok.length + '/' + results.length + ' 个地址，最快 ' + ok.sort((x, y) => x.ms - y.ms)[0].ms + 'ms');
                        });
                }
            };
        });

        box.querySelectorAll('[data-account-edit] input').forEach(inp => {
            inp.addEventListener('input', () => {
                const form = inp.closest('[data-account-edit]');
                const err = form && form.querySelector('[data-account-err]');
                if (err) { err.textContent = ''; err.classList.add('hidden'); }
            });
        });
        if (window.lucide) lucide.createIcons({ nodes: [box] });
        schedulePing(box);
    }

    function renderAll() {
        ['epAccountCards', 'accountServerList'].forEach(id => renderInto($(id)));
        refreshNetMode();
    }

    function refreshNetMode() {
        const m = A().getNetMode();
        const text = m === 'lan' ? 'N 内网' : (m === 'wan' ? 'W 外网' : 'A 自动');
        ['epNetModeBtn', 'accountNetModeBtn'].forEach(id => {
            const el = $(id);
            if (!el) return;
            el.textContent = text;
            el.title = '网络模式：' + (m === 'lan' ? '内网（主 > 备）' : m === 'wan' ? '外网' : '自动（主 > 备 > 外网）') + '，点击切换';
            el.dataset.mode = m;
        });
    }

    function cycleNetMode() {
        const m = A().getNetMode();
        const next = m === 'auto' ? 'lan' : (m === 'lan' ? 'wan' : 'auto');
        A().setNetMode(next);
        toast(next === 'lan' ? '网络模式：内网（主 > 备）' : next === 'wan' ? '网络模式：外网' : '网络模式：自动（主 > 备 > 外网）');
        refreshNetMode();
    }

    // ═══════════════════ 账号面板浮层 ═══════════════════

    function ensurePanel() {
        if (panelEl) return panelEl;
        panelEl = document.createElement('div');
        panelEl.id = 'accountPanel';
        panelEl.className = 'fixed inset-0 z-[90] hidden';
        panelEl.innerHTML = `
            <div class="absolute inset-0 bg-black/60" data-close="1"></div>
            <div class="ep-panel">
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2">
                        <i data-lucide="server" class="w-5 h-5 ep-icon"></i>
                        <h2 class="text-white text-lg ep-fblack">账号与服务器</h2>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="accountNetModeBtn" class="ep-mode" title="网络模式">A 自动</button>
                        <button class="ep-close" data-close="1" aria-label="关闭"><i data-lucide="x" class="w-4 h-4"></i></button>
                    </div>
                </div>
                <p class="ep-hint">可同时登录多台服务器，点「使用」切换当前播放的服务器</p>
                <div id="accountServerList" class="ep-grid"></div>
                <div class="flex items-center gap-2 mt-4">
                    <button id="accountAddBtn" class="ep-btn flex-1"><i data-lucide="plus" class="w-4 h-4"></i>添加 / 登录服务器</button>
                    <button id="accountLogoutBtn" class="ep-logout"><i data-lucide="log-out" class="w-3.5 h-3.5"></i>退出当前登录</button>
                </div>
                <div class="ep-foot"><i data-lucide="shield-check" class="w-3 h-3"></i>勾选「记住密码」后，令牌过期也会自动重新认证</div>
            </div>`;
        document.body.appendChild(panelEl);
        panelEl.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
        $('accountAddBtn').onclick = () => { close(); openLogin(); };
        $('accountLogoutBtn').onclick = () => {
            const id = A().store.currentId();
            if (!id) { toast('当前没有登录的服务器'); return; }
            A().logout(id);
        };
        $('accountNetModeBtn').onclick = e => { e.stopPropagation(); cycleNetMode(); };
        return panelEl;
    }

    function open() {
        ensurePanel();
        editingId = null; confirmId = null; expandedId = null; addrForm = null;
        renderAll();
        panelEl.classList.remove('hidden');
        if (window.lucide) lucide.createIcons({ nodes: [panelEl] });
    }

    function close() {
        if (panelEl) panelEl.classList.add('hidden');
        if (app && typeof app.showInterfaceTemp === 'function') app.showInterfaceTemp();
    }

    // ═══════════════════ 添加 / 登录服务器 ═══════════════════

    function ensureLogin() {
        if (loginEl) return loginEl;
        loginEl = document.createElement('div');
        loginEl.id = 'epLoginPanel';
        loginEl.className = 'fixed inset-0 z-[95] hidden';
        loginEl.innerHTML = `
            <div class="absolute inset-0 bg-black/70" data-close="1"></div>
            <div class="ep-panel">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2"><i data-lucide="plus-circle" class="w-5 h-5 ep-icon"></i>
                        <h2 class="text-white text-lg ep-fblack">添加 / 登录服务器</h2></div>
                    <button class="ep-close" data-close="1"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
                <div class="ep-form">
                    <label><span class="ep-label">名称（可选）</span><input id="epLoginName" class="ep-input" placeholder="家里 / 云端"></label>
                    <label><span class="ep-label">主地址</span><input id="epLoginServer" class="ep-input" inputmode="url" placeholder="http://192.168.1.10:8096"></label>
                    <label><span class="ep-label">备用内网（可选）</span><input id="epLoginBackup" class="ep-input" inputmode="url" placeholder="http://192.168.1.11:8096"></label>
                    <label><span class="ep-label">外网地址（可选）</span><input id="epLoginExternal" class="ep-input" inputmode="url" placeholder="https://emby.example.com"></label>
                    <div class="grid grid-cols-2 gap-2">
                        <label><span class="ep-label">用户名</span><input id="epLoginUser" class="ep-input" placeholder="用户名"></label>
                        <label><span class="ep-label">密码</span><input id="epLoginPwd" type="password" class="ep-input" placeholder="密码"></label>
                    </div>
                    <label class="ep-check"><input type="checkbox" id="epLoginRemember" checked><span>记住密码（令牌过期自动重新认证）</span></label>
                    <div id="epLoginTestOut" class="ep-hidden"></div>
                    <div class="ep-err hidden" id="epLoginErr"></div>
                    <div class="flex gap-2">
                        <button id="epLoginTestBtn" class="ep-btn-soft flex-1">测试连通</button>
                        <button id="epLoginGoBtn" class="ep-btn flex-[2]">立即连接</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(loginEl);
        loginEl.addEventListener('click', e => { if (e.target.closest('[data-close]')) loginEl.classList.add('hidden'); });

        /* v1.3.0：顶部抽屉 + 键盘自适应。
           ── 为什么需要：安卓 WebView 走 edge-to-edge 且未声明 windowSoftInputMode，
              键盘是「浮层」而不是把窗口顶上去，底部抽屉会被输入法完整盖住。
           ── 做法：① 面板贴顶（见 index.html #epLoginPanel .ep-panel）；
                   ② 用 visualViewport 把可视高度写成 --epVVH，键盘弹起时抽屉高度收敛；
                   ③ 焦点落到输入框后把它滚到抽屉中间，保证不被键盘压住。 */
        const syncVV = () => {
            const vv = window.visualViewport;
            if (!vv) return;
            const h = Math.round(vv.height);
            loginEl.style.setProperty('--epVVH', h + 'px');
            // 可视高度比窗口矮 80px 以上 → 判定键盘已弹起
            loginEl.classList.toggle('kb-open', h < window.innerHeight - 80);
        };
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', syncVV);
            window.visualViewport.addEventListener('scroll', syncVV);
        }
        window.addEventListener('orientationchange', () => setTimeout(syncVV, 200));
        loginEl.addEventListener('focusin', e => {
            if (!e.target || e.target.tagName !== 'INPUT') return;
            syncVV();
            const inp = e.target;
            setTimeout(() => {
                try { inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) { }
            }, 260);
        });
        loginEl.addEventListener('focusout', () => setTimeout(syncVV, 200));
        $('epLoginTestBtn').onclick = async () => {
            const urls = ['epLoginServer', 'epLoginBackup', 'epLoginExternal']
                .map(id => ($(id).value || '').trim()).filter(Boolean);
            const out = $('epLoginTestOut');
            out.classList.remove('ep-hidden');
            out.innerHTML = '正在测试 ' + urls.length + ' 个地址…';
            const rows = await Promise.all(urls.map(async u => ({ u, ms: await A().measurePing(u, true) })));
            out.innerHTML = rows.map(r => `<div>${esc(r.u)} → ${r.ms < 0 ? '<span class="ep-ping-off">不可达</span>' : '<span class="ep-ping-ok">' + r.ms + 'ms</span>'}</div>`).join('');
        };
        $('epLoginGoBtn').onclick = async () => {
            const err = $('epLoginErr');
            const fail = msg => { err.textContent = msg; err.classList.remove('hidden'); };
            err.classList.add('hidden');
            const payload = {
                name: $('epLoginName').value.trim(),
                server: $('epLoginServer').value.trim(),
                backup: $('epLoginBackup').value.trim(),
                external: $('epLoginExternal').value.trim(),
                user: $('epLoginUser').value.trim(),
                pwd: $('epLoginPwd').value.trim(),
                remember: $('epLoginRemember').checked
            };
            if (!payload.server || !payload.user) { fail('请填写主地址与用户名'); return; }
            if (!/^https?:\/\//i.test(payload.server) && !/^[\w.-]+(:\d+)?$/.test(payload.server)) { fail('主地址格式不正确'); return; }
            const btn = $('epLoginGoBtn');
            btn.disabled = true; btn.textContent = '连接中…';
            try {
                await A().loginNew(payload);
                location.reload();
            } catch (e) {
                fail('连接失败：' + (e && (e.message || e.status) ? (e.message || e.status) : '请检查地址与账号'));
                btn.disabled = false; btn.textContent = '立即连接';
            }
        };
        return loginEl;
    }

    function openLogin(rec) {
        ensureLogin();
        if (rec) {
            $('epLoginServer').value = rec.server || '';
            $('epLoginUser').value = rec.user || '';
            $('epLoginName').value = rec.name || '';
        }
        loginEl.classList.remove('hidden');
        const card = loginEl.querySelector('.ep-panel');
        if (card) card.scrollTop = 0;
        if (window.visualViewport) {
            loginEl.style.setProperty('--epVVH', Math.round(window.visualViewport.height) + 'px');
            loginEl.classList.toggle('kb-open',
                Math.round(window.visualViewport.height) < window.innerHeight - 80);
        }
        if (window.lucide) lucide.createIcons({ nodes: [loginEl] });
        setTimeout(() => { const x = $('epLoginServer'); if (x) x.focus(); }, 80);
    }

    // ═══════════════════ 初始化 ═══════════════════

    function init(appInstance) {
        app = appInstance;
        const box = $('epAccountCards');
        if (!box) return;
        const openBtn = $('epOpenAccountBtn');
        if (openBtn) openBtn.onclick = e => { e.stopPropagation(); open(); };
        const addBtn = $('epAddServerBtn');
        if (addBtn) addBtn.onclick = e => { e.stopPropagation(); openLogin(); };
        const modeBtn = $('epNetModeBtn');
        if (modeBtn) modeBtn.onclick = e => { e.stopPropagation(); cycleNetMode(); };
        renderAll();
    }

    window.EmbyProUI = { init, open, close, openLogin, renderAll, refreshNetMode, refreshPings };
})(window);
