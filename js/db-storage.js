(function(App) {
    'use strict';

    const DB_NAME = 'DialectToolDB';
    const DB_VERSION = 2;
    let db = null;
    let saveTimer = null;

    App.db = {
        initDB: function() {
            return new Promise((resolve) => {
                try {
                    const req = indexedDB.open(DB_NAME, DB_VERSION);
                    req.onupgradeneeded = e => {
                        const database = e.target.result;
                        if (!database.objectStoreNames.contains('projects')) {
                            database.createObjectStore('projects', { keyPath: 'id' });
                        }
                        if (!database.objectStoreNames.contains(App.CONFIG.dbStoreName)) {
                            database.createObjectStore(App.CONFIG.dbStoreName, { keyPath: 'key' });
                        }
                        if (!database.objectStoreNames.contains('tableData')) {
                            database.createObjectStore('tableData', { keyPath: 'tableId' });
                        }
                    };
                    req.onsuccess = e => {
                        db = e.target.result;
                        App.state.dbAvailable = true;
                        resolve();
                    };
                    req.onerror = () => {
                        App.state.dbAvailable = false;
                        resolve();
                    };
                } catch (e) {
                    App.state.dbAvailable = false;
                    resolve();
                }
            });
        },

        cacheDbBlob: function(blob, meta) {
            if (!App.state.dbAvailable) return;
            try {
                const tx = db.transaction(App.CONFIG.dbStoreName, 'readwrite');
                tx.store.put({
                    key: App.CONFIG.dbCacheKey,
                    blob: blob,
                    meta: meta,
                    savedAt: Date.now()
                });
            } catch (e) {
                console.warn('DB cache failed:', e);
            }
        },

        loadCachedDb: function() {
            if (!App.state.dbAvailable) return Promise.resolve(null);
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction(App.CONFIG.dbStoreName, 'readonly');
                    const req = tx.store.get(App.CONFIG.dbCacheKey);
                    req.onsuccess = e => resolve(e.target.result || null);
                    req.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        },

        saveTableData: function(tableId, data) {
            if (!App.state.dbAvailable) return;
            try {
                const tx = db.transaction('tableData', 'readwrite');
                tx.store.put({
                    tableId: tableId,
                    annotations: data.annotations || {},
                    wordTimings: data.wordTimings || [],
                    savedAt: Date.now()
                });
            } catch (e) {
                console.warn('Table data save failed:', e);
            }
        },

        loadTableData: function(tableId) {
            if (!App.state.dbAvailable) return Promise.resolve(null);
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction('tableData', 'readonly');
                    const req = tx.store.get(tableId);
                    req.onsuccess = e => resolve(e.target.result || null);
                    req.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        },

        saveProject: function() {
            if (!App.state.dbAvailable) return;
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                try {
                    const currentTableId = App.state.tables[App.state.currentTableIndex]
                        ? App.state.tables[App.state.currentTableIndex].id
                        : 'default';

                    App.db.saveTableData(currentTableId, {
                        annotations: App.state.annotations,
                        wordTimings: App.state.wordTimings
                    });

                    const data = {
                        id: 'projectMeta',
                        projectName: App.state.projectName,
                        currentTableIndex: App.state.currentTableIndex,
                        mode: App.state.mode,
                        savedAt: Date.now()
                    };
                    const tx = db.transaction('projects', 'readwrite');
                    tx.store.put(data);
                    document.getElementById('statusSave').textContent = '已自动保存';
                } catch (e) {
                    document.getElementById('statusSave').textContent = '保存失败';
                }
            }, 300);
        },

        loadProject: function() {
            if (!App.state.dbAvailable) return Promise.resolve(null);
            return new Promise((resolve) => {
                try {
                    const tx = db.transaction('projects', 'readonly');
                    const req = tx.store.get('projectMeta');
                    req.onsuccess = e => {
                        if (e.target.result) {
                            const meta = e.target.result;
                            App.state.projectName = meta.projectName || '方言调查工程';
                            App.state.currentTableIndex = meta.currentTableIndex || 0;
                            App.state.mode = meta.mode || 'collect';
                            resolve(meta);
                        } else {
                            resolve(null);
                        }
                    };
                    req.onerror = () => resolve(null);
                } catch (e) {
                    resolve(null);
                }
            });
        }
    };

})(window.App = window.App || {});