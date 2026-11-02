import Meta from "gi://Meta";

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

import { WorkspacesView } from "resource:///org/gnome/shell/ui/workspacesView.js";

export class WorkspacesController {
    constructor(settings, workspacesView, workspacesDisplay) {
        this._settings = settings;
        /*
         * Do not retain a WorkspacesView instance here. GNOME destroys and
         * recreates these views on every Overview hide/show cycle. Resolve
         * the current primary view from WorkspacesDisplay when needed.
         */
        this._workspacesView = null;
        this._workspacesDisplay = workspacesDisplay;
        this._destroyed = false;

        this._workspaceManager = global.workspace_manager;
        this._injectionManager = new InjectionManager();

        this._settingsChangedIds = [];
    }

    enable() {
        this._destroyed = false;
        this._patchWorkspaceSpacing();

        this._settingsChangedIds.push(
            this._settings.connect("changed::workspaces-scroll-direction", () =>
                this.updateOrientation(),
            ),
        );

        this._settingsChangedIds.push(
            this._settings.connect("changed::workspace-spacing-vertical", () =>
                this._queueWorkspaceRelayout(),
            ),
        );

        this._settingsChangedIds.push(
            this._settings.connect(
                "changed::workspace-spacing-horizontal",
                () => this._queueWorkspaceRelayout(),
            ),
        );

        this.updateOrientation();
    }

    disable() {
        this._destroyed = true;

        for (const id of this._settingsChangedIds)
            this._settings.disconnect(id);

        this._settingsChangedIds = [];

        this._injectionManager.clear();

        this._restoreWorkspaceLayout();
        this._workspacesView = null;
    }

    _getCurrentWorkspacesView() {
        if (this._destroyed)
            return null;

        const views = this._workspacesDisplay?._workspacesViews;
        if (!views?.length)
            return null;

        const primaryIndex = Number.isInteger(
            this._workspacesDisplay?._primaryIndex,
        )
            ? this._workspacesDisplay._primaryIndex
            : 0;

        return views[primaryIndex] ?? views[0] ?? null;
    }

    updateOrientation() {
        if (this._destroyed)
            return;

        const vertical =
            this._settings.get_string("workspaces-scroll-direction") ===
            "vertical";

        this._setWorkspaceLayout(vertical);

        /*
         * Do not rebuild WorkspacesView here. GNOME's WorkspacesDisplay owns
         * that lifecycle. We only need to relayout the current view after the
         * workspace layout direction changes.
         */
        this._getCurrentWorkspacesView()?.queue_relayout();

        this._workspacesDisplay?._updateTrackerOrientation();

        this._queueWorkspaceRelayout();
    }

    _patchWorkspaceSpacing() {
        const controller = this;

        this._injectionManager.overrideMethod(
            WorkspacesView.prototype,
            "_getSpacing",
            () => {
                return function (box, fitMode, vertical) {
                    return controller._getWorkspaceSpacing(vertical);
                };
            },
        );
    }

    _getWorkspaceSpacing(vertical) {
        const key = vertical
            ? "workspace-spacing-vertical"
            : "workspace-spacing-horizontal";

        return this._settings.get_int(key);
    }

    _queueWorkspaceRelayout() {
        if (this._destroyed)
            return;

        const workspacesViews = this._workspacesDisplay?._workspacesViews;

        if (!workspacesViews) return;

        for (const view of workspacesViews) view?.queue_relayout();
    }

    _setWorkspaceLayout(vertical) {
        const manager = this._workspaceManager;

        if (!manager?.override_workspace_layout) return;

        if (vertical) {
            manager.override_workspace_layout(
                Meta.DisplayCorner.TOPLEFT,
                true,
                -1,
                1,
            );
        } else {
            manager.override_workspace_layout(
                Meta.DisplayCorner.TOPLEFT,
                false,
                1,
                -1,
            );
        }
    }

    _restoreWorkspaceLayout() {
        const manager = this._workspaceManager;

        if (!manager?.override_workspace_layout) return;

        manager.override_workspace_layout(
            Meta.DisplayCorner.TOPLEFT,
            false,
            1,
            -1,
        );

        /*
         * The cached WorkspacesView may already be destroyed here. Never touch
         * it during teardown; only update the persistent WorkspacesDisplay.
         */
        this._workspacesDisplay?._updateTrackerOrientation();
        this._queueWorkspaceRelayout();
    }
}
