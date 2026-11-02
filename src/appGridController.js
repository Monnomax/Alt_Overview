import Clutter from "gi://Clutter";
import St from "gi://St";

export class AppGridController {
    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._origGridOrientation = null;
        this._origDisplayOrientation = null;
        this._origSwipeOrientation = null;
        this._origAdjustment = null;
        this._origHScrollbarPolicy = null;
        this._origVScrollbarPolicy = null;
        this._verticalAdjustmentChangedId = 0;
        this._originalLoadApps = null;
        this._showPinnedAppsChangedId = 0;
    }

    enable() {
        this._patchPinnedApps();
        this._patchOrientation();
    }

    disable() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;
        const scrollView = appDisplay?._scrollView;

        if (this._showPinnedAppsChangedId) {
            this._settings.disconnect(this._showPinnedAppsChangedId);
            this._showPinnedAppsChangedId = 0;
        }

        if (this._initialRedisplaySourceId) {
            GLib.source_remove(this._initialRedisplaySourceId);
            }

        if (appDisplay && this._originalLoadApps) {
            appDisplay._loadApps = this._originalLoadApps;

            if (this._originalAcceptDrop)
                appDisplay.acceptDrop = this._originalAcceptDrop;

            delete appDisplay._showPinnedAppsPatched;
            appDisplay._redisplay?.();
        }

        this._originalLoadApps = null;
        this._originalAcceptDrop = null;

        if (this._verticalAdjustmentChangedId) {
            scrollView.vadjustment.disconnect(
                this._verticalAdjustmentChangedId,
            );
            this._verticalAdjustmentChangedId = 0;
        }
        if (!grid?._verticalPatched || !scrollView) return;

        delete grid._verticalPatched;
        grid.layout_manager.orientation = this._origGridOrientation;
        appDisplay._orientation = this._origDisplayOrientation;
        if (appDisplay._swipeTracker)
            appDisplay._swipeTracker.orientation = this._origSwipeOrientation;
        appDisplay._adjustment = this._origAdjustment;
        scrollView.hscrollbar_policy = this._origHScrollbarPolicy;
        scrollView.vscrollbar_policy = this._origVScrollbarPolicy;
        grid.queue_relayout();
    }

    _patchPinnedApps() {
        const appDisplay = this._appDisplay;
        if (!appDisplay || typeof appDisplay._loadApps !== "function") return;
        if (appDisplay._showPinnedAppsPatched) return;

        this._originalLoadApps = appDisplay._loadApps;
        this._originalAcceptDrop = appDisplay.acceptDrop;

        const controller = this;

        appDisplay._loadApps = function (...args) {
            if (!controller._settings.get_boolean("show-pinned-apps"))
                return controller._originalLoadApps.apply(this, args);

            const originalFavorites = this._appFavorites;
            this._appFavorites = { isFavorite: () => false };

            try {
                return controller._originalLoadApps.apply(this, args);
            } finally {
                this._appFavorites = originalFavorites;
            }
        };

        if (typeof this._originalAcceptDrop === "function") {
            appDisplay.acceptDrop = function (source, ...args) {
                if (
                    controller._settings.get_boolean("show-pinned-apps") &&
                    controller._isAppGridDrag(source)
                ) {
                    const originalFavorites = this._appFavorites;
                    this._appFavorites = { isFavorite: () => false };

                    try {
                        return controller._originalAcceptDrop.call(
                            this,
                            source,
                            ...args,
                        );
                    } finally {
                        this._appFavorites = originalFavorites;
                    }
                }

                return controller._originalAcceptDrop.call(
                    this,
                    source,
                    ...args,
                );
            };
        }

        appDisplay._showPinnedAppsPatched = true;

        this._showPinnedAppsChangedId = this._settings.connect(
            "changed::show-pinned-apps",
            () => appDisplay._redisplay?.(),
        );
    }

    _isAppGridDrag(source) {
        if (!source) return false;

        const appDisplay = this._appDisplay;

        for (
            let actor = source;
            actor;
            actor = actor.get_parent?.()
        ) {
            if (actor === appDisplay)
                return true;

            if (actor === appDisplay?._grid)
                return true;
        }

        return false;
    }

    _syncPageIndicators() {
        const appDisplay = this._appDisplay;
        const adjustment = appDisplay?._adjustment;
        const pageIndicators = appDisplay?._pageIndicators;

        if (!adjustment || !pageIndicators) return;

        if (adjustment.page_size <= 0) return;

        const value = adjustment.value / adjustment.page_size;

        if (typeof pageIndicators.setCurrentPosition === "function")
            pageIndicators.setCurrentPosition(value);
    }

    updateOrientation() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;
        const scrollView = appDisplay?._scrollView;
        if (!grid?._verticalPatched || !scrollView) return;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";
        grid.layout_manager.orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : this._origGridOrientation;
        appDisplay._orientation = vertical
            ? Clutter.Orientation.VERTICAL
            : this._origDisplayOrientation;
        if (appDisplay._swipeTracker)
            appDisplay._swipeTracker.orientation = vertical
                ? Clutter.Orientation.VERTICAL
                : this._origSwipeOrientation;
        appDisplay._adjustment = vertical
            ? scrollView.vadjustment
            : this._origAdjustment;
        if (this._verticalAdjustmentChangedId) {
            scrollView.vadjustment.disconnect(
                this._verticalAdjustmentChangedId,
            );
            this._verticalAdjustmentChangedId = 0;
        }

        if (vertical) {
            this._verticalAdjustmentChangedId = scrollView.vadjustment.connect(
                "notify::value",
                () => this._syncPageIndicators(),
            );

            this._syncPageIndicators();
        }
        scrollView.vscrollbar_policy = vertical
            ? St.PolicyType.EXTERNAL
            : this._origVScrollbarPolicy;

        const nPages =
            typeof grid.nPages === "function"
                ? grid.nPages()
                : (grid.nPages ?? 0);
        if (nPages > 0) {
            const targetPage = Math.min(grid.currentPage ?? 0, nPages - 1);
            grid.goToPage(targetPage, false);
        }
        grid.queue_relayout();
    }

    goToPage(step) {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;
        if (!grid) return;

        const currentPage = grid.currentPage ?? 0;
        const nPages =
            typeof grid.nPages === "function"
                ? grid.nPages()
                : (grid.nPages ?? 1);
        if (nPages <= 0) return;

        const newPage = Math.min(Math.max(currentPage + step, 0), nPages - 1);
        if (
            newPage !== currentPage &&
            typeof appDisplay.goToPage === "function"
        )
            appDisplay.goToPage(newPage);
    }

    _patchOrientation() {
        const grid = this._appDisplay?._grid;
        const scrollView = this._appDisplay?._scrollView;
        if (!grid || !scrollView || grid._verticalPatched) return;

        this._origGridOrientation = grid.layout_manager.orientation;
        this._origDisplayOrientation = this._appDisplay._orientation;
        this._origSwipeOrientation =
            this._appDisplay._swipeTracker?.orientation;
        this._origAdjustment = this._appDisplay._adjustment;
        this._origHScrollbarPolicy = scrollView.hscrollbar_policy;
        this._origVScrollbarPolicy = scrollView.vscrollbar_policy;
        grid._verticalPatched = true;
        this.updateOrientation();
    }
}
