/**
 * EmbyX Unified Input & Interaction Engine (Zero-dependency, Vanilla JS)
 * Combines:
 * - 2D geometry-based spatial navigation for irregular layouts & TV remote focus
 * - Hardware keyboard shortcuts & focus management
 * - Mobile/touchscreen gestures (swipe, double-tap heart/skip)
 */
(function (window) {
    'use strict';

    class InputManager {
        constructor(options = {}) {
            this.app = options.app || null;
            this.okClickCount = 0;
            this.okClickTimer = null;

            // v1.2.7 第 5 项：Android 壳（MainActivity）把音量键转发到这里。
            // 打开 app 默认静音；按音量+键时若处于静音则自动解除并同步图标。
            const self = this;
            window.__embyxVolumeKey = function (dir) {
                try {
                    const app = self.app;
                    if (!app || !app.state || dir !== 'up' || !app.state.isMuted) return;
                    app.state.isMuted = false;
                    localStorage.setItem('emby_is_muted', 'false');
                    document.querySelectorAll('video[id^="video-p"]').forEach(v => { v.muted = false; });
                    const mb = document.getElementById('muteBtn');
                    if (mb) {
                        mb.innerHTML = '<div class="w-12 h-12 rounded-full flex items-center justify-center transition-colors"><i data-lucide="volume-2" class="stroke-white w-6 h-6 drop-shadow-md"></i></div>';
                        mb.classList.remove('epp-active');   // v1.2.7：解除静音后清除开启色
                        if (window.lucide) window.lucide.createIcons({ root: mb });
                    }
                    if (typeof app.showToast === 'function') app.showToast('🔊 已解除静音');
                } catch (e) { }
            };
        }

        // ══════════════════════════════════════════════════════════════
        // 1. 2D 空间导航与遥控器焦点管理 (原 SpatialNavigator)
        // ══════════════════════════════════════════════════════════════

        /**
         * Handle directional keys and OK/Enter inside active modal or grid view.
         * Returns true if the key event was consumed by navigation.
         */
        handleKey(e, context = {}) {
            const key = e.key;
            const keyCode = e.keyCode;
            const lowKey = (key || '').toLowerCase();
            const isInput = context.isInput || false;

            const isDirection = key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
                lowKey === 'w' || lowKey === 'a' || lowKey === 's' || lowKey === 'd' ||
                [38, 40, 37, 39].includes(keyCode);

            const isEnter = key === 'Enter' || keyCode === 13;

            if (!isDirection && !isEnter) return false;

            const container = context.container || document.body;
            const items = Array.from(container.querySelectorAll('.focusable-item'));
            if (!items.length) return false;

            let currentIndex = items.indexOf(document.activeElement);

            // 1. Directional Movement
            if (isDirection) {
                if (isInput) return false;
                e.preventDefault();

                if (currentIndex === -1) {
                    let startItem = items[0];
                    if (context.isGrid) {
                        const targetIdx = context.currentGridIndex ?? -1;
                        startItem = items.find(it => it.dataset.index == targetIdx) || items[0];
                    }
                    startItem?.focus();
                    return true;
                }

                // A. Fixed 3-column grid mode
                if (context.isGrid) {
                    let nextIdx = currentIndex;
                    if (key === 'ArrowDown' || lowKey === 's' || keyCode === 40) nextIdx += 3;
                    else if (key === 'ArrowUp' || lowKey === 'w' || keyCode === 38) nextIdx -= 3;
                    else if (key === 'ArrowRight' || lowKey === 'd' || keyCode === 39) nextIdx += 1;
                    else if (key === 'ArrowLeft' || lowKey === 'a' || keyCode === 37) nextIdx -= 1;

                    if (nextIdx >= 0 && nextIdx < items.length) {
                        items[nextIdx].focus();
                        items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    return true;
                }

                // B. 2D geometry-based spatial navigation (e.g., Library modal)
                if (context.isSpatial) {
                    const cur = items[currentIndex];
                    const curR = cur.getBoundingClientRect();
                    const curCx = curR.left + curR.width / 2;
                    const curCy = curR.top + curR.height / 2;

                    let dir;
                    if (key === 'ArrowDown' || lowKey === 's' || keyCode === 40) dir = 'down';
                    else if (key === 'ArrowUp' || lowKey === 'w' || keyCode === 38) dir = 'up';
                    else if (key === 'ArrowRight' || lowKey === 'd' || keyCode === 39) dir = 'right';
                    else if (key === 'ArrowLeft' || lowKey === 'a' || keyCode === 37) dir = 'left';

                    let best = null, bestScore = Infinity;
                    items.forEach(item => {
                        if (item === cur) return;
                        const r = item.getBoundingClientRect();
                        const cx = r.left + r.width / 2;
                        const cy = r.top + r.height / 2;
                        const dx = cx - curCx, dy = cy - curCy;

                        // Retain candidates in target direction with 2px tolerance
                        if (dir === 'down' && dy <= 2) return;
                        if (dir === 'up' && dy >= -2) return;
                        if (dir === 'right' && dx <= 2) return;
                        if (dir === 'left' && dx >= -2) return;

                        // Weighted distance: prioritize main axis, penalize off-axis deviation
                        const score = (dir === 'down' || dir === 'up')
                            ? Math.abs(dy) + Math.abs(dx) * 3
                            : Math.abs(dx) + Math.abs(dy) * 3;

                        if (score < bestScore) {
                            bestScore = score;
                            best = item;
                        }
                    });

                    if (best) {
                        best.focus();
                        best.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                    return true;
                }

                // C. Linear list cycling (e.g., Profile page)
                if (key === 'ArrowDown' || lowKey === 's' || key === 'ArrowRight' || lowKey === 'd' || [40, 39].includes(keyCode)) {
                    currentIndex = (currentIndex + 1) % items.length;
                } else {
                    currentIndex = (currentIndex - 1 + items.length) % items.length;
                }
                items[currentIndex].focus();
                return true;
            }

            // 2. OK / Enter trigger
            if (isEnter) {
                if (document.activeElement && document.activeElement.classList.contains('focusable-item')) {
                    const tagName = document.activeElement.tagName.toLowerCase();
                    if (tagName === 'textarea' || (tagName === 'input' && document.activeElement.type !== 'checkbox')) {
                        return false;
                    }
                    e.preventDefault();
                    document.activeElement.click();
                    return true;
                }
            }

            return false;
        }

        /**
         * Auto focus first or active item when modal opens
         */
        focusModal(containerEl, delayMs = 300) {
            if (!containerEl) return;
            setTimeout(() => {
                const allItems = Array.from(containerEl.querySelectorAll('.focusable-item'))
                    .filter(i => i.offsetParent !== null);
                const isProfile = containerEl.id === 'profilePage';
                // v1.2.8 第 2 项：媒体库弹窗聚焦已选中项时禁止滚动（preventScroll），
                // 并在聚焦后强制回到顶部，避免「先跳到选中项再滚动」的观感。
                const isLibrary = containerEl.id === 'libraryModal';
                // 仅在媒体库/播放列表等选择弹窗中优先聚焦带 bg-primary/20 的已选中项；个人中心始终保持在顶部服务器配置区，禁止跳滚到底部关于卡片
                const selected = isProfile ? null : allItems.find(i => i.classList.contains('bg-primary/20'));
                const target = selected || allItems[0];
                if (target) {
                    if (isProfile || isLibrary) {
                        target.focus({ preventScroll: true });
                        if (isLibrary) {
                            const body = containerEl.querySelector('#libraryModalBody') || containerEl;
                            body.scrollTop = 0;
                        }
                    } else {
                        target.focus();
                    }
                }
            }, delayMs);
        }

        /**
         * Blur active element if it belongs to closing modal
         */
        blurModal(containerEl) {
            if (containerEl && document.activeElement && containerEl.contains(document.activeElement)) {
                document.activeElement.blur();
            }
        }

        // ══════════════════════════════════════════════════════════════
        // 2. 键盘与全局按键分发
        // ══════════════════════════════════════════════════════════════

        bindKeyboard() {
            if (!this.app) return;
            const app = this.app;

            document.addEventListener('keydown', (e) => {
                const profileActive = document.getElementById('profilePage')?.classList.contains('active');
                const libraryActive = !document.getElementById('libraryModal')?.classList.contains('hidden');
                const playlistActive = !document.getElementById('addToPlaylistModal')?.classList.contains('hidden');

                const isInput = ['input', 'textarea', 'select'].includes(document.activeElement.tagName.toLowerCase());

                const key = e.key;
                const keyCode = e.keyCode;
                const lowKey = (key || '').toLowerCase();

                // ESC: 关闭任何打开的弹窗
                if (key === 'Escape') {
                    const modals = ['addToPlaylistModal', 'libraryModal', 'mediaInfoModal', 'castModal', 'deleteConfirmModal', 'syncConfirmModal'];
                    for (const id of modals) {
                        const el = document.getElementById(id);
                        if (el && !el.classList.contains('hidden')) {
                            app.toggleModal(id, false);
                            return;
                        }
                    }
                    if (profileActive) {
                        app.toggleModal('profilePage', false);
                        return;
                    }
                }

                // 空间导航 (Remote Control / Keyboard Focus)
                const isGridActive = document.getElementById('app')?.classList.contains('grid-active');
                if (profileActive || libraryActive || playlistActive || isGridActive) {
                    const isGrid = isGridActive && !profileActive && !libraryActive;
                    const container = profileActive ? document.getElementById('profilePage') :
                        libraryActive ? document.getElementById('libraryModal') :
                            playlistActive ? document.getElementById('addToPlaylistModal') :
                                document.getElementById('videoContainer');

                    const consumed = this.handleKey(e, {
                        isInput,
                        isGrid,
                        currentGridIndex: app.state.currentIndex,
                        isSpatial: libraryActive,
                        container
                    });
                    if (consumed) return;
                }

                if (isInput) return;

                // 1. 上下方向键 / WS：切换视频
                if (key === 'ArrowUp' || lowKey === 'w' || keyCode === 38) {
                    e.preventDefault();
                    app.prevVideo();
                } else if (key === 'ArrowDown' || lowKey === 's' || keyCode === 40) {
                    e.preventDefault();
                    app.nextVideo();
                }
                // 2. 左右方向键 / AD：快进快退 15 秒
                else if (key === 'ArrowLeft' || lowKey === 'a' || keyCode === 37) {
                    e.preventDefault();
                    const slideIdx = (app.state.currentIndex % 3 + 3) % 3;
                    const v = document.getElementById(`video-p${slideIdx}`);
                    if (v && v.duration) {
                        v.currentTime = Math.max(0, v.currentTime - 15);
                        this.showProgressOSD(v.currentTime, v.duration, true);
                    }
                    app.showInterfaceTemp();
                } else if (key === 'ArrowRight' || lowKey === 'd' || keyCode === 39) {
                    e.preventDefault();
                    const slideIdx = (app.state.currentIndex % 3 + 3) % 3;
                    const v = document.getElementById(`video-p${slideIdx}`);
                    if (v && v.duration) {
                        v.currentTime = Math.min(v.duration, v.currentTime + 15);
                        this.showProgressOSD(v.currentTime, v.duration, true);
                    }
                    app.showInterfaceTemp();
                }
                // 3. 确认逻辑：空格键 & OK键
                else if (key === ' ' || key === 'Enter' || keyCode === 13) {
                    e.preventDefault();
                    if (key === ' ') {
                        app.togglePlay();
                    } else {
                        this.okClickCount++;
                        if (this.okClickCount === 1) {
                            this.okClickTimer = setTimeout(() => {
                                app.togglePlay();
                                this.okClickCount = 0;
                            }, 300);
                        } else if (this.okClickCount === 2) {
                            clearTimeout(this.okClickTimer);
                            this.okClickCount = 0;
                            this.handleDoubleTap(window.innerWidth / 2, window.innerHeight / 2);
                        }
                    }
                }
                // 4. 菜单键/缩放键 (j / Menu)
                else if (lowKey === 'j' || keyCode === 18 || keyCode === 93 || keyCode === 118) {
                    e.preventDefault();
                    app.toggleScaleMode();
                    app.showInterfaceTemp();
                }
                // 5. 功能快捷键 (R, E, F, G, V, I, U, M, Y, H)
                else {
                    if (lowKey === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                        document.getElementById('folderBtn')?.click();
                    } else if (lowKey === 'f') {
                        app.dom.fullscreenBtn?.click();
                    } else if (lowKey === 'e') {
                        app.dom.viewModeBtn?.click();
                    } else if (lowKey === 'g') {
                        const modal = document.getElementById('libraryModal');
                        if (modal && !modal.classList.contains('hidden')) {
                            app.toggleModal('libraryModal', false);
                        } else {
                            app.showLibraries();
                            app.dom.libraryBtn?.classList.remove('nav-clicked');
                            void app.dom.libraryBtn?.offsetWidth;
                            app.dom.libraryBtn?.classList.add('nav-clicked');
                            setTimeout(() => app.dom.libraryBtn?.classList.remove('nav-clicked'), 1000);
                        }
                    } else if (lowKey === 'i') {
                        const modal = document.getElementById('profilePage');
                        if (modal && modal.classList.contains('active')) {
                            app.toggleModal('profilePage', false);
                        } else {
                            app.toggleModal('profilePage', true);
                            app.dom.myBtn?.classList.remove('nav-clicked');
                            void app.dom.myBtn?.offsetWidth;
                            app.dom.myBtn?.classList.add('nav-clicked');
                            setTimeout(() => app.dom.myBtn?.classList.remove('nav-clicked'), 1000);
                        }
                    } else if (lowKey === 'v') {
                        if (!isGridActive) {
                            if (app.dom.mediaInfoModal && !app.dom.mediaInfoModal.classList.contains('hidden')) {
                                app.toggleModal('mediaInfoModal', false);
                            } else {
                                app.showMediaInfo();
                            }
                        }
                    } else if (lowKey === 'm') {
                        app.dom.muteBtn?.click();
                    } else if (lowKey === 't' || lowKey === 'c') {
                        if (!isGridActive) {
                            const castModal = document.getElementById('castModal');
                            if (castModal && !castModal.classList.contains('hidden')) {
                                app.castManager?.closeModal();
                            } else {
                                app.castManager?.showPicker();
                            }
                        }
                    } else if (lowKey === 'u') {
                        this.showCenterHeartAnimation();
                        const id = String(app.state.videos[app.state.currentIndex]?.Id);
                        if (!app.state.favorites.has(id)) {
                            app.toggleFavorite();
                            const favBtn = document.getElementById('favoriteBtn');
                            if (favBtn) {
                                favBtn.innerHTML = `<div class="w-12 h-12 flex items-center justify-center"><i data-lucide="heart" class="text-secondary fill-secondary w-6 h-6 drop-shadow-md"></i></div>`;
                                if (window.lucide) lucide.createIcons({ root: favBtn });
                            }
                        }
                        app.showInterfaceTemp();
                    } else if (lowKey === 'y') {
                        if (app.state.isFilteredByPerson) {
                            app.toggleViewMode();
                        } else {
                            const btn = document.getElementById('personBtn');
                            if (btn && btn.dataset.personName) btn.click();
                        }
                    } else if (lowKey === 'h') {
                        const playlistModal = document.getElementById('addToPlaylistModal');
                        if (playlistModal && !playlistModal.classList.contains('hidden')) {
                            app.toggleModal('addToPlaylistModal', false);
                        } else {
                            app.showAddToPlaylist();
                            app.showInterfaceTemp();
                        }
                    }
                }
            });
        }

        /**
         * 鼠标滚轮 = 切换上 / 下一个视频（桌面端 / Windows 版）：
         * 在视频播放页滚动滚轮即切换——向下=下一个、向上=上一个，并自动播放。
         * 仅在播放态（viewMode==='stream'）且非投屏、且当前无弹窗时生效；
         * 宫格态 / 弹窗内滚动照常放行，不拦截页面滚动。
         */
        bindWheel() {
            if (!this.app) return;
            const container = document.getElementById('videoContainer');
            if (!container) return;

            // 这些弹窗打开时，滚轮应留在弹窗内滚动，而不是切视频
            const MODAL_IDS = ['addToPlaylistModal', 'libraryModal', 'mediaInfoModal',
                'castModal', 'deleteConfirmModal', 'syncConfirmModal', 'profilePage',
                'settingsModal', 'globalSettingsModal', 'accountPanel', 'serverModal'];
            const isModalOpen = () => {
                if (MODAL_IDS.some(id => {
                    const el = document.getElementById(id);
                    return el && !el.classList.contains('hidden');
                })) return true;
                return !!document.querySelector('.modal:not(.hidden), .overlay:not(.hidden), [data-modal]:not(.hidden)');
            };

            let lastSwitch = 0;
            const COOLDOWN = 500;  // 单次滚动手势只切一个视频，避免触控板连续触发狂切

            container.addEventListener('wheel', (e) => {
                const app = this.app;
                if (!app || !app.state) return;
                if (app.state.viewMode !== 'stream') return;          // 宫格态：放行页面滚动
                if (app.castManager && app.castManager.isCasting) return;
                if (e.ctrlKey) return;                                // Ctrl+滚轮留给缩放
                if (isModalOpen()) return;                            // 弹窗内滚动不切视频

                if (Math.abs(e.deltaY) < 5) return;                   // 忽略微小抖动
                const now = Date.now();
                if (now - lastSwitch < COOLDOWN) { e.preventDefault(); return; }

                e.preventDefault();
                lastSwitch = now;
                if (e.deltaY > 0) app.nextVideo();                    // 向下滚 → 下一个
                else app.prevVideo();                                 // 向上滚 → 上一个
                if (typeof app.showInterfaceTemp === 'function') app.showInterfaceTemp();
            }, { passive: false });
        }

        // ══════════════════════════════════════════════════════════════
        // 3. 触控、手势与进度条交互
        // ══════════════════════════════════════════════════════════════

        bindGestures(container) {
            if (this.app?.stage) {
                this.app.stage.bindGestures(container);
            }
            this.bindProgressBar();
        }

        /**
         * 绑定进度条指针拖拽控制器 (PointerEvents 1:1 精确跟手抓取)
         */
        bindProgressBar() {
            const bar = document.getElementById('progressBarContainer');
            if (!bar || this._hasBoundProgressBar) return;
            this._hasBoundProgressBar = true;

            let isBarDragging = false;
            let targetTime = 0;

            const updateFromPointer = (e) => {
                const app = this.app;
                if (!app) return;
                const slideIdx = (app.state.currentIndex % 3 + 3) % 3;
                const v = document.getElementById(`video-p${slideIdx}`);
                const current = app.state.videos ? app.state.videos[app.state.currentIndex] : null;

                const isCasting = !!(app.castManager && app.castManager.isCasting);
                const duration = (isCasting && current?.RunTimeTicks)
                    ? (current.RunTimeTicks / 10000000)
                    : (v && v.duration ? v.duration : (current?.RunTimeTicks ? current.RunTimeTicks / 10000000 : 0));

                if (!duration || duration <= 0) return;

                const rect = bar.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                targetTime = ratio * duration;

                this.showProgressOSD(targetTime, duration, false);
            };

            bar.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                try { bar.setPointerCapture(e.pointerId); } catch (_) {}
                isBarDragging = true;
                if (this.app) this.app.state.isDragging = true;

                const progressLine = document.getElementById('progressLine');
                if (progressLine) progressLine.style.transition = 'none';

                updateFromPointer(e);
            });

            bar.addEventListener('pointermove', (e) => {
                if (!isBarDragging) return;
                e.stopPropagation();
                updateFromPointer(e);
            });

            const endBarDrag = (e) => {
                if (!isBarDragging) return;
                e.stopPropagation();
                isBarDragging = false;
                if (this.app) this.app.state.isDragging = false;
                try { bar.releasePointerCapture(e.pointerId); } catch (_) {}

                const progressLine = document.getElementById('progressLine');
                if (progressLine) progressLine.style.transition = '';

                const app = this.app;
                if (app) {
                    if (app.castManager && app.castManager.isCasting) {
                        if (targetTime !== undefined) {
                            app.castManager.seekTo(targetTime);
                        }
                        if (typeof app.showInterfaceTemp === 'function') {
                            app.showInterfaceTemp();
                        }
                    } else {
                        const slideIdx = (app.state.currentIndex % 3 + 3) % 3;
                        const v = document.getElementById(`video-p${slideIdx}`);
                        if (v && targetTime !== undefined) {
                            v.currentTime = targetTime;
                        }
                        if (typeof app.showInterfaceTemp === 'function') {
                            app.showInterfaceTemp();
                        }
                    }
                }

                this.hideProgressOSD(300);
            };

            bar.addEventListener('pointerup', endBarDrag);
            bar.addEventListener('pointercancel', endBarDrag);
        }

        /**
         * 居中偏下进度预览 OSD (Pill OSD) 统一调度
         */
        showProgressOSD(current, duration, autoHide = false) {
            const osd = document.getElementById('progressOSD');
            if (!osd) return;

            if (this._osdTimer) clearTimeout(this._osdTimer);

            const formatTime = (seconds) => {
                if (isNaN(seconds) || seconds < 0) return '00:00';
                const s = Math.floor(seconds);
                const m = Math.floor(s / 60);
                const remSec = s % 60;
                return `${m.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
            };

            const curEl = document.getElementById('osdCurrentTime');
            const totalEl = document.getElementById('osdTotalTime');
            if (curEl) curEl.textContent = formatTime(current);
            if (totalEl) totalEl.textContent = formatTime(duration);

            osd.classList.remove('opacity-0');
            osd.classList.add('opacity-100');

            // 全屏模式下临时唤醒进度条
            const bottomInfo = document.querySelector('.bottom-info');
            if (bottomInfo) bottomInfo.classList.add('show-progress');

            // 实时更新进度条宽度与底部时间
            if (duration > 0) {
                const line = document.getElementById('progressLine');
                if (line) line.style.width = `${(current / duration) * 100}%`;
            }
            const curTimeEl = document.getElementById('currentTime');
            if (curTimeEl) curTimeEl.textContent = formatTime(current);

            if (autoHide) {
                this._osdTimer = setTimeout(() => {
                    this.hideProgressOSD();
                }, 1200);
            }
        }

        hideProgressOSD(delay = 0) {
            if (this._osdTimer) clearTimeout(this._osdTimer);
            const doHide = () => {
                const osd = document.getElementById('progressOSD');
                if (osd) {
                    osd.classList.remove('opacity-100');
                    osd.classList.add('opacity-0');
                }
                const bottomInfo = document.querySelector('.bottom-info');
                if (bottomInfo) bottomInfo.classList.remove('show-progress');
            };

            if (delay > 0) {
                this._osdTimer = setTimeout(doHide, delay);
            } else {
                doHide();
            }
        }

        async handleDoubleTapSkip(direction, x, y) {
            if (!this.app) return;
            const app = this.app;
            const slideIdx = (app.state.currentIndex % 3 + 3) % 3;
            const v = document.getElementById(`video-p${slideIdx}`);
            if (!v || !v.duration) return;

            const isRewind = direction === 'rewind';
            if (isRewind) {
                v.currentTime = Math.max(0, v.currentTime - 15);
            } else {
                v.currentTime = Math.min(v.duration, v.currentTime + 15);
            }
            this.showProgressOSD(v.currentTime, v.duration, true);
            app.showInterfaceTemp();

            const bubble = document.createElement('div');
            bubble.innerHTML = `
                <div class="flex flex-col items-center justify-center bg-black/25 backdrop-blur-xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.25),0_8px_24px_rgba(0,0,0,0.3)] text-white rounded-full w-[80px] h-[80px] space-y-1">
                    <div class="flex items-center justify-center">
                        ${isRewind ? '<i data-lucide="chevrons-left" class="w-6 h-6"></i>' : '<i data-lucide="chevrons-right" class="w-6 h-6"></i>'}
                    </div>
                    <span class="text-xs font-bold leading-none">15s</span>
                </div>
            `;
            bubble.className = 'absolute pointer-events-none z-50 transform transition-all duration-300 ease-out flex items-center justify-center';
            bubble.style.top = `${Math.max(80, Math.min(y - 40, window.innerHeight - 80))}px`;
            if (isRewind) bubble.style.left = '20px';
            else bubble.style.right = '20px';
            bubble.style.opacity = '0';
            bubble.style.transform = `scale(0.8) ${isRewind ? 'translateX(-20px)' : 'translateX(20px)'}`;

            document.getElementById('app').appendChild(bubble);
            if (window.lucide) lucide.createIcons({ root: bubble });

            requestAnimationFrame(() => {
                bubble.style.transform = 'scale(1) translateX(0)';
                bubble.style.opacity = '1';
                setTimeout(() => {
                    bubble.style.transform = `scale(0.8) ${isRewind ? 'translateX(-20px)' : 'translateX(20px)'}`;
                    bubble.style.opacity = '0';
                    setTimeout(() => bubble.remove(), 300);
                }, 400);
            });
        }

        showCenterHeartAnimation() {
            const heart = document.createElement('div');
            heart.className = 'heart-anim absolute pointer-events-none z-50';
            heart.style.cssText = `left:calc(50% - 32px);top:calc(50% - 32px);--rot:${Math.floor(Math.random() * 40) - 20}deg`;
            heart.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drop-shadow-xl"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
            document.getElementById('app').appendChild(heart);
            heart.addEventListener('animationend', () => heart.remove());
        }

        async handleDoubleTap(x, y) {
            if (!this.app) return;
            const app = this.app;

            // 1. 点赞动画
            const heart = document.createElement('div');
            heart.className = 'heart-anim absolute pointer-events-none z-50';
            heart.style.cssText = `left:${x - 32}px;top:${y - 32}px;--rot:${Math.floor(Math.random() * 40) - 20}deg`;
            heart.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="#ef4444" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="drop-shadow-xl"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
            document.getElementById('app').appendChild(heart);
            heart.addEventListener('animationend', () => heart.remove());

            // 2. 自动标记收藏
            const currentVideo = app.state.videos[app.state.currentIndex];
            if (currentVideo && !currentVideo.UserData?.IsFavorite) {
                try {
                    const { server, token, userId } = app.config;
                    const res = await fetch(`${server}/emby/Users/${userId}/FavoriteItems/${currentVideo.Id}?api_key=${token}`, {
                        method: 'POST',
                        headers: app.getAuthHeaders(token)
                    });
                    if (res.ok) {
                        if (!currentVideo.UserData) currentVideo.UserData = {};
                        currentVideo.UserData.IsFavorite = true;
                        app.state.favorites.add(String(currentVideo.Id));

                        const favBtn = document.getElementById('favoriteBtn');
                        if (favBtn) {
                            favBtn.innerHTML = `<div class="w-12 h-12 flex items-center justify-center"><i data-lucide="heart" class="text-secondary fill-secondary w-6 h-6 drop-shadow-md"></i></div>`;
                            if (window.lucide) lucide.createIcons({ root: favBtn });
                        }
                        app.showToast('❤️ 已收藏');
                    }
                } catch (e) {
                    console.error('Double tap favorite failed:', e);
                }
            }
        }

        // ══════════════════════════════════════════════════════════════
        // 4. 全平台移动端/浏览器返回手势与历史状态机 (HistoryNavigator)
        // ══════════════════════════════════════════════════════════════

        bindHistory() {
            if (typeof window === 'undefined' || !window.history || !window.history.pushState) return;
            const app = this.app;
            if (!app) return;

            this._isHandlingPop = false;
            this._lastExitPress = 0;   // v1.2.4：主播放界面「连按两次才退出」的计时

            // 根视图历史帧标定：确立以 grid（宫格模式）为底层基准
            const currentMode = app.state?.viewMode || 'stream';
            if (!window.history.state || !window.history.state.embyx) {
                window.history.replaceState({ embyx: true, layer: 'grid' }, '');
                // 若以 stream（全屏瀑布流播放）首屏启动，立即压入 stream 帧，确保初次侧滑返回退回 grid 而非直接退出网页
                if (currentMode === 'stream') {
                    window.history.pushState({ embyx: true, layer: 'stream' }, '');
                }
            }

            window.addEventListener('popstate', (e) => {
                this.handlePopState(e);
            });
        }

        pushLayer(layer, detail = {}) {
            if (this._isHandlingPop || typeof window === 'undefined' || !window.history?.pushState) return;
            const curState = window.history.state;
            // 避免连续推入重复同类型层级
            if (curState && curState.embyx && curState.layer === layer) {
                if (layer === 'modal' && curState.id === detail.id) return;
                if (layer !== 'modal' && layer !== 'folder') return;
            }
            window.history.pushState({ embyx: true, layer, ...detail }, '');
        }

        hasHistoryLayer(layer, id = null) {
            const state = window.history?.state;
            if (!state || !state.embyx) return false;
            if (state.layer !== layer) return false;
            if (id != null && state.id !== id) return false;
            return true;
        }

        /**
         * v1.2.4：统一的返回行为（原生返回键 window.__embyxBack 与浏览器 popstate 共用）。
         * 逐层返回：弹窗 → 搜索 → 演员/标签筛选 → 文件夹逐层 → 宫格 → 主播放界面；
         * 只有已经停在主播放界面时，2 秒内连续按两次才允许退出（返回 false）。
         * 返回 true = 前端已消费；false = 允许宿主退回桌面。
         */
        handleBack() {
            const app = this.app;
            if (!app) return false;
            const consumed = () => { this._lastExitPress = 0; return true; };

            // 1. 最上层弹窗 / 设置页 / 图标区域浮层
            const openModalId = typeof app.getActiveModalId === 'function' ? app.getActiveModalId() : null;
            if (openModalId) {
                app.toggleModal(openModalId, false);
                return consumed();
            }
            // 1.5 v1.2.15 第 1 项：宫格多选模式下，返回键先退出选择态
            if (app.grid && typeof app.grid.exitSelMode === 'function' && app.grid.exitSelMode()) {
                return consumed();
            }
            // 2. 搜索态
            if (app.state && app.state.searchTerm && app.grid && typeof app.grid.restorePreSearch === 'function') {
                app.grid.restorePreSearch();
                return consumed();
            }
            // 3. 演员 / 标签筛选态
            if (app.state && (app.state.currentPerson || app.state.isFilteredByTag)
                && typeof app.resetFilters === 'function') {
                app.resetFilters();
                return consumed();
            }
            // 4. v1.2.3 临时文件夹视图：沿预填的祖先链一层层往上退，最后才回主播放界面
            const nav = window.EmbyProFolderNav;
            // v1.3.2：在文件夹里点了别的视频起播后，返回键先回文件夹列表（不退出文件夹），
            // 再逐层往上退；否则会误用下面的 backToPlaying/popFolder 直接跳回原视频。
            if (nav && typeof nav.isFolderOpen === 'function' && nav.isFolderOpen()
                && app.state && app.state.viewMode === 'stream'
                && typeof nav.backToFolderGrid === 'function') {
                nav.backToFolderGrid();
                return consumed();
            }
            // v1.2.5 第 5 项：长按头像进入「当时视频所在文件夹」时，手势返回一次性
            // 回到正在播放的视频（底部文件夹按钮进入的视图仍保持逐层返回）。
            if (nav && typeof nav.isLongPressFolder === 'function' && nav.isLongPressFolder()
                && typeof nav.backToPlaying === 'function') {
                nav.backToPlaying();
                return consumed();
            }
            if (nav && typeof nav.isFolderOpen === 'function' && nav.isFolderOpen()
                && app.drama && typeof app.drama.popFolder === 'function') {
                app.drama.popFolder();
                return consumed();
            }
            // 5. 短剧 / 分季文件夹下钻
            if (app.drama && app.drama.folderStack && app.drama.folderStack.length > 0) {
                app.drama.popFolder();
                return consumed();
            }
            // 6. 宫格（非文件夹）→ 回主播放界面
            if (app.state && app.state.viewMode === 'grid') {
                try { app.toggleViewMode(); } catch (err) { }
                return consumed();
            }
            // 7. 主播放界面：连续两次（2 秒内）才退回桌面
            const now = Date.now();
            if (this._lastExitPress && now - this._lastExitPress <= 2000) {
                this._lastExitPress = 0;
                return false;
            }
            this._lastExitPress = now;
            if (typeof app.showToast === 'function') app.showToast('再按一次返回键退出');
            return true;
        }

        handlePopState(e) {
            const app = this.app;
            if (!app) return false;

            this._isHandlingPop = true;
            try {
                const consumed = this.handleBack();
                if (consumed) {
                    // popstate 已经弹出一帧历史，补回去，避免后续手势把整个网页退掉
                    try { window.history.pushState({ embyx: true, layer: 'app' }, ''); } catch (err) { }
                }
                return consumed;
            } catch (err) {
                console.warn('[InputManager] handlePopState error:', err);
                return false;
            } finally {
                this._isHandlingPop = false;
            }
        }

        /**
         * Android 原生侧滑/返回按键桥接入口
         * 返回 true 表示由前端消费了返回行为；返回 false 表示已处于根界面
         */
        static handleNativeBack() {
            if (window.app && window.app.input && typeof window.app.input.handleBack === 'function') {
                return window.app.input.handleBack();
            }
            return false;
        }
    }

    // 同时挂载 InputManager 与兼容别名 SpatialNavigator，确保其它页面引用零破坏
    window.InputManager = InputManager;
    window.SpatialNavigator = InputManager;

    /**
     * v1.2.4：Android MainActivity.onBackPressed() 的前端桥接。
     * 原生 evaluateJavascript 调用本函数，只有返回 'exit' 才会 finish()；
     * 此前前端从未定义 __embyxBack，导致每次返回都直接退回桌面。
     */
    window.__embyxBack = function () {
        const input = window.app && window.app.input;
        if (!input || typeof input.handleBack !== 'function') return 'exit';
        const prev = input._isHandlingPop;
        // 抑制 toggleModal / popFolder 内部再次触发 window.history.back()
        input._isHandlingPop = true;
        let consumed = false;
        try { consumed = input.handleBack(); }
        catch (err) { consumed = false; }
        finally { input._isHandlingPop = prev; }
        return consumed ? 'handled' : 'exit';
    };
})(window);
