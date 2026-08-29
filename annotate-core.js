(function(App) {
    'use strict';

    App.annotate = {
        syncTimingsToAnnotations: function() {
            for (let i = 0; i < App.state.wordList.length; i++) {
                if (!App.state.annotations[i]) App.state.annotations[i] = {};
                if (App.state.wordTimings[i] !== undefined && App.state.annotations[i].start === undefined) {
                    App.state.annotations[i].start = App.state.wordTimings[i];
                }
                if (App.state.wordTimings[i + 1] !== undefined && App.state.annotations[i].end === undefined) {
                    App.state.annotations[i].end = App.state.wordTimings[i + 1];
                }
            }
        }
    };

})(window.App = window.App || {});