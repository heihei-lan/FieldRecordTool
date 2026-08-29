(function(App) {
    'use strict';

    App.wave = {
        drawWaveform: function() {
            if (!App.state.audioBuffer) return;

            const canvas = document.getElementById('waveCanvas');
            const wrap = document.getElementById('waveWrap');
            const ctx = canvas.getContext('2d');

            const dpr = window.devicePixelRatio || 1;
            canvas.width = wrap.clientWidth * dpr;
            canvas.height = wrap.clientHeight * dpr;
            ctx.scale(dpr, dpr);

            const width = wrap.clientWidth;
            const height = wrap.clientHeight;
            const data = App.state.audioBuffer.getChannelData(0);
            const step = Math.ceil(data.length / width);

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, width, height);

            ctx.beginPath();
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1;

            for (let i = 0; i < width; i++) {
                let min = 1, max = -1;
                const start = i * step;
                const end = Math.min(start + step, data.length);

                for (let j = start; j < end; j++) {
                    const val = data[j];
                    if (val < min) min = val;
                    if (val > max) max = val;
                }

                const y1 = (1 - max) / 2 * height;
                const y2 = (1 - min) / 2 * height;

                ctx.moveTo(i, y1);
                ctx.lineTo(i, y2);
            }
            ctx.stroke();

            ctx.beginPath();
            ctx.strokeStyle = '#e2e8f0';
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();

            App.wave.updateTimeDisplay();
        },

        updateTimeDisplay: function() {
            if (!App.state.audioBuffer) return;
            const duration = App.state.audioBuffer.duration;
            const current = App.state.wordTimings[App.state.currentIndex] || 0;
            document.getElementById('waveTime').textContent =
                `${App.wave.formatTime(current)} / ${App.wave.formatTime(duration)}`;
        },

        formatTime: function(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            const ms = Math.floor((seconds % 1) * 1000);
            return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
        },

        updateBoundaryPosition: function() {
            if (!App.state.audioBuffer) return;
            const wrap = document.getElementById('waveWrap');
            const duration = App.state.audioBuffer.duration;
            const annot = App.state.annotations[App.state.currentIndex] || {};

            const start = annot.start !== undefined ? annot.start : (App.state.wordTimings[App.state.currentIndex] || 0);
            const end = annot.end !== undefined ? annot.end : (App.state.wordTimings[App.state.currentIndex + 1] || duration);

            const leftPct = (start / duration) * 100;
            const rightPct = (end / duration) * 100;

            document.getElementById('boundaryLeft').style.left = leftPct + '%';
            document.getElementById('boundaryRight').style.left = rightPct + '%';
            document.getElementById('playhead').style.left = leftPct + '%';
        },

        initBoundaryDrag: function() {
            const left = document.getElementById('boundaryLeft');
            const right = document.getElementById('boundaryRight');
            const wrap = document.getElementById('waveWrap');

            let dragging = null;

            function onDrag(e) {
                if (!dragging || !App.state.audioBuffer) return;
                const rect = wrap.getBoundingClientRect();
                const clientX = e.clientX || (e.touches && e.touches[0].clientX);
                const x = clientX - rect.left;
                const pct = Math.max(0, Math.min(1, x / rect.width));
                const time = pct * App.state.audioBuffer.duration;

                const idx = App.state.currentIndex;
                if (!App.state.annotations[idx]) App.state.annotations[idx] = {};

                if (dragging === 'left') {
                    App.state.annotations[idx].start = time;
                } else {
                    App.state.annotations[idx].end = time;
                }

                App.wave.updateBoundaryPosition();
                App.wave.updateTimeDisplay();
                App.db.saveProject();
            }

            function endDrag() {
                dragging = null;
                document.removeEventListener('mousemove', onDrag);
                document.removeEventListener('mouseup', endDrag);
                document.removeEventListener('touchmove', onDrag);
                document.removeEventListener('touchend', endDrag);
            }

            left.addEventListener('mousedown', e => { e.preventDefault(); dragging = 'left'; bindDrag(); });
            right.addEventListener('mousedown', e => { e.preventDefault(); dragging = 'right'; bindDrag(); });
            left.addEventListener('touchstart', e => { e.preventDefault(); dragging = 'left'; bindDrag(); });
            right.addEventListener('touchstart', e => { e.preventDefault(); dragging = 'right'; bindDrag(); });

            function bindDrag() {
                document.addEventListener('mousemove', onDrag);
                document.addEventListener('mouseup', endDrag);
                document.addEventListener('touchmove', onDrag, { passive: false });
                document.addEventListener('touchend', endDrag);
            }
        },

        playCurrentSegment: function() {
            if (!App.state.audioBuffer) return;
            const annot = App.state.annotations[App.state.currentIndex] || {};
            const start = annot.start !== undefined ? annot.start : (App.state.wordTimings[App.state.currentIndex] || 0);
            const end = annot.end !== undefined ? annot.end : (App.state.wordTimings[App.state.currentIndex + 1] || App.state.audioBuffer.duration);

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: App.CONFIG.sampleRate });
            const source = audioCtx.createBufferSource();
            source.buffer = App.state.audioBuffer;
            source.connect(audioCtx.destination);
            source.start(0, start, end - start);

            const duration = end - start;
            const startTime = Date.now();
            const playhead = document.getElementById('playhead');
            const totalDur = App.state.audioBuffer.duration;

            function updatePlayhead() {
                const elapsed = (Date.now() - startTime) / 1000;
                if (elapsed >= duration) {
                    playhead.style.left = (end / totalDur * 100) + '%';
                    return;
                }
                playhead.style.left = ((start + elapsed) / totalDur * 100) + '%';
                requestAnimationFrame(updatePlayhead);
            }
            updatePlayhead();
        }
    };

})(window.App = window.App || {});