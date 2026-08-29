(function(App) {
    'use strict';

    let SQL = null;

    function loadWasm() {
        return new Promise((resolve, reject) => {
            if (window.initSqlJs) {
                window.initSqlJs({
                    locateFile: file => 'js/vendor/' + file
                }).then(sql => {
                    SQL = sql;
                    App.state.sqlReady = true;
                    resolve(sql);
                }).catch(reject);
            } else {
                reject(new Error('sql.js not loaded'));
            }
        });
    }

    function detectWordColumn(columns) {
        const lower = columns.map(c => c.toLowerCase());
        const candidates = ['word', 'char', 'hanzi', '汉字', '字', 'character', 'text', '内容'];
        for (const candidate of candidates) {
            const idx = lower.indexOf(candidate);
            if (idx !== -1) return columns[idx];
        }
        for (let i = 0; i < lower.length; i++) {
            if (lower[i].includes('word') || lower[i].includes('char') || lower[i].includes('字')) {
                return columns[i];
            }
        }
        return columns[columns.length - 1] || columns[0];
    }

    function detectIpaColumn(columns) {
        const lower = columns.map(c => c.toLowerCase());
        const candidates = ['ipa', 'pinyin', '音标', '拼音', 'phonetic'];
        for (const candidate of candidates) {
            const idx = lower.indexOf(candidate);
            if (idx !== -1) return columns[idx];
        }
        return null;
    }

    function detectNoteColumn(columns) {
        const lower = columns.map(c => c.toLowerCase());
        const candidates = ['note', 'remark', '备注', 'notes', 'comment'];
        for (const candidate of candidates) {
            const idx = lower.indexOf(candidate);
            if (idx !== -1) return columns[idx];
        }
        return null;
    }

    function detectGroupColumn(columns) {
        const lower = columns.map(c => c.toLowerCase());
        const candidates = ['group', '分组', 'category', '分类', 'type', '类型'];
        for (const candidate of candidates) {
            const idx = lower.indexOf(candidate);
            if (idx !== -1) return columns[idx];
        }
        return null;
    }

    async function fetchDbFromUrl(url) {
        const response = await fetch(url, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Failed to fetch DB: ' + response.status);
        return await response.arrayBuffer();
    }

    function parseDatabase(dbBuffer) {
        const u8 = new Uint8Array(dbBuffer);
        const db = new SQL.Database(u8);

        const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
        const tableNames = tablesRes.length > 0
            ? tablesRes[0].values.map(row => row[0])
            : [];

        const tables = [];
        for (const tableName of tableNames) {
            const colsRes = db.exec(`PRAGMA table_info("${tableName}")`);
            if (colsRes.length === 0) continue;

            const columns = colsRes[0].values.map(row => row[1]);

            const wordCol = detectWordColumn(columns);
            const ipaCol = detectIpaColumn(columns);
            const noteCol = detectNoteColumn(columns);
            const groupCol = detectGroupColumn(columns);

            let query = `SELECT * FROM "${tableName}"`;
            try {
                const countRes = db.exec(`SELECT COUNT(*) FROM "${tableName}"`);
                const rowCount = countRes.length > 0 ? countRes[0].values[0][0] : 0;

                const wordsRes = db.exec(query);
                const words = [];

                if (wordsRes.length > 0) {
                    const colIdx = {};
                    wordsRes[0].columns.forEach((c, i) => colIdx[c] = i);

                    for (const row of wordsRes[0].values) {
                        const word = row[colIdx[wordCol]];
                        if (word !== null && word !== undefined && String(word).trim()) {
                            words.push({
                                word: String(word),
                                ipa: ipaCol ? String(row[colIdx[ipaCol]] || '') : '',
                                note: noteCol ? String(row[colIdx[noteCol]] || '') : '',
                                group: groupCol ? String(row[colIdx[groupCol]] || '') : ''
                            });
                        }
                    }
                }

                if (words.length > 0) {
                    let displayName = tableName;
                    const nameMap = {
                        'dialect_words': '方言字表',
                        'minimal_pairs': '最小对立组',
                        'vocabulary': '词汇表',
                        'sentences': '例句',
                        'tone_pairs': '声调配对'
                    };
                    const lowerName = tableName.toLowerCase();
                    for (const [key, display] of Object.entries(nameMap)) {
                        if (lowerName.includes(key)) {
                            displayName = display;
                            break;
                        }
                    }

                    tables.push({
                        id: tableName,
                        name: displayName,
                        rawName: tableName,
                        columns: columns,
                        wordColumn: wordCol,
                        ipaColumn: ipaCol,
                        noteColumn: noteCol,
                        groupColumn: groupCol,
                        words: words,
                        rowCount: rowCount
                    });
                }
            } catch (e) {
                console.warn('Failed to parse table', tableName, e);
            }
        }

        db.close();
        return tables;
    }

    async function tryLoadFromSource(url, sourceName) {
            try {
                const dbBuffer = await fetchDbFromUrl(url);
                const tables = parseDatabase(dbBuffer);
                if (tables.length > 0) {
                    App.state.tables = tables;
                    App.state.dbMeta = {
                        source: sourceName,
                        loadedAt: Date.now(),
                        tableCount: tables.length,
                        url: url
                    };
                    const blob = new Blob([dbBuffer], { type: 'application/octet-stream' });
                    App.db.cacheDbBlob(blob, App.state.dbMeta);
                    return true;
                }
            } catch (e) {
                console.warn(sourceName + ' load failed:', e.message);
            }
            return false;
        }

        App.wordList = {
        initLoader: async function() {
            try {
                await loadWasm();
            } catch (e) {
                console.warn('sql.js init failed:', e);
                App.state.sqlReady = false;
            }

            if (App.CONFIG.githubDbUrl) {
                const ok = await tryLoadFromSource(App.CONFIG.githubDbUrl, 'github');
                if (ok) return;
            }

            if (App.CONFIG.localDbUrl) {
                const ok = await tryLoadFromSource(App.CONFIG.localDbUrl, 'local');
                if (ok) return;
            }

            const cached = await App.db.loadCachedDb();
            if (cached && cached.blob) {
                try {
                    const dbBuffer = await cached.blob.arrayBuffer();
                    const tables = parseDatabase(dbBuffer);
                    if (tables.length > 0) {
                        App.state.tables = tables;
                        App.state.dbMeta = cached.meta || { source: 'cache', loadedAt: Date.now() };
                        return;
                    }
                } catch (e) {
                    console.warn('Cache parse failed:', e);
                }
            }

            const savedMeta = await App.db.loadProject();
            if (savedMeta && savedMeta.currentTableIndex !== undefined) {
                App.state.currentTableIndex = savedMeta.currentTableIndex;
            }

            App.state.tables = [];
        },

        initWithFallback: function() {
            const fallbackWords = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                '百', '千', '万', '人', '口', '日', '月', '山', '水', '火',
                '土', '木', '金', '石', '田', '牛', '羊', '马', '鸟', '鱼'];

            App.state.tables = [{
                id: 'builtin_demo',
                name: '内置示例字表',
                rawName: 'builtin_demo',
                columns: ['word'],
                wordColumn: 'word',
                ipaColumn: null,
                noteColumn: null,
                groupColumn: null,
                words: fallbackWords.map(w => ({ word: w, ipa: '', note: '', group: '' })),
                rowCount: fallbackWords.length
            }];
            App.state.currentTableIndex = 0;
            App.wordList.switchTable(0);
        },

        switchTable: function(tableIndex) {
            if (tableIndex < 0 || tableIndex >= App.state.tables.length) return;

            const oldTableId = App.state.tables[App.state.currentTableIndex];
            if (oldTableId && oldTableId.id) {
                App.db.saveTableData(oldTableId.id, {
                    annotations: App.state.annotations,
                    wordTimings: App.state.wordTimings
                });
            }

            App.state.currentTableIndex = tableIndex;
            const table = App.state.tables[tableIndex];
            App.state.wordList = table.words.map(w => w.word);

            App.state.annotations = {};
            App.state.wordTimings = [];

            App.db.loadTableData(table.id).then(savedData => {
                if (savedData) {
                    App.state.annotations = savedData.annotations || {};
                    App.state.wordTimings = savedData.wordTimings || [];
                } else {
                    table.words.forEach((w, i) => {
                        App.state.annotations[i] = {
                            ipa: w.ipa || '',
                            note: w.note || '',
                            reread: false,
                            unknown: false
                        };
                    });
                }

                App.state.currentIndex = 0;
                App.state.currentGroup = 0;
                App.state.audioBuffer = null;
                App.state.isRecording = false;
                App.state.recordChunks = [];

                if (App.state.audioContext) {
                    try { App.state.audioContext.close(); } catch (e) {}
                    App.state.audioContext = null;
                }
                if (App.state.mediaStream) {
                    try { App.state.mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                    App.state.mediaStream = null;
                }

                App.wordList.renderWordList();
                App.wordList.jumpToWord(0);
                App.wave.drawWaveform();
                App.wave.updateBoundaryPosition();
                App.db.saveProject();
            });
        },

        renderWordList: function() {
            const container = document.getElementById('wordListContainer');
            const list = document.getElementById('wordList');
            const total = App.wordList.getCurrentGroupWords().length;

            const scrollTop = container.scrollTop;
            const viewHeight = container.clientHeight;
            const start = Math.floor(scrollTop / App.CONFIG.virtualItemHeight);
            const end = Math.min(start + Math.ceil(viewHeight / App.CONFIG.virtualItemHeight) + 3, total);

            list.style.height = total * App.CONFIG.virtualItemHeight + 'px';
            list.style.transform = `translateY(${start * App.CONFIG.virtualItemHeight}px)`;

            let html = '';
            const groupOffset = App.state.currentGroup * App.CONFIG.groupSize;
            for (let i = start; i < end; i++) {
                const globalIdx = groupOffset + i;
                const word = App.state.wordList[globalIdx];
                const annot = App.state.annotations[globalIdx] || {};
                const isActive = globalIdx === App.state.currentIndex;

                let tags = '';
                if (annot.reread) tags += '<span class="tag reread">重读</span>';
                if (annot.unknown) tags += '<span class="tag unknown">不识</span>';
                if (annot.ipa) tags += '<span class="tag marked">已标</span>';

                html += `
                    <div class="word-item ${isActive ? 'active' : ''}" data-idx="${globalIdx}">
                        <span class="idx">${String(globalIdx + 1).padStart(3, '0')}</span>
                        <span class="char">${word || ''}</span>
                        <span class="tags">${tags}</span>
                    </div>
                `;
            }
            list.innerHTML = html;

            document.getElementById('wordCount').textContent = App.state.wordList.length;
            const currentTable = App.state.tables[App.state.currentTableIndex];
            const tableName = currentTable ? currentTable.name : '字表';

            if (App.state.wordList.length <= App.CONFIG.groupSize) {
                document.getElementById('groupInfo').textContent = `${tableName} · 共${App.state.wordList.length}字`;
            } else {
                document.getElementById('groupInfo').textContent = `${tableName} · 第${App.state.currentGroup + 1}组 / 共${Math.ceil(App.state.wordList.length / App.CONFIG.groupSize)}组`;
            }
            App.wordList.updateGroupSelect();
        },

        getCurrentGroupWords: function() {
            const start = App.state.currentGroup * App.CONFIG.groupSize;
            const end = Math.min(start + App.CONFIG.groupSize, App.state.wordList.length);
            return App.state.wordList.slice(start, end);
        },

        updateGroupSelect: function() {
            const select = document.getElementById('groupSelect');
            if (App.state.tables.length <= 1 && App.state.wordList.length <= App.CONFIG.groupSize) {
                select.style.display = 'none';
                return;
            }
            select.style.display = '';

            select.innerHTML = '';

            if (App.state.tables.length > 1) {
                App.state.tables.forEach((table, idx) => {
                    const opt = document.createElement('option');
                    opt.value = `t_${idx}`;
                    opt.textContent = `${table.name} (${table.rowCount}字)`;
                    if (table.rowCount <= App.CONFIG.groupSize) {
                        select.appendChild(opt);
                    } else {
                        const totalGroups = Math.ceil(table.rowCount / App.CONFIG.groupSize);
                        for (let g = 0; g < totalGroups; g++) {
                            const subOpt = document.createElement('option');
                            subOpt.value = `tg_${idx}_${g}`;
                            subOpt.textContent = `  └ 第${g + 1}组 (${g * App.CONFIG.groupSize + 1}-${Math.min((g + 1) * App.CONFIG.groupSize, table.rowCount)}字)`;
                            select.appendChild(subOpt);
                        }
                    }
                });

                if (App.state.wordList.length > App.CONFIG.groupSize) {
                    const optIdx = App.state.currentTableIndex;
                    const groupOffset = App.state.currentGroup;
                    select.value = `tg_${optIdx}_${groupOffset}`;
                } else {
                    select.value = `t_${App.state.currentTableIndex}`;
                }
            } else if (App.state.wordList.length > App.CONFIG.groupSize) {
                const totalGroups = Math.ceil(App.state.wordList.length / App.CONFIG.groupSize);
                for (let i = 0; i < totalGroups; i++) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = `第 ${i + 1} 组 (${i * App.CONFIG.groupSize + 1}-${Math.min((i + 1) * App.CONFIG.groupSize, App.state.wordList.length)}字)`;
                    select.appendChild(opt);
                }
                select.value = App.state.currentGroup;
            }
        },

        jumpToWord: function(index) {
            App.state.currentIndex = index;
            App.state.currentGroup = Math.floor(index / App.CONFIG.groupSize);

            document.getElementById('curIdx').textContent = String(index + 1).padStart(3, '0');
            document.getElementById('curChar').textContent = App.state.wordList[index] || '';

            const annot = App.state.annotations[index] || {};
            document.getElementById('ipaInput').value = annot.ipa || '';
            document.getElementById('noteInput').value = annot.note || '';
            document.getElementById('btnReread').classList.toggle('active', !!annot.reread);
            document.getElementById('btnUnknown').classList.toggle('active', !!annot.unknown);

            const groupOffset = App.state.currentGroup * App.CONFIG.groupSize;
            const localIdx = index - groupOffset;
            const container = document.getElementById('wordListContainer');
            const viewTop = container.scrollTop;
            const viewBottom = viewTop + container.clientHeight;
            const itemTop = localIdx * App.CONFIG.virtualItemHeight;
            const itemBottom = itemTop + App.CONFIG.virtualItemHeight;

            if (itemTop < viewTop || itemBottom > viewBottom) {
                container.scrollTop = itemTop - container.clientHeight / 2;
            }

            App.wordList.renderWordList();
            App.wave.updateBoundaryPosition();
            App.db.saveProject();
        }
    };

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('groupSelect').addEventListener('change', function() {
            const val = this.value;
            if (val.startsWith('t_')) {
                const tableIdx = parseInt(val.substring(2));
                if (tableIdx !== App.state.currentTableIndex) {
                    App.wordList.switchTable(tableIdx);
                } else {
                    App.state.currentGroup = 0;
                    App.wordList.jumpToWord(0);
                }
            } else if (val.startsWith('tg_')) {
                const parts = val.substring(3).split('_');
                const tableIdx = parseInt(parts[0]);
                const groupIdx = parseInt(parts[1]);
                if (tableIdx !== App.state.currentTableIndex) {
                    App.state.currentGroup = groupIdx;
                    App.wordList.switchTable(tableIdx);
                } else {
                    App.state.currentGroup = groupIdx;
                    App.wordList.jumpToWord(groupIdx * App.CONFIG.groupSize);
                }
            } else {
                App.state.currentGroup = parseInt(val);
                App.wordList.jumpToWord(App.state.currentGroup * App.CONFIG.groupSize);
            }
        });
    });

})(window.App = window.App || {});