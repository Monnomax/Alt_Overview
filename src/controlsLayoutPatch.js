import Clutter from "gi://Clutter";

import { ControlsState } from "resource:///org/gnome/shell/ui/overviewControls.js";

const PAGE_WORKSPACE_SCALE = 0.765625;

export class ControlsLayoutPatch {
    constructor(settings, layoutManager, controls, hasMultipleWorkspaces) {
        this._settings = settings;
        this._layoutManager = layoutManager;
        this._controls = controls;
        this._hasMultipleWorkspaces = hasMultipleWorkspaces;

        this._originalComputeWorkspacesBoxForState = null;
        this._originalGetAppDisplayBoxForState = null;
        this._originalGetThumbnailsBoxParams = null;
        this._originalUpdateThumbnailsBox = null;
    }

    enable() {
        this._patch();
    }

    disable() {
        this._unpatch();
    }

    updateThumbnailsBox() {
        const controls = this._controls;
        const thumbnailsBox = controls?._thumbnailsBox;

        if (
            !controls ||
            controls.is_destroyed?.() ||
            !thumbnailsBox ||
            thumbnailsBox.is_destroyed?.() ||
            typeof controls._updateThumbnailsBox !== "function"
        )
            return;

        controls._updateThumbnailsBox(false);
    }

    _setWorkspaceSize(workspaceBox, workAreaBox) {
        if (!workspaceBox || !workAreaBox) return;

        const width = workAreaBox.get_width();
        const height = workAreaBox.get_height();
        if (
            ![width, height, workAreaBox.x1, workAreaBox.y1].every(
                Number.isFinite,
            ) ||
            width <= 0 ||
            height <= 0
        )
            return;

        const userSize = this._settings.get_int("workspace-size");
        const scale = PAGE_WORKSPACE_SCALE * (1 + userSize / 500);
        const workspaceWidth = width * scale;
        const workspaceHeight = height * scale;
        const x = workAreaBox.x1 + (width - workspaceWidth) / 2;
        const y = workAreaBox.y1 + (height - workspaceHeight) / 2;

        if (
            ![userSize, scale, workspaceWidth, workspaceHeight, x, y].every(
                Number.isFinite,
            ) ||
            scale <= 0 ||
            workspaceWidth <= 0 ||
            workspaceHeight <= 0
        )
            return;

        workspaceBox.set_origin(x, y);
        workspaceBox.set_size(workspaceWidth, workspaceHeight);
    }

    _patch() {
        if (!this._layoutManager || this._layoutManager._chAppGridPatched)
            return;

        this._originalComputeWorkspacesBoxForState =
            this._layoutManager._computeWorkspacesBoxForState;
        this._originalGetAppDisplayBoxForState =
            this._layoutManager._getAppDisplayBoxForState;
        this._originalGetThumbnailsBoxParams =
            this._controls._getThumbnailsBoxParams;
        this._originalUpdateThumbnailsBox = this._controls._updateThumbnailsBox;

        const patch = this;

        this._controls._updateThumbnailsBox = function (...args) {
            const thumbnailsBox = this._thumbnailsBox;

            if (
                this.is_destroyed?.() ||
                !thumbnailsBox ||
                thumbnailsBox.is_destroyed?.()
            )
                return;

            patch._originalUpdateThumbnailsBox.apply(this, args);

            if (
                this._thumbnailsBox !== thumbnailsBox ||
                thumbnailsBox.is_destroyed?.()
            )
                return;

            const show =
                (patch._settings?.get_boolean("show-workspaces-thumbnails") ??
                    true) &&
                patch._hasMultipleWorkspaces();

            const [opacity, scale, translationY] =
                this._getThumbnailsBoxParams();

            if (!show || opacity === 0) {
                thumbnailsBox.visible = false;
                thumbnailsBox.opacity = 0;
                thumbnailsBox.expandFraction = show ? 1 : 0;
                return;
            }

            thumbnailsBox.visible = true;
            thumbnailsBox.opacity = opacity;
            thumbnailsBox.scale_x = scale;
            thumbnailsBox.scale_y = scale;
            thumbnailsBox.translation_y = translationY;
            thumbnailsBox.expandFraction = 1;
        };

        this._layoutManager._computeWorkspacesBoxForState = function (
            state,
            ...args
        ) {
            const workspaceBox =
                patch._originalComputeWorkspacesBoxForState.call(
                    this,
                    state,
                    ...args,
                );

            const workAreaBox = args.find(
                (arg) =>
                    arg &&
                    typeof arg.get_width === "function" &&
                    typeof arg.get_height === "function" &&
                    Number.isFinite(arg.x1) &&
                    Number.isFinite(arg.y1) &&
                    Number.isFinite(arg.x2) &&
                    Number.isFinite(arg.y2),
            );

            if (state === ControlsState.WINDOW_PICKER && workAreaBox)
                patch._setWorkspaceSize(workspaceBox, workAreaBox);

            if (
                state === ControlsState.APP_GRID &&
                workspaceBox &&
                workAreaBox
            ) {
                const x = workAreaBox.x2 + 1000000;
                const y = workAreaBox.y2 + 1000000;
                if ([x, y].every(Number.isFinite)) {
                    workspaceBox.set_origin(x, y);
                }
            }

            return workspaceBox;
        };

        this._layoutManager._getAppDisplayBoxForState = function (
            state,
            ...args
        ) {
            const appDisplayBox = patch._originalGetAppDisplayBoxForState.call(
                this,
                state,
                ...args,
            );

            if (state === ControlsState.APP_GRID && appDisplayBox) {
                const layoutBox = args[0];
                const layoutWidth = layoutBox?.get_width?.();
                if (
                    [layoutBox?.x1, layoutBox?.y2, layoutWidth].every(
                        Number.isFinite,
                    ) &&
                    layoutWidth > 0 &&
                    layoutBox.y2 > 0
                ) {
                    appDisplayBox.set_origin(layoutBox.x1, 0);
                    appDisplayBox.set_size(layoutWidth, layoutBox.y2);
                }
            }

            if (state !== ControlsState.APP_GRID && appDisplayBox) {
                const direction = patch._settings.get_string(
                    "app-grid-animation-direction",
                );
                if (direction !== "bottom-to-top") {
                    const layoutBox = args[0];
                    const width = layoutBox?.get_width?.();
                    const height = layoutBox?.y2;
                    if (
                        [layoutBox?.x1, layoutBox?.x2, width, height].every(
                            Number.isFinite,
                        ) &&
                        width > 0 &&
                        height > 0 &&
                        layoutBox.x2 > layoutBox.x1
                    ) {
                        let x = layoutBox.x1;
                        let y = 0;

                        switch (direction) {
                            case "left-to-right":
                                x = layoutBox.x1 - width;
                                break;
                            case "top-to-bottom":
                                y = -height;
                                break;
                            case "right-to-left":
                                x = layoutBox.x2;
                                break;
                            case "grow-in-place":
                                break;
                            default:
                                return appDisplayBox;
                        }

                        appDisplayBox.set_origin(x, y);
                        appDisplayBox.set_size(width, height);
                    }
                }
            }

            return appDisplayBox;
        };

        if (this._controls && this._originalGetThumbnailsBoxParams) {
            this._controls._getThumbnailsBoxParams = function () {
                const { initialState, finalState, progress } =
                    this._stateAdjustment.getStateTransitionParams();
                const safeProgress = Number.isFinite(progress)
                    ? Math.max(0, Math.min(1, progress))
                    : 1;

                const paramsForState = (state) => {
                    if (
                        state === ControlsState.HIDDEN ||
                        !patch._settings.get_boolean(
                            "show-workspaces-thumbnails",
                        ) ||
                        !patch._hasMultipleWorkspaces()
                    ) {
                        return {
                            opacity: 0,
                            scale: 1,
                            translationY: 0,
                        };
                    }

                    return {
                        opacity: 255,
                        scale: 1,
                        translationY: 0,
                    };
                };

                const initial = paramsForState(initialState);
                const final = paramsForState(finalState);
                const lerp = (a, b) => a + (b - a) * safeProgress;

                const values = [
                    lerp(initial.opacity, final.opacity),
                    lerp(initial.scale, final.scale),
                    lerp(initial.translationY, final.translationY),
                ];
                return values.map((value) =>
                    Number.isFinite(value) ? value : 0,
                );
            };
        }

        this._layoutManager._chAppGridPatched = true;
    }

    _unpatch() {
        if (!this._layoutManager) return;

        if (this._originalComputeWorkspacesBoxForState) {
            this._layoutManager._computeWorkspacesBoxForState =
                this._originalComputeWorkspacesBoxForState;
        }

        if (this._originalGetAppDisplayBoxForState) {
            this._layoutManager._getAppDisplayBoxForState =
                this._originalGetAppDisplayBoxForState;
        }

        if (this._controls && this._originalGetThumbnailsBoxParams) {
            this._controls._getThumbnailsBoxParams =
                this._originalGetThumbnailsBoxParams;
        }

        if (this._controls && this._originalUpdateThumbnailsBox) {
            this._controls._updateThumbnailsBox =
                this._originalUpdateThumbnailsBox;
        }

        delete this._layoutManager._chAppGridPatched;

        this._originalComputeWorkspacesBoxForState = null;
        this._originalGetAppDisplayBoxForState = null;
        this._originalGetThumbnailsBoxParams = null;
        this._originalUpdateThumbnailsBox = null;
    }
}
