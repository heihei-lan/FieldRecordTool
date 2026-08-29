(function(App) {
    'use strict';

    App.CONFIG = {
        sampleRate: 44100,
        bitDepth: 16,
        channels: 1,
        groupSize: 100,
        virtualItemHeight: 41,
        wasmPath: 'js/vendor/sql-wasm.wasm',
        githubDbUrl: '',
        localDbUrl: 'database.db',
        dbCacheKey: 'dialectToolDbCache',
        dbStoreName: 'dbCache',
        projectStoreName: 'projects'
    };

    App.state = {
        mode: 'collect',
        wordList: [],
        currentGroup: 0,
        currentIndex: 0,
        annotations: {},
        audioBuffer: null,
        isRecording: false,
        recordChunks: [],
        audioContext: null,
        mediaStream: null,
        scriptProcessor: null,
        startTime: 0,
        wordTimings: [],
        projectName: '方言调查工程',
        dbAvailable: true,
        tables: [],
        currentTableIndex: 0,
        tableData: {},
        dbMeta: null,
        sqlReady: false
    };

    App.extensions = {
        sqlite: null,
        subject: null,
        cloud: null,
        cacheQueue: []
    };

    App.switchMode = function(mode) {
        App.state.mode = mode;
        document.getElementById('modeCollect').classList.toggle('active', mode === 'collect');
        document.getElementById('modeAnnotate').classList.toggle('active', mode === 'annotate');
        document.getElementById('recordPanel').style.display = mode === 'collect' ? 'flex' : 'none';
        document.getElementById('statusMode').textContent = mode === 'collect' ? '采集模式' : '标注模式';
    };

    App.bindEvents = function() {
        document.getElementById('modeCollect').onclick = () => App.switchMode('collect');
        document.getElementById('modeAnnotate').onclick = () => App.switchMode('annotate');

        document.getElementById('importWordBtn').onclick = () => App.importExport.showModal('importModal');

        document.getElementById('selectFileBtn').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.txt,.csv';
            input.onchange = e => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = evt => {
                    const content = evt.target.result;
                    if (file.name.endsWith('.csv')) {
                        const lines = content.split(/\r?\n/).filter(line => line.trim());
                        const words = [];
                        lines.forEach((line, idx) => {
                            const cols = line.split(',');
                            const word = cols[1] ? cols[1].trim() : cols[0].trim();
                            if (word) {
                                words.push(word);
                                if (cols[2] || cols[3]) {
                                    if (!App.state.annotations[idx]) App.state.annotations[idx] = {};
                                    if (cols[2]) App.state.annotations[idx].ipa = cols[2].trim();
                                    if (cols[3]) App.state.annotations[idx].note = cols[3].trim();
                                }
                            }
                        });
                        document.getElementById('wordInput').value = words.join('\n');
                    } else {
                        document.getElementById('wordInput').value = content;
                    }
                };
                reader.readAsText(file, 'UTF-8');
            };
            input.click();
        };

        document.getElementById('importAudioBtn').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.wav,.mp3';
            input.onchange = e => App.importExport.importAudio(e.target.files[0]);
            input.click();
        };

        

        document.getElementById('wordList').addEventListener('click', e => {
            const item = e.target.closest('.word-item');
            if (item) {
                App.wordList.jumpToWord(parseInt(item.dataset.idx));
            }
        });

        document.getElementById('wordListContainer').addEventListener('scroll', App.wordList.renderWordList);

        document.getElementById('recordBtn').onclick = () => {
            if (App.state.isRecording) App.audio.stopRecording();
            else App.audio.startRecording();
        };

        document.getElementById('prevWord').onclick = App.audio.prevWordRecord;
        document.getElementById('nextWord').onclick = App.audio.nextWordRecord;
        document.getElementById('playSeg').onclick = App.wave.playCurrentSegment;

        document.getElementById('ipaInput').oninput = e => {
            if (!App.state.annotations[App.state.currentIndex]) App.state.annotations[App.state.currentIndex] = {};
            App.state.annotations[App.state.currentIndex].ipa = e.target.value;
            App.wordList.renderWordList();
            App.db.saveProject();
        };

        document.getElementById('noteInput').oninput = e => {
            if (!App.state.annotations[App.state.currentIndex]) App.state.annotations[App.state.currentIndex] = {};
            App.state.annotations[App.state.currentIndex].note = e.target.value;
            App.db.saveProject();
        };

        document.getElementById('btnReread').onclick = function() {
            this.classList.toggle('active');
            if (!App.state.annotations[App.state.currentIndex]) App.state.annotations[App.state.currentIndex] = {};
            App.state.annotations[App.state.currentIndex].reread = this.classList.contains('active');
            App.wordList.renderWordList();
            App.db.saveProject();
        };

        document.getElementById('btnUnknown').onclick = function() {
            this.classList.toggle('active');
            if (!App.state.annotations[App.state.currentIndex]) App.state.annotations[App.state.currentIndex] = {};
            App.state.annotations[App.state.currentIndex].unknown = this.classList.contains('active');
            App.wordList.renderWordList();
            App.db.saveProject();
        };

        document.getElementById('exportWav').onclick = App.importExport.exportFullWav;
        document.getElementById('exportCsv').onclick = App.importExport.exportCSV;
        document.getElementById('exportTextGrid').onclick = App.importExport.exportTextGrid;

        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch(e.key) {
                case ' ':
                    e.preventDefault();
                    App.wave.playCurrentSegment();
                    break;
                case 'ArrowDown':
                case 'ArrowRight':
                    e.preventDefault();
                    if (App.state.isRecording) App.audio.nextWordRecord();
                    else App.wordList.jumpToWord(Math.min(App.state.currentIndex + 1, App.state.wordList.length - 1));
                    break;
                case 'ArrowUp':
                case 'ArrowLeft':
                    e.preventDefault();
                    if (App.state.isRecording) App.audio.prevWordRecord();
                    else App.wordList.jumpToWord(Math.max(App.state.currentIndex - 1, 0));
                    break;
                case 'r':
                case 'R':
                    document.getElementById('btnReread').click();
                    break;
                case 'u':
                case 'U':
                    document.getElementById('btnUnknown').click();
                    break;
            }
        });

        window.addEventListener('resize', () => {
            if (App.state.audioBuffer) App.wave.drawWaveform();
        });

        App.wave.initBoundaryDrag();
    };

    App.init = async function() {
        await App.db.initDB();
        App.bindEvents();

        await App.wordList.initLoader();

        if (App.state.tables.length === 0) {
            App.wordList.initWithFallback();
        } else {
            const savedIdx = Math.min(App.state.currentTableIndex, App.state.tables.length - 1);
            App.wordList.switchTable(savedIdx);
        }

        App.switchMode(App.state.mode);
        document.getElementById('statusProj').textContent = App.state.projectName;
    };

})(window.App = window.App || {});