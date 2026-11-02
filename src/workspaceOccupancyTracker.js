import GLib from "gi://GLib";
import Meta from "gi://Meta";

const APP_WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
]);

export class WorkspaceOccupancyTracker {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._workspaceOccupancySourceId = 0;
        this._displayWindowCreatedSignalId = 0;
        this._workspaceCountSignalId = 0;
        this._trackedWindowSignals = new Map();
        this._hasWindowsOnMultipleWorkspaces = false;
    }

    enable() {
        this._displayWindowCreatedSignalId = global.display.connect(
            "window-created",
            (_display, window) => {
                this._trackWindow(window);
                this._scheduleUpdate();
            },
        );

        this._workspaceCountSignalId = global.workspace_manager.connect(
            "notify::n-workspaces",
            () => this._scheduleUpdate(),
        );

        const workspaceManager = global.workspace_manager;
        const windows = new Set();
        for (let i = 0; i < workspaceManager.n_workspaces; i++) {
            const workspace = workspaceManager.get_workspace_by_index(i);
            for (const window of workspace.list_windows())
                windows.add(window);
        }

        for (const window of windows)
            this._trackWindow(window);

        this.refresh();
    }

    disable() {
        if (this._displayWindowCreatedSignalId) {
            global.display.disconnect(this._displayWindowCreatedSignalId);
            this._displayWindowCreatedSignalId = 0;
        }

        if (this._workspaceCountSignalId) {
            global.workspace_manager.disconnect(this._workspaceCountSignalId);
            this._workspaceCountSignalId = 0;
        }

        if (this._workspaceOccupancySourceId) {
            GLib.Source.remove(this._workspaceOccupancySourceId);
            this._workspaceOccupancySourceId = 0;
        }

        for (const [window, signalIds] of this._trackedWindowSignals) {
            for (const id of signalIds) {
                try {
                    window.disconnect(id);
                } catch (_error) {
                    // The window may already have been unmanaged.
                }
            }
        }

        this._trackedWindowSignals.clear();
    }

    refresh() {
        this._hasWindowsOnMultipleWorkspaces =
            this._countOccupiedWorkspaces() >= 2;
        return this._hasWindowsOnMultipleWorkspaces;
    }

    get hasWindowsOnMultipleWorkspaces() {
        return this._hasWindowsOnMultipleWorkspaces;
    }

    _trackWindow(window) {
        if (!window || this._trackedWindowSignals.has(window))
            return;

        const workspaceChangedId = window.connect("workspace-changed", () =>
            this._scheduleUpdate(),
        );
        const unmanagedId = window.connect("unmanaged", () => {
            this._trackedWindowSignals.delete(window);
            try {
                window.disconnect(workspaceChangedId);
            } catch (_error) {
                // The window may already have been unmanaged.
            }
            this._scheduleUpdate();
        });

        this._trackedWindowSignals.set(window, [workspaceChangedId, unmanagedId]);
    }

    _scheduleUpdate() {
        if (this._workspaceOccupancySourceId)
            return;

        this._workspaceOccupancySourceId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            100,
            () => {
                this._workspaceOccupancySourceId = 0;
                this._onChanged();
                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _countOccupiedWorkspaces() {
        const workspaceManager = global.workspace_manager;
        let occupiedCount = 0;

        for (let i = 0; i < workspaceManager.n_workspaces; i++) {
            const workspace = workspaceManager.get_workspace_by_index(i);
            const hasApplicationWindow = workspace.list_windows().some(
                (window) =>
                    APP_WINDOW_TYPES.has(window.get_window_type()) &&
                    !window.is_on_all_workspaces?.(),
            );

            if (hasApplicationWindow)
                occupiedCount++;
        }

        return occupiedCount;
    }
}
