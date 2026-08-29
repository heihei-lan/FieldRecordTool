(function(App) {
    'use strict';

    App.audio = {
        startRecording: async function() {
            try {
                App.state.mediaStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                        sampleRate: App.CONFIG.sampleRate
                    }
                });

                App.state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: App.CONFIG.sampleRate
                });

                const source = App.state.audioContext.createMediaStreamSource(App.state.mediaStream);
                App.state.scriptProcessor = App.state.audioContext.createScriptProcessor(4096, App.CONFIG.channels, App.CONFIG.channels);

                App.state.recordChunks = [];
                App.state.wordTimings = [];
                App.state.startTime = App.state.audioContext.currentTime;

                App.state.scriptProcessor.onaudioprocess = e => {
                    const inputData = e.inputBuffer.getChannelData(0);
                    App.state.recordChunks.push(new Float32Array(inputData));
                };

                source.connect(App.state.scriptProcessor);
                App.state.scriptProcessor.connect(App.state.audioContext.destination);

                App.state.isRecording = true;
                App.state.wordTimings[App.state.currentIndex] = 0;

                document.getElementById('recordBtn').classList.add('recording');
                document.getElementById('recordStatus').textContent = '录音中...';
                document.getElementById('statusSave').textContent = '正在录音';

            } catch (err) {
                alert('无法启动麦克风，请检查权限设置\n' + err.message);
            }
        },

        stopRecording: function() {
            if (!App.state.isRecording) return;

            App.state.isRecording = false;
            App.state.mediaStream.getTracks().forEach(t => t.stop());
            App.state.scriptProcessor.disconnect();
            App.state.audioContext.close();

            document.getElementById('recordBtn').classList.remove('recording');
            document.getElementById('recordStatus').textContent = '录音完成';

            const totalLength = App.state.recordChunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const pcmData = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of App.state.recordChunks) {
                pcmData.set(chunk, offset);
                offset += chunk.length;
            }

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: App.CONFIG.sampleRate });
            App.state.audioBuffer = audioCtx.createBuffer(App.CONFIG.channels, pcmData.length, App.CONFIG.sampleRate);
            App.state.audioBuffer.getChannelData(0).set(pcmData);

            const duration = pcmData.length / App.CONFIG.sampleRate;
            if (!App.state.wordTimings[App.state.currentIndex + 1]) {
                App.state.wordTimings[App.state.currentIndex + 1] = duration;
            }

            App.annotate.syncTimingsToAnnotations();
            App.wave.drawWaveform();
            App.db.saveProject();
        },

        nextWordRecord: function() {
            if (!App.state.isRecording) return;
            const currentTime = App.state.audioContext.currentTime - App.state.startTime;
            App.state.currentIndex = Math.min(App.state.currentIndex + 1, App.state.wordList.length - 1);
            App.state.wordTimings[App.state.currentIndex] = currentTime;
            App.wordList.jumpToWord(App.state.currentIndex);
        },

        prevWordRecord: function() {
            if (!App.state.isRecording) return;
            App.state.currentIndex = Math.max(App.state.currentIndex - 1, 0);
            App.wordList.jumpToWord(App.state.currentIndex);
        }
    };

})(window.App = window.App || {});