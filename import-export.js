(function(App) {
    'use strict';

    function encodeWAV(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');

        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, App.CONFIG.channels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * App.CONFIG.channels * 2, true);
        view.setUint16(32, App.CONFIG.channels * 2, true);
        view.setUint16(34, App.CONFIG.bitDepth, true);

        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    App.importExport = {
        importWordList: function(text) {
            const words = text.split(/\r?\n/).map(w => w.trim()).filter(w => w.length > 0);

            const tableName = App.state.tables.length > 0
                ? App.state.tables[App.state.currentTableIndex].name
                : '自定义字表';

            const tableId = 'custom_' + Date.now();

            App.state.tables.push({
                id: tableId,
                name: tableName + ' (导入)',
                rawName: tableId,
                columns: ['word'],
                wordColumn: 'word',
                ipaColumn: null,
                noteColumn: null,
                groupColumn: null,
                words: words.map(w => ({ word: w, ipa: '', note: '', group: '' })),
                rowCount: words.length
            });

            App.state.currentTableIndex = App.state.tables.length - 1;
            App.wordList.switchTable(App.state.currentTableIndex);
            App.db.saveProject();
            App.importExport.closeModal('importModal');
        },

        importAudio: function(file) {
            const reader = new FileReader();
            reader.onload = async e => {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: App.CONFIG.sampleRate });
                try {
                    App.state.audioBuffer = await audioCtx.decodeAudioData(e.target.result);
                    if (App.state.audioBuffer.numberOfChannels > 1) {
                        const mono = audioCtx.createBuffer(1, App.state.audioBuffer.length, App.CONFIG.sampleRate);
                        const left = App.state.audioBuffer.getChannelData(0);
                        const right = App.state.audioBuffer.getChannelData(1);
                        const monoData = mono.getChannelData(0);
                        for (let i = 0; i < left.length; i++) {
                            monoData[i] = (left[i] + right[i]) / 2;
                        }
                        App.state.audioBuffer = mono;
                    }

                    App.wave.drawWaveform();
                    document.getElementById('recordStatus').textContent = '已导入音频';
                    alert('音频导入成功！');
                } catch (err) {
                    alert('音频解析失败，请使用标准WAV格式');
                }
            };
            reader.readAsArrayBuffer(file);
        },

        exportFullWav: function() {
            if (!App.state.audioBuffer) { alert('没有音频可导出'); return; }
            const data = App.state.audioBuffer.getChannelData(0);
            const blob = encodeWAV(data, App.CONFIG.sampleRate);
            const tableName = App.state.tables[App.state.currentTableIndex]
                ? App.state.tables[App.state.currentTableIndex].name
                : App.state.projectName;
            App.importExport.downloadBlob(blob, `${tableName}_全段.wav`);
        },

        exportCSV: function() {
            let csv = '序号,汉字,音标,备注,起始时间,结束时间,重读,不识\n';
            const table = App.state.tables[App.state.currentTableIndex];
            const tableName = table ? table.name : App.state.projectName;

            App.state.wordList.forEach((word, i) => {
                const a = App.state.annotations[i] || {};
                csv += `${i + 1},${word},"${a.ipa || ''}","${a.note || ''}",${a.start || ''},${a.end || ''},${a.reread ? '是' : '否'},${a.unknown ? '是' : '否'}\n`;
            });
            const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
            App.importExport.downloadBlob(blob, `${tableName}_标注表.csv`);
        },

        exportTextGrid: function() {
            if (!App.state.audioBuffer) { alert('需要音频才能导出TextGrid'); return; }
            const duration = App.state.audioBuffer.duration;
            const table = App.state.tables[App.state.currentTableIndex];
            const tableName = table ? table.name : App.state.projectName;

            let tg = `File type = "ooTextFile"
Object class = "TextGrid"
xmin = 0 
xmax = ${duration} 
tiers? <exists> 
size = 1 
item []: 
    item [1]:
        class = "IntervalTier"
        name = "${tableName}"
        xmin = 0 
        xmax = ${duration} 
        intervals: size = ${App.state.wordList.length} 
`;

            App.state.wordList.forEach((word, i) => {
                const a = App.state.annotations[i] || {};
                const start = a.start !== undefined ? a.start : (App.state.wordTimings[i] || 0);
                const end = a.end !== undefined ? a.end : (App.state.wordTimings[i + 1] || duration);
                const label = a.ipa || word;

                tg += `        intervals [${i + 1}]:
            xmin = ${start} 
            xmax = ${end} 
            text = "${label}" 
`;
            });

            const blob = new Blob([tg], { type: 'text/plain' });
            App.importExport.downloadBlob(blob, `${tableName}.TextGrid`);
        },

        downloadBlob: function(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        },

        showModal: function(id) { document.getElementById(id).classList.add('show'); },
        closeModal: function(id) { document.getElementById(id).classList.remove('show'); },

        confirmImportWord: function() {
            const text = document.getElementById('wordInput').value;
            if (!text.trim()) { alert('请输入字表内容'); return; }
            App.importExport.importWordList(text);
        }
    };

})(window.App = window.App || {});