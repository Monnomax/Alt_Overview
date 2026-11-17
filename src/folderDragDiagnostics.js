import GLib from "gi://GLib";

export class FolderDragDiagnostics {
    constructor(appDisplay) {
        this._appDisplay = appDisplay;
        this._folderDragDiagnostics = null;
        this._installFolderDragDiagnostics();
    }

    _installFolderDragDiagnostics() {
        const appDisplay = this._appDisplay;

        if (!appDisplay || appDisplay._chFolderDragDiagnostics) return;

        const now = () => GLib.get_monotonic_time();

        const state = {
            active: false,
            beginTime: 0,

            ensureCalls: 0,
            ensureTime: 0,

            redisplayCalls: 0,
            redisplayTime: 0,

            maybeMoveCalls: 0,
            maybeMoveTime: 0,

            removePlaceholderCalls: 0,
            removePlaceholderTime: 0,
        };

        const originalOnDragBegin = appDisplay._onDragBegin;
        const originalOnDragEnd = appDisplay._onDragEnd;
        const originalOnDragCancelled = appDisplay._onDragCancelled;

        const originalEnsurePlaceholder = appDisplay._ensurePlaceholder;

        const originalRedisplay = appDisplay._redisplay;

        const originalMaybeMoveItem = appDisplay._maybeMoveItem;

        const originalRemovePlaceholder = appDisplay._removePlaceholder;

        const controller = this;

        const reset = () => {
            state.ensureCalls = 0;
            state.ensureTime = 0;

            state.redisplayCalls = 0;
            state.redisplayTime = 0;

            state.maybeMoveCalls = 0;
            state.maybeMoveTime = 0;

            state.removePlaceholderCalls = 0;
            state.removePlaceholderTime = 0;

            state.beginTime = now();
        };

        appDisplay._onDragBegin = function (...args) {
            reset();
            state.active = true;

            console.log(
                `[alt-overview] [folder-drag] BEGIN ` +
                    `source=${args[1]?.id ?? "unknown"}`,
            );

            return originalOnDragBegin.apply(this, args);
        };

        appDisplay._onDragEnd = function (...args) {
            const result = originalOnDragEnd.apply(this, args);

            if (state.active) {
                const totalTime = (now() - state.beginTime) / 1000;

                console.log(
                    `[alt-overview] [folder-drag] END ` +
                        `total=${totalTime.toFixed(3)}ms ` +
                        `ensure=${state.ensureTime.toFixed(3)}ms/${state.ensureCalls} ` +
                        `redisplay=${state.redisplayTime.toFixed(3)}ms/${state.redisplayCalls} ` +
                        `maybeMove=${state.maybeMoveTime.toFixed(3)}ms/${state.maybeMoveCalls} ` +
                        `removePlaceholder=${state.removePlaceholderTime.toFixed(3)}ms/${state.removePlaceholderCalls}`,
                );
            }

            state.active = false;

            return result;
        };

        appDisplay._onDragCancelled = function (...args) {
            const result = originalOnDragCancelled.apply(this, args);

            state.active = false;

            return result;
        };

        appDisplay._ensurePlaceholder = function (...args) {
            const start = now();

            try {
                return originalEnsurePlaceholder.apply(this, args);
            } finally {
                if (state.active) {
                    const elapsed = (now() - start) / 1000;

                    state.ensureCalls++;
                    state.ensureTime += elapsed;

                    console.log(
                        `[alt-overview] [folder-drag] ` +
                            `_ensurePlaceholder ` +
                            `${elapsed.toFixed(3)}ms`,
                    );
                }
            }
        };

        appDisplay._redisplay = function (...args) {
            const start = now();

            try {
                return originalRedisplay.apply(this, args);
            } finally {
                if (state.active) {
                    const elapsed = (now() - start) / 1000;

                    state.redisplayCalls++;
                    state.redisplayTime += elapsed;

                    console.log(
                        `[alt-overview] [folder-drag] ` +
                            `_redisplay ` +
                            `${elapsed.toFixed(3)}ms`,
                    );
                }
            }
        };

        appDisplay._maybeMoveItem = function (...args) {
            const start = now();

            try {
                return originalMaybeMoveItem.apply(this, args);
            } finally {
                if (state.active) {
                    const elapsed = (now() - start) / 1000;

                    state.maybeMoveCalls++;
                    state.maybeMoveTime += elapsed;

                    if (elapsed >= 5) {
                        console.log(
                            `[alt-overview] [folder-drag] ` +
                                `_maybeMoveItem SLOW ` +
                                `${elapsed.toFixed(3)}ms`,
                        );
                    }
                }
            }
        };

        appDisplay._removePlaceholder = function (...args) {
            const start = now();

            try {
                return originalRemovePlaceholder.apply(this, args);
            } finally {
                if (state.active) {
                    const elapsed = (now() - start) / 1000;

                    state.removePlaceholderCalls++;
                    state.removePlaceholderTime += elapsed;

                    console.log(
                        `[alt-overview] [folder-drag] ` +
                            `_removePlaceholder ` +
                            `${elapsed.toFixed(3)}ms`,
                    );
                }
            }
        };

        appDisplay._chFolderDragDiagnostics = {
            originalOnDragBegin,
            originalOnDragEnd,
            originalOnDragCancelled,
            originalEnsurePlaceholder,
            originalRedisplay,
            originalMaybeMoveItem,
            originalRemovePlaceholder,
        };

        this._folderDragDiagnostics = state;
    }

    _removeFolderDragDiagnostics() {
        const appDisplay = this._appDisplay;
        const original = appDisplay?._chFolderDragDiagnostics;

        if (!appDisplay || !original) return;

        if (appDisplay._onDragBegin !== original.originalOnDragBegin)
            appDisplay._onDragBegin = original.originalOnDragBegin;

        if (appDisplay._onDragEnd !== original.originalOnDragEnd)
            appDisplay._onDragEnd = original.originalOnDragEnd;

        if (appDisplay._onDragCancelled !== original.originalOnDragCancelled) {
            appDisplay._onDragCancelled = original.originalOnDragCancelled;
        }

        if (
            appDisplay._ensurePlaceholder !== original.originalEnsurePlaceholder
        ) {
            appDisplay._ensurePlaceholder = original.originalEnsurePlaceholder;
        }

        if (appDisplay._redisplay !== original.originalRedisplay) {
            appDisplay._redisplay = original.originalRedisplay;
        }

        if (appDisplay._maybeMoveItem !== original.originalMaybeMoveItem) {
            appDisplay._maybeMoveItem = original.originalMaybeMoveItem;
        }

        if (
            appDisplay._removePlaceholder !== original.originalRemovePlaceholder
        ) {
            appDisplay._removePlaceholder = original.originalRemovePlaceholder;
        }

        delete appDisplay._chFolderDragDiagnostics;
        this._folderDragDiagnostics = null;
    }

    destroy() {
        this._removeFolderDragDiagnostics();
    }
}
