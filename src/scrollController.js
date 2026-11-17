import Clutter from "gi://Clutter";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class ScrollController {
    constructor(settings, appDisplay, workspacesDisplay, onAppGridPage) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._workspacesDisplay = workspacesDisplay;
        this._onAppGridPage = onAppGridPage;

        this._lastScrollTime = 0;

        this._stageCapturedId = 0;
        this._thumbnailsCapturedId = 0;
    }

    enable() {
        const scrollView = this._appDisplay?._scrollView;

        if (scrollView) {
            this._stageCapturedId = global.stage.connect(
                "captured-event",
                (_actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;

                    if (this._appDisplay?._folderOpen)
                        return Clutter.EVENT_PROPAGATE;

                    if (!this._appDisplay.visible || !this._appDisplay.mapped)
                        return Clutter.EVENT_PROPAGATE;

                    const eventActor = global.stage.get_event_actor(event);

                    const thumbnailsBox = this._getThumbnailsBox();
                    const topBar = this._getTopBar();

                    if (
                        this._isActorInside(eventActor, topBar) ||
                        this._isActorInside(eventActor, thumbnailsBox)
                    ) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    const overviewGroup = Main.layoutManager?.overviewGroup;

                    if (
                        eventActor &&
                        overviewGroup &&
                        !this._isActorInside(eventActor, overviewGroup)
                    ) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    if (!this._pointerIsOverActor(event, scrollView))
                        return Clutter.EVENT_PROPAGATE;

                    if (!this._processScroll(event, "app-grid"))
                        scrollView.event(event, false);

                    return Clutter.EVENT_STOP;
                },
            );
        }

        const thumbnailsBox = this._getThumbnailsBox();

        if (thumbnailsBox) {
            this._thumbnailsCapturedId = thumbnailsBox.connect(
                "captured-event",
                (_actor, event) => {
                    if (event.type() !== Clutter.EventType.SCROLL)
                        return Clutter.EVENT_PROPAGATE;

                    return this._processScroll(event, "workspaces")
                        ? Clutter.EVENT_STOP
                        : Clutter.EVENT_PROPAGATE;
                },
            );
        }
    }

    disable() {
        if (this._stageCapturedId) {
            global.stage.disconnect(this._stageCapturedId);
            this._stageCapturedId = 0;
        }

        const thumbnailsBox = this._getThumbnailsBox();

        if (this._thumbnailsCapturedId && thumbnailsBox) {
            try {
                thumbnailsBox.disconnect(this._thumbnailsCapturedId);
            } catch (_error) {}

            this._thumbnailsCapturedId = 0;
        }
    }

    _getThumbnailsBox() {
        return Main.overview?._overview?._controls?._thumbnailsBox ?? null;
    }

    _getTopBar() {
        return Main.overview?.searchEntry?.get_parent?.() ?? null;
    }

    _isActorInside(actor, ancestor) {
        if (!actor || !ancestor) return false;

        for (let current = actor; current; current = current.get_parent?.()) {
            if (current === ancestor) return true;
        }

        return false;
    }

    _pointerIsOverActor(event, actor) {
        if (!actor?.visible || !actor.mapped) return false;

        const [x, y] = event.get_coords();
        const [actorX, actorY] = actor.get_transformed_position();
        const [actorWidth, actorHeight] = actor.get_transformed_size();

        return (
            x >= actorX &&
            x <= actorX + actorWidth &&
            y >= actorY &&
            y <= actorY + actorHeight
        );
    }

    _processScroll(event, type) {
        const direction = this._settings.get_string(type + "-scroll-direction");

        if (direction === "default") return false;

        const step = this._getScrollStep(event, direction);

        if (step === 0) return false;

        const now = GLib.get_monotonic_time();

        if (now - this._lastScrollTime < 250000) return true;

        this._lastScrollTime = now;

        if (type === "app-grid") this._onAppGridPage(step);
        else this._switchWorkspace(step);

        return true;
    }

    _getScrollStep(event, mode) {
        const scrollDirection = event.get_scroll_direction();

        if (scrollDirection !== Clutter.ScrollDirection.SMOOTH) {
            if (mode === "vertical") {
                if (scrollDirection === Clutter.ScrollDirection.UP) return -1;

                if (scrollDirection === Clutter.ScrollDirection.DOWN) return 1;

                return 0;
            }

            if (scrollDirection === Clutter.ScrollDirection.LEFT) return -1;

            if (scrollDirection === Clutter.ScrollDirection.RIGHT) return 1;

            if (scrollDirection === Clutter.ScrollDirection.UP) return -1;

            if (scrollDirection === Clutter.ScrollDirection.DOWN) return 1;

            return 0;
        }

        const [dx, dy] = event.get_scroll_delta();

        if (dx === 0 && dy === 0) return 0;

        if (mode === "vertical") {
            if (Math.abs(dx) > Math.abs(dy)) return 0;

            return dy > 0 ? 1 : -1;
        }

        const dominantDelta = Math.abs(dx) >= Math.abs(dy) ? dx : dy;

        if (dominantDelta === 0) return 0;

        return dominantDelta > 0 ? 1 : -1;
    }

    _switchWorkspace(step) {
        const workspaceManager = global.workspace_manager;

        const activeIndex = workspaceManager.get_active_workspace_index();

        const nWorkspaces = workspaceManager.get_n_workspaces();

        const newIndex = Math.min(
            Math.max(activeIndex + step, 0),
            nWorkspaces - 1,
        );

        if (newIndex !== activeIndex) {
            workspaceManager
                .get_workspace_by_index(newIndex)
                .activate(global.get_current_time());
        }
    }
}
