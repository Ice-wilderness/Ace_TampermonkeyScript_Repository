// ==UserScript==
// @name         Bilibili视频观看历史记录
// @namespace    Bilibili-video-History
// @version      3.0.3
// @description  记录并提示Bilibili已观看或已访问但未观看视频记录。支持进度记忆、分级高亮、记录迁移及导入导出。
// @author       Ice_wilderness
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/v/*
// @match        https://t.bilibili.com/*
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com
// @match        https://www.bilibili.com/?*
// @match        https://www.bilibili.com/account/history*
// @match        https://www.bilibili.com/history*
// @match        https://www.bilibili.com/watchlater/*
// @match        https://search.bilibili.com/*
// @match        https://www.bilibili.com/medialist/play/*
// @match        https://www.bilibili.com/list/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_info
// @run-at       document-end
// @license      MIT
// @downloadURL https://update.greasyfork.org/scripts/574216/Bilibili%E8%A7%86%E9%A2%91%E8%A7%82%E7%9C%8B%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95.user.js
// @updateURL https://update.greasyfork.org/scripts/574216/Bilibili%E8%A7%86%E9%A2%91%E8%A7%82%E7%9C%8B%E5%8E%86%E5%8F%B2%E8%AE%B0%E5%BD%95.meta.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        showProgressBar: true,
        debug: true
    };

    const RECORD_STATUS = {
        WATCHED: '已观看',
        VISITED: '已访问',
        DELETED: '已删除'
    };

    const BV_REGEX = /((BV|bv)[A-Za-z0-9]+(?:\?p=[0-9]+)?)|(av\d+(?:\?p=[0-9]+)?)/;

    // --- 样式注入 ---
    GM_addStyle(`
        .bvh-tag { position: absolute; margin: .5em!important; padding: 0 5px!important; height: 20px; line-height: 20px; border-radius: 4px; color: #fff; font-style: normal; font-size: 12px; background-color: rgba(122, 134, 234, 0.7); z-index: 108; pointer-events: none; }
        .bvh-tag-visited { background-color: rgba(158, 158, 158, 0.9) !important; }
        .bvh-tag-low { background-color: rgba(255, 152, 0, 0.9) !important; }
        .bvh-tag-mid { background-color: rgba(66, 133, 244, 0.9) !important; }
        .bvh-tag-high { background-color: rgba(76, 175, 80, 0.9) !important; }
        .bvh-tag-small { margin: .2em!important; padding: 0 4px!important; height: 18px; line-height: 18px; font-size: 10px; }
        .bvh-tag-big { height: 22px; line-height: 23px; font-size: 14px; }
        .bvh-progress-bar { background: linear-gradient(90deg, rgba(122, 134, 234, 0.9), rgba(156, 166, 255, 0.7)); z-index: 108; position: absolute; height: 4px; bottom: 0px; border-bottom-left-radius: inherit; border-bottom-right-radius: inherit; pointer-events: none; }
        .bvh-toast-container { position: fixed; bottom: 20px; left: 20px; z-index: 99999; display: flex; flex-direction: column; gap: 10px; pointer-events: none; }
        .bvh-toast { background-color: #333; color: #fff; padding: 10px 20px; border-radius: 4px; font-size: 14px; opacity: 0; transition: opacity 0.3s; box-shadow: 0 2px 8px rgba(0,0,0,0.2); pointer-events: auto; }
        .bvh-toast.show { opacity: 1; }
        .bvh-toast.success { border-left: 4px solid #4CAF50; }
        .bvh-toast.error { border-left: 4px solid #F44336; }
        .bvh-view-panel { position: fixed; text-align: center; border-left: 6px solid #2196F3; background-color: #aeffff; font-family: 'Segoe UI', sans-serif; font-weight: 600; padding: 5px; z-index: 9999; cursor: move; color: #000; box-shadow: 0 2px 8px rgba(0,0,0,0.2); border-radius: 0 4px 4px 0; user-select: none; }
    `);

    // --- 工具类 ---
    const Utils = {
        log: (...args) => { if (CONFIG.debug) console.log('[BvH]', ...args); },
        error: (...args) => console.error('[BvH Error]', ...args),
        formatTime: () => {
            const d = new Date();
            const pad = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        },
        timeToSeconds: (timeStr) => {
            if (!timeStr) return 0;
            return timeStr.split(":").reverse().reduce((total, item, index) => total + parseInt(item || 0) * Math.pow(60, index), 0);
        },
        debounce: (fn, delay) => {
            let timer;
            return function (...args) {
                if (timer) clearTimeout(timer);
                timer = setTimeout(() => fn.apply(this, args), delay);
            };
        },
        throttle: (fn, interval) => {
            let lastRun = 0;
            return function (...args) {
                const now = Date.now();
                if (now - lastRun >= interval) {
                    lastRun = now;
                    fn.apply(this, args);
                }
            };
        }
    };

    // --- 数据层 (v3 分片存储架构) ---
    const SHARD_COUNT = 64;
    const STATUS_MAP = { 0: '已访问', 1: '已观看', 2: '已删除' };
    const STATUS_REVERSE = { '已访问': 0, '已观看': 1, '已删除': 2 };

    const StorageManager = {
        _shardCache: new Map(),       // shardId → { data: {...}, dirty: false }
        _bvBaseIndex: new Map(),      // bvBase → Set<fullKey>
        _allKeysCache: null,
        _changeCallbacks: [],
        _migrationCount: 0,

        onDataChange: (cb) => StorageManager._changeCallbacks.push(cb),
        _notifyChange: Utils.debounce(() => {
            StorageManager._changeCallbacks.forEach(cb => cb());
        }, 500),

        // --- 哈希函数 (FNV-1a) ---
        _getShardId: (bvId) => {
            let hash = 0x811c9dc5;
            for (let i = 0; i < bvId.length; i++) {
                hash ^= bvId.charCodeAt(i);
                hash = (hash * 0x01000193) | 0;
            }
            return Math.abs(hash) % SHARD_COUNT;
        },

        // --- 分片加载/保存 ---
        _loadShard: (shardId) => {
            if (StorageManager._shardCache.has(shardId)) {
                return StorageManager._shardCache.get(shardId);
            }
            const data = GM_getValue(`bvh_shard_${shardId}`, {});
            const shard = { data, dirty: false };
            StorageManager._shardCache.set(shardId, shard);
            // 加载时增量构建 BV 基础 ID 索引
            for (const key of Object.keys(data)) {
                StorageManager._indexKey(key);
            }
            return shard;
        },

        _flushShard: (shardId) => {
            const shard = StorageManager._shardCache.get(shardId);
            if (shard && shard.dirty) {
                GM_setValue(`bvh_shard_${shardId}`, shard.data);
                shard.dirty = false;
            }
        },

        _ensureAllShardsLoaded: () => {
            for (let i = 0; i < SHARD_COUNT; i++) {
                StorageManager._loadShard(i);
            }
        },

        // --- 索引管理 ---
        _indexKey: (key) => {
            const match = key.match(BV_REGEX);
            if (match) {
                const base = match[0].replace(/\?p=[0-9]+/, '');
                let set = StorageManager._bvBaseIndex.get(base);
                if (!set) { set = new Set(); StorageManager._bvBaseIndex.set(base, set); }
                set.add(key);
            }
        },

        _removeFromIndex: (key) => {
            const match = key.match(BV_REGEX);
            if (match) {
                const base = match[0].replace(/\?p=[0-9]+/, '');
                const set = StorageManager._bvBaseIndex.get(base);
                if (set) { set.delete(key); if (set.size === 0) StorageManager._bvBaseIndex.delete(base); }
            }
        },

        // --- 格式转换 ---
        _compact: (record) => {
            // 已经是 v3 紧凑格式
            if (typeof record.s === 'number') return record;

            // v1 数组格式: [status, currentTime, percent, savedAt, title]
            if (Array.isArray(record)) {
                const [status, currentTime, percent, savedAt, title] = record;
                return {
                    s: STATUS_REVERSE[status] ?? 0,
                    t: currentTime || '',
                    p: parseInt(percent) || 0,
                    a: savedAt ? Math.floor(new Date(savedAt).getTime() / 1000) : Math.floor(Date.now() / 1000),
                    n: title || ''
                };
            }

            // v2 对象格式: { v:2, status, currentTime, percent, savedAt, title }
            return {
                s: STATUS_REVERSE[record.status] ?? 0,
                t: record.currentTime || '',
                p: parseInt(record.percent) || 0,
                a: record.savedAt
                    ? Math.floor(new Date(record.savedAt).getTime() / 1000)
                    : Math.floor(Date.now() / 1000),
                n: record.title || ''
            };
        },

        _expand: (compact) => {
            const d = new Date(compact.a * 1000);
            const pad = n => String(n).padStart(2, '0');
            const savedAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            return {
                v: 3,
                status: STATUS_MAP[compact.s] || '已访问',
                currentTime: compact.t || '',
                percent: compact.p ? compact.p + '%' : '',
                savedAt: savedAt,
                title: compact.n || ''
            };
        },

        // --- 核心 API（对外接口与 v2 完全兼容）---
        getRecord: (id) => {
            if (!id) return null;
            const shardId = StorageManager._getShardId(id);
            const shard = StorageManager._loadShard(shardId);
            const compact = shard.data[id];
            if (!compact) return null;
            return StorageManager._expand(compact);
        },

        saveRecord: (id, record, notify = true) => {
            if (!id) return;
            const shardId = StorageManager._getShardId(id);
            const shard = StorageManager._loadShard(shardId);
            shard.data[id] = StorageManager._compact(record);
            shard.dirty = true;
            StorageManager._flushShard(shardId);
            StorageManager._indexKey(id);
            StorageManager._allKeysCache = null;
            if (notify) StorageManager._notifyChange();
        },

        deleteRecord: (id, notify = true) => {
            if (!id) return;
            const shardId = StorageManager._getShardId(id);
            const shard = StorageManager._loadShard(shardId);
            delete shard.data[id];
            shard.dirty = true;
            StorageManager._flushShard(shardId);
            StorageManager._removeFromIndex(id);
            StorageManager._allKeysCache = null;
            if (notify) StorageManager._notifyChange();
        },

        getAllKeys: () => {
            if (StorageManager._allKeysCache) return StorageManager._allKeysCache;
            StorageManager._ensureAllShardsLoaded();
            const keys = [];
            for (const [, shard] of StorageManager._shardCache) {
                keys.push(...Object.keys(shard.data));
            }
            StorageManager._allKeysCache = keys;
            return keys;
        },

        getRelatedKeys: (bvBase) => {
            StorageManager._ensureAllShardsLoaded();
            const set = StorageManager._bvBaseIndex.get(bvBase);
            return set ? Array.from(set) : [];
        },

        // --- localStorage 备份恢复 ---
        restoreFromLocalStorage: () => {
            const keysToRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('BvH_backup_')) {
                    try {
                        const tempValue = JSON.parse(localStorage.getItem(key));
                        if (tempValue && tempValue.key && tempValue.value) {
                            StorageManager.saveRecord(tempValue.key, tempValue.value, false);
                        }
                    } catch (e) { }
                    keysToRemove.push(key);
                }
            }
            keysToRemove.forEach(k => localStorage.removeItem(k));
        },

        // --- 数据迁移 (v1/v2 → v3 分片) ---
        migrateIfNeeded: () => {
            const meta = GM_getValue('bvh_meta');
            if (meta && meta.version === 3) return; // 已完成迁移

            const allKeys = GM_listValues();
            const bvKeys = allKeys.filter(k => BV_REGEX.test(k));

            if (bvKeys.length === 0) {
                // 全新安装，直接标记为 v3
                GM_setValue('bvh_meta', { version: 3, shardCount: SHARD_COUNT, totalRecords: 0, migratedAt: Date.now() });
                return;
            }

            Utils.log(`开始迁移 ${bvKeys.length} 条记录到分片存储...`);

            // 初始化空分片
            const shards = new Array(SHARD_COUNT).fill(null).map(() => ({}));
            let migratedCount = 0;

            for (const key of bvKeys) {
                const oldRecord = GM_getValue(key);
                if (!oldRecord) continue;

                const compact = StorageManager._compact(oldRecord);
                const shardId = StorageManager._getShardId(key);
                shards[shardId][key] = compact;
                migratedCount++;
            }

            // 批量写入分片（合并已有分片数据，防止覆盖其他来源的分片数据）
            for (let i = 0; i < SHARD_COUNT; i++) {
                if (Object.keys(shards[i]).length > 0) {
                    const existing = GM_getValue(`bvh_shard_${i}`, {});
                    GM_setValue(`bvh_shard_${i}`, Object.assign(existing, shards[i]));
                }
            }

            // 写入元数据标记
            GM_setValue('bvh_meta', {
                version: 3,
                shardCount: SHARD_COUNT,
                totalRecords: migratedCount,
                migratedAt: Date.now()
            });

            // 删除旧键（最后执行，崩溃安全：即使失败，重启后会重新迁移）
            for (const key of bvKeys) {
                GM_deleteValue(key);
            }

            Utils.log(`迁移完成：${migratedCount} 条记录`);
            StorageManager._migrationCount = migratedCount;
        },

        // --- 多标签页切换时刷新缓存 ---
        invalidateCache: () => {
            StorageManager._shardCache.clear();
            StorageManager._bvBaseIndex.clear();
            StorageManager._allKeysCache = null;
        }
    };

    // --- UI层 ---
    const UIComponent = {
        toastContainer: null,
        initToastContainer: () => {
            if (!UIComponent.toastContainer) {
                UIComponent.toastContainer = document.createElement('div');
                UIComponent.toastContainer.className = 'bvh-toast-container';
                document.body.appendChild(UIComponent.toastContainer);
            }
        },
        toast: (msg, type = 'success', duration = 3000) => {
            UIComponent.initToastContainer();
            const el = document.createElement('div');
            el.className = `bvh-toast ${type}`;
            el.innerText = msg;
            UIComponent.toastContainer.appendChild(el);
            setTimeout(() => el.classList.add('show'), 10);
            setTimeout(() => {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            }, duration);
            return el;
        },
        toastUndo: (msg, duration = 5000, onUndo) => {
            const el = UIComponent.toast(msg, 'success', duration);
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                onUndo();
                el.classList.remove('show');
                setTimeout(() => el.remove(), 300);
            });
        },
        createTag: (text, title, className = 'bvh-tag') => {
            const el = document.createElement('div');
            el.className = className;
            el.title = title;
            el.innerText = text;
            return el;
        },
        createProgressBar: (percent) => {
            const el = document.createElement('div');
            el.className = 'bvh-progress-bar';
            let width = parseFloat(percent);
            if (isNaN(width) || width < 3) width = 3;
            el.style.width = `${width}%`;
            return el;
        },
        showViewPanel: (record, bvId) => {
            const existing = document.getElementById('bvh-view-panel');
            if (existing) existing.remove();

            if (!record) return;

            const el = document.createElement('div');
            el.id = 'bvh-view-panel';
            el.className = 'bvh-view-panel';

            // 恢复上次保存的位置
            const savedPos = GM_getValue('bvh_panel_position');
            if (savedPos) {
                el.style.left = savedPos.left;
                el.style.top = savedPos.top;
            } else {
                el.style.left = '15px';
                el.style.bottom = '15px';
            }

            let titleText = bvId;
            if (record.currentTime) {
                titleText += '\n左键单击跳转视频播放进度\n右键单击删除视频记录信息\n拖拽以移动面板';
            } else {
                titleText += '\n右键单击删除视频记录信息\n拖拽以移动面板';
            }
            el.title = titleText;

            const p1 = document.createElement('p');
            p1.style.cssText = "margin:5px 10px 5px 10px; pointer-events:none;";
            let currentStr = record.currentTime ? ` \n${record.currentTime}(${record.percent})` : '';
            p1.innerText = `${record.status}${currentStr}`;

            const p2 = document.createElement('p');
            p2.style.cssText = "margin:0 10px 5px 10px; pointer-events:none;";
            const timeParts = record.savedAt ? record.savedAt.split(" ") : ["", ""];
            p2.innerText = `${timeParts[0]}\n${timeParts[1] || ''}`;

            el.appendChild(p1);
            el.appendChild(p2);

            // 拖拽与点击事件处理
            el.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return; // 仅左键触发
                let isDragging = false;
                const startX = e.clientX;
                const startY = e.clientY;
                const rect = el.getBoundingClientRect();
                const offsetX = e.clientX - rect.left;
                const offsetY = e.clientY - rect.top;

                const onMouseMove = (moveEvent) => {
                    if (Math.abs(moveEvent.clientX - startX) > 5 || Math.abs(moveEvent.clientY - startY) > 5) {
                        isDragging = true;
                    }
                    if (isDragging) {
                        el.style.left = `${moveEvent.clientX - offsetX}px`;
                        el.style.bottom = 'auto'; // 取消 bottom 以免互相冲突
                        el.style.top = `${moveEvent.clientY - offsetY}px`;
                    }
                };

                const onMouseUp = (upEvent) => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    if (isDragging) {
                        GM_setValue('bvh_panel_position', {
                            left: el.style.left,
                            top: el.style.top
                        });
                    } else {
                        // 触发点击跳转逻辑
                        if (record.currentTime) {
                            const video = document.querySelector("#bilibili-player video, bwp-video");
                            if (video) {
                                video.currentTime = Utils.timeToSeconds(record.currentTime);
                                video.play();
                                UIComponent.toast(`已跳转到 ${record.currentTime}`, 'success', 2000);
                            }
                        }
                    }
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            // 右键删除带撤销
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const backup = StorageManager.getRecord(bvId);
                if (backup && backup.status !== RECORD_STATUS.DELETED) {
                    StorageManager.deleteRecord(bvId);
                    UIComponent.showViewPanel({ ...backup, status: RECORD_STATUS.DELETED, currentTime: '' }, bvId);

                    UIComponent.toastUndo('记录已删除，5秒内点击此处撤销', 5000, () => {
                        StorageManager.saveRecord(bvId, backup);
                        UIComponent.showViewPanel(backup, bvId);
                    });
                }
            });

            document.body.appendChild(el);
        },
        updateViewPanelProgress: (record) => {
            const panel = document.getElementById('bvh-view-panel');
            if (!panel || !record) return;

            const p1 = panel.querySelector('p:first-child');
            if (p1) {
                let currentStr = record.currentTime ? ` \n${record.currentTime}(${record.percent})` : '';
                p1.innerText = `${record.status}${currentStr}`;
            }
            const p2 = panel.querySelector('p:nth-child(2)');
            if (p2) {
                const timeParts = record.savedAt ? record.savedAt.split(" ") : ["", ""];
                p2.innerText = `${timeParts[0]}\n${timeParts[1] || ''}`;
            }
        }
    };

    // --- 播放器监控层 ---
    class VideoPlayerObserver {
        constructor() {
            this.bvId = null;
            this.videoEl = null;
            this.title = '';
            this.hasPlayed = false;
            this.stateInterval = null;
            this._lastKnownState = null; // 缓存最近一次有效进度，供 destroy 安全使用

            // 绑定 this 用于事件注册与移除
            this._onBeforeUnload = () => this.saveProgress(true);
            this._onPlay = () => {
                this.hasPlayed = true;
                this.saveProgressDebounced();
            };
            this._onTimeUpdate = () => {
                if (!this.hasPlayed && this.videoEl && this.videoEl.currentTime > 0) {
                    this.hasPlayed = true;
                }
                if (this.hasPlayed) {
                    this.saveProgressDebounced();
                }
            };
            this._onPause = () => {
                if (this.hasPlayed) {
                    this.saveProgress(true);
                }
            };

            this.saveProgressDebounced = Utils.throttle(this.saveProgress.bind(this), 5000);
        }

        init() {
            const getBvId = () => {
                // 合集页面: bvid 在 URL query 参数中
                const urlParams = new URLSearchParams(location.search);
                const queryBvid = urlParams.get('bvid');
                if (queryBvid && BV_REGEX.test(queryBvid)) return queryBvid;

                const match = location.href.match(BV_REGEX);
                if (match) return match[0];
                return window.__INITIAL_STATE__?.bvid;
            };

            this.bvId = getBvId();
            if (!this.bvId) {
                let retries = 0;
                this.stateInterval = setInterval(() => {
                    this.bvId = getBvId();
                    if (this.bvId) {
                        clearInterval(this.stateInterval);
                        this.setupRecord();
                    } else if (retries++ > 50) {
                        clearInterval(this.stateInterval);
                    }
                }, 200);
            } else {
                this.setupRecord();
            }
        }

        setupRecord() {
            this.bvId = this.bvId.replace(/\?p=1$/, "");
            const state = window.__INITIAL_STATE__;
            this.title = document.title || (state?.videoData?.title) || '';

            const record = StorageManager.getRecord(this.bvId);
            if (record) {
                UIComponent.showViewPanel(record, this.bvId);
            } else {
                StorageManager.saveRecord(this.bvId, {
                    v: 2,
                    status: RECORD_STATUS.VISITED,
                    currentTime: '',
                    percent: '',
                    savedAt: Utils.formatTime(),
                    title: this.title
                });
            }

            this.waitForVideo().then(video => {
                this.videoEl = video;
                this.bindEvents();
                Utils.log('Video element bound');
            }).catch(e => {
                Utils.error('Video element not found or timeout', e);
            });
        }

        waitForVideo(timeout = 10000) {
            return new Promise((resolve, reject) => {
                const getVid = () => document.querySelector("#bilibili-player video, bwp-video");
                let video = getVid();
                if (video) return resolve(video);

                const observer = new MutationObserver(() => {
                    video = getVid();
                    if (video) {
                        observer.disconnect();
                        resolve(video);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error("Timeout waiting for video element"));
                }, timeout);
            });
        }

        bindEvents() {
            if (!this.videoEl) return;
            this.videoEl.addEventListener('play', this._onPlay);
            this.videoEl.addEventListener('timeupdate', this._onTimeUpdate);
            this.videoEl.addEventListener('pause', this._onPause);
            window.addEventListener('beforeunload', this._onBeforeUnload);
        }

        saveProgress(force = false) {
            if (!this.hasPlayed || !this.bvId || !this.videoEl) return;
            if (!this.videoEl.duration) return;

            const current = this.videoEl.currentTime || 0;
            const duration = this.videoEl.duration || 1;

            const format = (sec) => {
                const h = Math.floor(sec / 3600);
                const m = Math.floor((sec % 3600) / 60);
                const s = Math.floor(sec % 60);
                const pad = v => String(v).padStart(2, '0');
                return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
            };

            const percent = Math.round((current / duration) * 100) + '%';
            const value = {
                v: 2,
                status: RECORD_STATUS.WATCHED,
                currentTime: format(current),
                percent: percent,
                savedAt: Utils.formatTime(),
                title: this.title
            };

            StorageManager.saveRecord(this.bvId, value);
            localStorage.setItem(`BvH_backup_${this.bvId}`, JSON.stringify({ key: this.bvId, value: value }));

            // 缓存最近一次有效进度
            this._lastKnownState = value;

            // 轻量更新 View Panel（不重建 DOM，避免闪烁）
            UIComponent.updateViewPanelProgress(value);
        }

        destroy() {
            // 使用缓存的进度数据保存，不再读取 video 元素（SPA 切换时 video 可能已加载新视频）
            if (this._lastKnownState && this.bvId) {
                StorageManager.saveRecord(this.bvId, this._lastKnownState);
            }

            window.removeEventListener('beforeunload', this._onBeforeUnload);
            if (this.videoEl) {
                this.videoEl.removeEventListener('play', this._onPlay);
                this.videoEl.removeEventListener('timeupdate', this._onTimeUpdate);
                this.videoEl.removeEventListener('pause', this._onPause);
            }
            if (this.stateInterval) {
                clearInterval(this.stateInterval);
            }
        }
    }

    // --- DOM监控与渲染层 ---
    class DOMWatcher {
        constructor() {
            this.intersectionObserver = null;
            this.mutationObserver = null;
            this.processedLinks = new WeakSet();
            this.visibleElements = new Set();
            this.scheduleFavoriteRefresh = Utils.debounce(() => this.refreshFavoriteCards(), 120);
            this.initIntersectionObserver();
            this.initMutationObserver();

            // 事件驱动而非定时盲扫
            StorageManager.onDataChange(() => {
                this.visibleElements.forEach(el => {
                    if (document.contains(el)) {
                        this.processLink(el);
                    } else {
                        this.visibleElements.delete(el);
                    }
                });
            });
        }

        initIntersectionObserver() {
            this.intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.visibleElements.add(entry.target);
                        this.processLink(entry.target);
                    } else {
                        this.visibleElements.delete(entry.target);
                    }
                });
            }, { rootMargin: '200px 0px' });
        }

        initMutationObserver() {
            this.mutationObserver = new MutationObserver((mutations) => {
                let addedLinks = [];
                let addedPlaylistItems = [];
                let shouldRefreshFavoriteCards = false;
                mutations.forEach(m => {
                    if (m.type === 'attributes') {
                        const target = m.target;
                        if (target.nodeType === Node.ELEMENT_NODE && target.closest('.favorite-panel-popover, #favorite-content-scroll, .header-fav-card')) {
                            shouldRefreshFavoriteCards = true;
                        }
                    }

                    if (m.type === 'childList') {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.matches && node.matches('.favorite-panel-popover, #favorite-content-scroll, .header-fav-card')) {
                                    shouldRefreshFavoriteCards = true;
                                } else if (node.querySelector && node.querySelector('.favorite-panel-popover, #favorite-content-scroll, .header-fav-card')) {
                                    shouldRefreshFavoriteCards = true;
                                }

                                if (node.tagName === 'A' && node.href) {
                                    addedLinks.push(node);
                                }
                                if (node.querySelectorAll) {
                                    const links = node.querySelectorAll('a[href]');
                                    links.forEach(link => addedLinks.push(link));
                                    // 合集播放列表项
                                    const items = node.querySelectorAll('.action-list-item-wrap[data-key]');
                                    items.forEach(item => addedPlaylistItems.push(item));
                                }
                                // 节点自身是合集列表项
                                if (node.matches && node.matches('.action-list-item-wrap[data-key]')) {
                                    addedPlaylistItems.push(node);
                                }
                            }
                        });
                    }
                });
                addedLinks.forEach(link => this.observeLink(link));
                addedPlaylistItems.forEach(item => this.observePlaylistItem(item));
                if (shouldRefreshFavoriteCards) {
                    this.scheduleFavoriteRefresh();
                }
            });
            this.mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['href', 'data-bsb-bvid', 'class', 'src', 'srcset', 'title']
            });
        }

        observeLink(el) {
            if (!this.processedLinks.has(el) && this.isValidLink(el)) {
                this.processedLinks.add(el);
                this.intersectionObserver.observe(el);
            }
        }

        scanExistingLinks() {
            const links = document.querySelectorAll('a[href]');
            links.forEach(link => this.observeLink(link));
            // 合集播放列表项
            const playlistItems = document.querySelectorAll('.action-list-item-wrap[data-key]');
            playlistItems.forEach(item => this.observePlaylistItem(item));
            this.refreshFavoriteCards();
        }

        // 强制刷新所有播放列表项标签（绕过 processedLinks 检查）
        refreshPlaylistItems() {
            const items = document.querySelectorAll('.action-list-item-wrap[data-key]');
            items.forEach(item => {
                // 确保新节点也被纳入观察
                this.observePlaylistItem(item);
                // 直接重新处理，不依赖 IntersectionObserver 回调
                this.processPlaylistItem(item);
            });
        }

        // 收藏夹弹窗会复用卡片节点并改写 href / 图片 / 标题，必须绕过 WeakSet 直接刷新
        refreshFavoriteCards() {
            const cards = document.querySelectorAll('.favorite-panel-popover .header-fav-card, #favorite-content-scroll .header-fav-card');
            cards.forEach(card => {
                if (card.href) {
                    this.observeLink(card);
                    this.processLink(card);
                }
            });
        }

        getVideoKeyFromLink(el) {
            if (!el || !el.href) return '';
            try {
                const url = new URL(el.href, location.href);
                const bvid = url.searchParams.get('bvid');
                if (bvid && BV_REGEX.test(bvid)) {
                    return bvid.replace(/\?p=1$/, '');
                }
            } catch (e) {
                // 旧浏览器或异常 URL 时回退到正则提取
            }

            const hrefMatch = el.href.match(BV_REGEX);
            return hrefMatch ? hrefMatch[0].replace(/\?p=1$/, '') : '';
        }

        removeExistingMark(el) {
            const existingTags = el.querySelectorAll('.bvh-tag, .bvh-tag-small, .bvh-tag-big');
            existingTags.forEach(tag => tag.remove());
            const existingBars = el.querySelectorAll('.bvh-progress-bar');
            existingBars.forEach(bar => bar.remove());
        }

        isValidLink(el) {
            const href = el.href;
            if (!href || !this.getVideoKeyFromLink(el)) return false;

            // 排除头像链接（头像子元素可能尚未渲染，需多重判断）
            if (el.querySelector('.bili-avatar')) return false;
            if (el.classList.contains('header-dynamic-avatar')) return false;
            if (el.closest('.bili-avatar, .header-dynamic-avatar')) return false;
            // 排除指向用户空间 dynamic 的链接（头像/用户名链接）
            if (/space\.bilibili\.com\/\d+\/dynamic/.test(href)) return false;

            // 首页右上角收藏夹弹窗卡片
            if (el.classList.contains('header-fav-card')) return true;

            // 直接包含封面图的链接
            if (el.querySelector('img') || el.querySelector('picture') || el.querySelector('.bili-dyn-card-video__cover .bili-awesome-img')) {
                return true;
            }

            // 视频页右侧推荐 / 各种卡片容器内的链接（图片可能在 <a> 外部或懒加载）
            if (el.closest('.video-page-card-small, .video-page-card, .bili-video-card, .video-card, .card-box, .rcmd-list, .next-play, .rec-list')) {
                return true;
            }

            // 常见的卡片链接 class
            if (el.classList.contains('card-box') || el.classList.contains('bili-video-card__image--wrap')) {
                return true;
            }

            return false;
        }

        // --- 合集播放列表项处理 ---
        observePlaylistItem(el) {
            if (!this.processedLinks.has(el)) {
                const dataKey = el.getAttribute('data-key');
                if (dataKey && BV_REGEX.test(dataKey)) {
                    this.processedLinks.add(el);
                    this.intersectionObserver.observe(el);
                }
            }
        }

        processPlaylistItem(el) {
            const bv = el.getAttribute('data-key');
            if (!bv || !BV_REGEX.test(bv)) return;

            const bvBase = bv.replace(/\?p=[0-9]+/, '');
            let record = StorageManager.getRecord(bv);
            if (!record) {
                const relatedKeys = StorageManager.getRelatedKeys(bvBase);
                if (relatedKeys.length > 0) {
                    record = StorageManager.getRecord(relatedKeys[0]);
                }
            }
            if (!record) return;

            const tagText = `${record.status}${record.percent || ''}`;
            const tagTitle = record.savedAt || '';

            const existingTag = el.querySelector('.bvh-tag');
            if (existingTag) {
                if (existingTag.innerText === tagText) return;
                existingTag.remove();
                const existingBar = el.querySelector('.bvh-progress-bar');
                if (existingBar) existingBar.remove();
            }

            // 精确选择封面图，避免误命中 playing gif 等其他图片
            const img = el.querySelector('.cover-img img, .cover img');
            if (!img) {
                if (!el._bvhRetryCount) {
                    el._bvhRetryCount = 1;
                    setTimeout(() => this.processPlaylistItem(el), 800);
                } else if (el._bvhRetryCount < 3) {
                    el._bvhRetryCount++;
                    setTimeout(() => this.processPlaylistItem(el), 800);
                }
                return;
            }

            let tagColorClass = 'bvh-tag-visited';
            if (record.status === RECORD_STATUS.WATCHED && record.percent) {
                const p = parseInt(record.percent);
                if (!isNaN(p)) {
                    if (p < 30) tagColorClass = 'bvh-tag-low';
                    else if (p <= 80) tagColorClass = 'bvh-tag-mid';
                    else tagColorClass = 'bvh-tag-high';
                }
            }

            const tagEl = UIComponent.createTag(tagText, tagTitle, `bvh-tag ${tagColorClass} bvh-tag-small`);
            img.parentNode.insertBefore(tagEl, img);

            if (CONFIG.showProgressBar && record.percent) {
                const barEl = UIComponent.createProgressBar(record.percent);
                img.parentNode.insertBefore(barEl, img);
            }
        }

        processLink(el) {
            // 合集播放列表项走专用处理（它们是 div 而非 a）
            if (el.classList && el.classList.contains('action-list-item-wrap') && el.hasAttribute('data-key')) {
                return this.processPlaylistItem(el);
            }

            let bv = this.getVideoKeyFromLink(el);
            if (!bv) return;
            let bvBase = bv.replace(/\?p=[0-9]+/, "");
            const existingVideoKey = el._bvhLastVideoKey;
            const isSameVideoKey = existingVideoKey === bv;

            let record = StorageManager.getRecord(bv);
            let multiRecords = [];

            if (!record) {
                const relatedKeys = StorageManager.getRelatedKeys(bvBase);
                if (relatedKeys.length > 0) {
                    record = StorageManager.getRecord(relatedKeys[0]);
                    multiRecords = relatedKeys;
                }
            } else {
                multiRecords = StorageManager.getRelatedKeys(bvBase);
            }

            if (!record) {
                if (!isSameVideoKey || el.querySelector('.bvh-tag, .bvh-tag-small, .bvh-tag-big, .bvh-progress-bar')) {
                    this.removeExistingMark(el);
                }
                el._bvhLastVideoKey = bv;
                return;
            }

            const isMulti = multiRecords.length > 1;
            const tagText = isMulti ? "已记录 多P" : `${record.status}${record.percent || ''}`;

            let tagTitle = record.savedAt || "";
            if (isMulti) {
                tagTitle = "";
                multiRecords.forEach(k => {
                    const v = StorageManager.getRecord(k);
                    if (v) {
                        const pMatch = k.match(/\?p=([0-9]+)/);
                        const pStr = pMatch ? `P${pMatch[1]}` : 'P1';
                        tagTitle += `${v.savedAt} ${pStr} ${v.status}${v.percent || ''}\n`;
                    }
                });
                tagTitle = tagTitle.trim();
            }

            const existingTag = el.querySelector('.bvh-tag, .bvh-tag-small, .bvh-tag-big');
            if (existingTag) {
                if (isSameVideoKey && existingTag.innerText === tagText) return;
                this.removeExistingMark(el);
            }

            let img = el.querySelector('img') || el.querySelector('picture');
            let isSmall = false;

            if (!img) {
                img = el.querySelector('.bili-dyn-card-video__cover .bili-awesome-img');
            }

            // 图片不在 <a> 内部时，向上查找最近的卡片容器中的封面图
            if (!img) {
                const card = el.closest('.video-page-card-small, .video-page-card, .bili-video-card, .video-card, .card-box');
                if (card) {
                    img = card.querySelector('img') || card.querySelector('picture') || card.querySelector('.b-img img');
                }
            }

            if (!img) {
                // 图片可能尚未懒加载完成，安排一次重试
                if (!el._bvhRetryCount) {
                    el._bvhRetryCount = 1;
                    setTimeout(() => this.processLink(el), 800);
                } else if (el._bvhRetryCount < 3) {
                    el._bvhRetryCount++;
                    setTimeout(() => this.processLink(el), 800);
                }
                return;
            }

            // 确保标签不会注入到头像图片上
            if (img.closest('.bili-avatar, .header-dynamic-avatar')) return;

            if (img) {
                const width = img.width || img.getBoundingClientRect().width;
                if (width > 0 && width < 83) isSmall = true;
            }

            let tagColorClass = 'bvh-tag-visited';
            if (isMulti) {
                // 多P统一使用蓝色 (方案A)
                tagColorClass = 'bvh-tag-mid';
            } else if (record.status === RECORD_STATUS.WATCHED && record.percent) {
                const p = parseInt(record.percent);
                if (!isNaN(p)) {
                    if (p < 30) tagColorClass = 'bvh-tag-low';
                    else if (p <= 80) tagColorClass = 'bvh-tag-mid';
                    else tagColorClass = 'bvh-tag-high';
                }
            }

            const tagEl = UIComponent.createTag(tagText, tagTitle, `bvh-tag ${tagColorClass} ${isSmall ? 'bvh-tag-small' : ''}`);
            img.parentNode.insertBefore(tagEl, img);
            el._bvhLastVideoKey = bv;

            if (CONFIG.showProgressBar && record.percent && !isMulti) {
                const barEl = UIComponent.createProgressBar(record.percent);
                const statsNode = el.querySelector('.bili-video-card__stats');
                if (statsNode && el.children.length > 0) {
                    el.children[0].insertBefore(barEl, el.children[0].firstChild);
                } else {
                    img.parentNode.insertBefore(barEl, img);
                }
            }
        }
    }

    // --- 核心调度层 ---
    class AppController {
        constructor() {
            this.currentUrl = location.href;
            this.playerObserver = null;
            this.domWatcher = null;
        }

        start() {
            Utils.log('Script started v3.0.0');

            // 数据迁移（v1/v2 → v3 分片，仅首次执行）
            StorageManager.migrateIfNeeded();

            this.initMenuCommands();
            this.checkFirstRun();

            // 显示迁移完成通知（在 UI 初始化之后）
            if (StorageManager._migrationCount > 0) {
                UIComponent.toast(`数据迁移完成：${StorageManager._migrationCount} 条记录已优化为分片存储`, 'success', 5000);
            }

            StorageManager.restoreFromLocalStorage();
            this.domWatcher = new DOMWatcher();
            this.domWatcher.scanExistingLinks();

            this.checkAndInitVideoPage();
            this.hijackRouter();

            // 标签页切回时刷新缓存（从其他标签页观看视频后返回列表页）
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    StorageManager.invalidateCache();
                    StorageManager._notifyChange();
                }
            });
        }

        checkFirstRun() {
            const currentVersion = typeof GM_info !== 'undefined' ? (GM_info.script?.version || '2.1.0') : '2.1.0';
            const lastVersion = GM_getValue('bvh_last_version');
            if (lastVersion !== currentVersion) {
                UIComponent.toast(`Bilibili视频观看历史记录 更新至 v${currentVersion}`, "success", 4000);
                GM_setValue('bvh_last_version', currentVersion);
            }
        }

        initMenuCommands() {
            if (typeof GM_registerMenuCommand === 'undefined') return;

            GM_registerMenuCommand('导出历史记录', () => {
                const keys = StorageManager.getAllKeys();
                const data = {};
                keys.forEach(k => {
                    const rec = StorageManager.getRecord(k);
                    if (rec) data[k] = rec;
                });
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bilibili-history-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });

            GM_registerMenuCommand('恢复面板默认位置', () => {
                GM_deleteValue('bvh_panel_position');
                const panel = document.getElementById('bvh-view-panel');
                if (panel) {
                    panel.style.left = '15px';
                    panel.style.bottom = '15px';
                    panel.style.top = 'auto';
                }
                UIComponent.toast('面板位置已恢复默认', 'success', 2000);
            });

            GM_registerMenuCommand('导入历史记录', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                input.onchange = e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = ev => {
                        try {
                            const data = JSON.parse(ev.target.result);
                            let count = 0;
                            let skipCount = 0;
                            for (let k in data) {
                                if (typeof data[k] === 'object' || Array.isArray(data[k])) {
                                    if (!StorageManager.getRecord(k)) {
                                        StorageManager.saveRecord(k, data[k], false);
                                        count++;
                                    } else {
                                        skipCount++;
                                    }
                                }
                            }
                            StorageManager._notifyChange();
                            UIComponent.toast(`成功导入 ${count} 条新记录 (跳过 ${skipCount} 条已有记录)`, 'success', 4000);
                        } catch (err) {
                            UIComponent.toast('导入失败：文件格式错误', 'error');
                        }
                    };
                    reader.readAsText(file);
                };
                input.click();
            });
        }

        checkAndInitVideoPage() {
            const isVideoPage = /\/(video|v|medialist\/play|list)\//.test(location.href) || window.__INITIAL_STATE__?.bvid || /[?&]bvid=/.test(location.href);
            if (isVideoPage) {
                if (this.playerObserver) {
                    this.playerObserver.destroy();
                }
                this.playerObserver = new VideoPlayerObserver();
                this.playerObserver.init();
            }
        }

        hijackRouter() {
            if (!history.pushState.__bvh_patched) {
                const originalPushState = history.pushState;
                const originalReplaceState = history.replaceState;

                history.pushState = function (...args) {
                    originalPushState.apply(this, args);
                    window.dispatchEvent(new Event('pushstate'));
                    window.dispatchEvent(new Event('locationchange'));
                };

                history.replaceState = function (...args) {
                    originalReplaceState.apply(this, args);
                    window.dispatchEvent(new Event('replacestate'));
                    window.dispatchEvent(new Event('locationchange'));
                };
                history.pushState.__bvh_patched = true;
            }

            window.addEventListener('popstate', () => {
                window.dispatchEvent(new Event('locationchange'));
            });

            window.addEventListener('locationchange', () => {
                if (this.currentUrl !== location.href) {
                    this.currentUrl = location.href;
                    Utils.log('Route changed:', this.currentUrl);
                    setTimeout(() => {
                        this.checkAndInitVideoPage();
                        // 合集切换视频时强制刷新播放列表标签
                        if (/\/list\//.test(location.href) && this.domWatcher) {
                            this.domWatcher.refreshPlaylistItems();
                        }
                    }, 500);
                }
            });
        }
    }

    // --- 启动 ---
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            const app = new AppController();
            app.start();
        });
    } else {
        const app = new AppController();
        app.start();
    }

})();
