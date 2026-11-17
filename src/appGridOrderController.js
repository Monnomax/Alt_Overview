import GLib from "gi://GLib";
import Shell from "gi://Shell";

const ORDER_MODES = [
    "manual",
    "name-ascending",
    "name-descending",
    "usage",
    "last-used",
];

export class AppGridOrderController {
    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._appSystem = Shell.AppSystem.get_default();
        this._originalLoadApps = null;
        this._originalRedisplay = null;
        this._originalSavePages = null;
        this._originalMaybeMoveItem = null;
        this._originalAcceptDrop = null;
        this._originalCreateFolder = null;

        this._settingsChangedId = 0;
        this._appStateChangedId = 0;
        this._originalGetItemPosition = null;

        this._patchedGetItemPosition = null;
        this._patchedRedisplay = null;
        this._patchedSavePages = null;
        this._patchedMaybeMoveItem = null;
        this._patchedAcceptDrop = null;
        this._patchedCreateFolder = null;

        this._targetPositions = null;
    }

    enable() {
        const appDisplay = this._appDisplay;
        const appSystem = this._appSystem;
        if (
            !appDisplay ||
            !appSystem ||
            typeof appDisplay._loadApps !== "function" ||
            typeof appDisplay._getItemPosition !== "function" ||
            typeof appDisplay._redisplay !== "function" ||
            typeof appDisplay._savePages !== "function" ||
            typeof appDisplay._maybeMoveItem !== "function" ||
            typeof appDisplay.acceptDrop !== "function" ||
            typeof appDisplay.createFolder !== "function"
        )
            return;

        this._originalLoadApps = appDisplay._loadApps;
        this._originalGetItemPosition = appDisplay._getItemPosition;
        this._originalRedisplay = appDisplay._redisplay;
        this._originalSavePages = appDisplay._savePages;
        this._originalMaybeMoveItem = appDisplay._maybeMoveItem;
        this._originalAcceptDrop = appDisplay.acceptDrop;
        this._originalCreateFolder = appDisplay.createFolder;

        const controller = this;

        appDisplay._getItemPosition = function (item) {
            if (item === this._placeholder)
                return controller._originalGetItemPosition.call(this, item);

            const target = controller._targetPositions?.get(item);

            if (target) return target;

            return controller._originalGetItemPosition.call(this, item);
        };

        appDisplay._redisplay = function (...args) {
            if (controller._getOrderMode() === "manual")
                return controller._originalRedisplay.apply(this, args);

            const compareItems = controller._createComparator();
            const items = controller._originalLoadApps
                .call(this)
                .sort(compareItems);

            const itemsPerPage = this._grid.itemsPerPage;

            if (!Number.isFinite(itemsPerPage) || itemsPerPage <= 0)
                return controller._originalRedisplay.apply(this, args);

            const originalLoadApps = this._loadApps;

            try {
                controller._targetPositions = new Map();

                items.forEach((item, index) => {
                    const page = Math.floor(index / itemsPerPage);
                    const position = index % itemsPerPage;

                    controller._targetPositions.set(item, [page, position]);
                });

                this._loadApps = function () {
                    return items;
                };

                return controller._originalRedisplay.apply(this, args);
            } finally {
                this._loadApps = originalLoadApps;
                controller._targetPositions = null;
            }
        };

        appDisplay._savePages = function (...args) {
            if (controller._getOrderMode() !== "manual") return;

            return controller._originalSavePages.apply(this, args);
        };

        appDisplay._maybeMoveItem = function (...args) {
            if (controller._getOrderMode() !== "manual" && !this._placeholder) {
                this._removeDelayedMove?.();
                return;
            }

            return controller._originalMaybeMoveItem.apply(this, args);
        };

        appDisplay.acceptDrop = function (source, ...args) {
            if (controller._getOrderMode() !== "manual") {
                delete this._dropTarget;
                this._removeDelayedMove?.();
            }

            return controller._originalAcceptDrop.call(this, source, ...args);
        };

        appDisplay.createFolder = function (...args) {
            const result = controller._originalCreateFolder.apply(this, args);

            if (result && controller._getOrderMode() !== "manual")
                controller._refreshAppGrid();

            return result;
        };

        this._patchedGetItemPosition = appDisplay._getItemPosition;
        this._patchedRedisplay = appDisplay._redisplay;
        this._patchedSavePages = appDisplay._savePages;
        this._patchedMaybeMoveItem = appDisplay._maybeMoveItem;
        this._patchedAcceptDrop = appDisplay.acceptDrop;
        this._patchedCreateFolder = appDisplay.createFolder;

        this._settingsChangedId = this._settings.connect(
            "changed::app-grid-order",
            () => controller._refreshAppGrid(),
        );

        const appSystemChanged = (system, app) => {
            if (!app || app.state !== Shell.AppState.RUNNING) return;

            const appId = controller._getAppId(app);
            if (!appId) return;

            const counts = controller._getDictionary("app-grid-launch-counts");
            counts[appId] = (counts[appId] ?? 0) + 1;
            controller._settings.set_value(
                "app-grid-launch-counts",
                new GLib.Variant("a{si}", counts),
            );

            const lastUsed = controller._getDictionary("app-grid-last-used");
            lastUsed[appId] = Math.floor(Date.now() / 1000);
            controller._settings.set_value(
                "app-grid-last-used",
                new GLib.Variant("a{sx}", lastUsed),
            );

            const mode = controller._getOrderMode();

            if (mode === "usage" || mode === "last-used")
                appDisplay._redisplay?.();
        };

        this._appStateChangedId = appSystem.connect(
            "app-state-changed",
            appSystemChanged,
        );
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._appStateChangedId && this._appSystem) {
            this._appSystem.disconnect(this._appStateChangedId);
            this._appStateChangedId = 0;
        }

        const appDisplay = this._appDisplay;

        if (appDisplay) {
            if (appDisplay._getItemPosition === this._patchedGetItemPosition)
                appDisplay._getItemPosition = this._originalGetItemPosition;

            if (appDisplay._redisplay === this._patchedRedisplay)
                appDisplay._redisplay = this._originalRedisplay;

            if (appDisplay._savePages === this._patchedSavePages)
                appDisplay._savePages = this._originalSavePages;

            if (appDisplay._maybeMoveItem === this._patchedMaybeMoveItem)
                appDisplay._maybeMoveItem = this._originalMaybeMoveItem;

            if (appDisplay.acceptDrop === this._patchedAcceptDrop)
                appDisplay.acceptDrop = this._originalAcceptDrop;

            if (appDisplay.createFolder === this._patchedCreateFolder)
                appDisplay.createFolder = this._originalCreateFolder;
        }

        this._originalLoadApps = null;
        this._originalGetItemPosition = null;
        this._originalRedisplay = null;
        this._originalSavePages = null;
        this._originalMaybeMoveItem = null;
        this._originalAcceptDrop = null;
        this._originalCreateFolder = null;

        this._patchedGetItemPosition = null;
        this._patchedRedisplay = null;
        this._patchedSavePages = null;
        this._patchedMaybeMoveItem = null;
        this._patchedAcceptDrop = null;
        this._patchedCreateFolder = null;

        this._targetPositions = null;
    }

    _getOrderMode() {
        const mode = this._settings.get_string("app-grid-order");
        return ORDER_MODES.includes(mode) ? mode : "manual";
    }

    _createComparator() {
        const mode = this._getOrderMode();

        const counts =
            mode === "usage"
                ? this._getDictionary("app-grid-launch-counts")
                : {};

        const lastUsed =
            mode === "last-used"
                ? this._getDictionary("app-grid-last-used")
                : {};

        const metrics = new Map();

        const getMetrics = (item) => {
            if (metrics.has(item)) return metrics.get(item);

            const appIds = this._getItemIds(item);

            const itemMetrics = {
                usage: appIds.reduce(
                    (total, id) => total + (counts[id] ?? 0),
                    0,
                ),
                lastUsed: appIds.reduce(
                    (latest, id) => Math.max(latest, lastUsed[id] ?? 0),
                    0,
                ),
            };

            metrics.set(item, itemMetrics);
            return itemMetrics;
        };

        return (left, right) => {
            if (mode === "usage")
                return (
                    getMetrics(right).usage - getMetrics(left).usage ||
                    this._compareNames(left, right)
                );

            if (mode === "last-used")
                return (
                    getMetrics(right).lastUsed - getMetrics(left).lastUsed ||
                    this._compareNames(left, right)
                );

            const nameOrder = this._compareNames(left, right);
            return mode === "name-descending" ? -nameOrder : nameOrder;
        };
    }

    _refreshAppGrid() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        appDisplay._redisplay?.();
        const grid = appDisplay._grid;

        if (!grid) return;

        grid.queue_relayout?.();
    }

    _getItemIds(item) {
        if (item.app) {
            const appId = this._getAppId(item.app);
            return appId ? [appId] : [];
        }

        if (typeof item.getAppIds === "function") return item.getAppIds();

        return [];
    }

    _compareNames(left, right) {
        return this._getItemName(left).localeCompare(
            this._getItemName(right),
            undefined,
            {
                sensitivity: "base",
                numeric: true,
            },
        );
    }

    _getAppName(app) {
        return (
            app.get_name?.() ?? app.get_app_info?.()?.get_display_name?.() ?? ""
        );
    }

    _getAppId(app) {
        return app.get_id?.() ?? app.get_app_info?.()?.get_id?.() ?? "";
    }

    _getItemName(item) {
        return item.name ?? this._getAppName(item.app);
    }

    _getDictionary(key) {
        return this._settings.get_value(key).deep_unpack();
    }
}
