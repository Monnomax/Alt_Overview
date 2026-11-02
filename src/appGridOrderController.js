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
        this._originalCompareItems = null;
        this._originalLoadApps = null;
        this._originalRedisplay = null;
        this._isRedisplaying = false;
        this._isDragging = false;
        this._settingsChangedId = 0;
        this._appStateChangedId = 0;
        this._originalGetItemPosition = null;

        this._targetPositions = null;
    }

    enable() {
        const appDisplay = this._appDisplay;
        const appSystem = this._appSystem;
        if (
            !appDisplay ||
            !appSystem ||
            typeof appDisplay._compareItems !== "function" ||
            typeof appDisplay._loadApps !== "function" ||
            typeof appDisplay._getItemPosition !== "function" ||
            typeof appDisplay._redisplay !== "function"
        )
            return;

        this._originalCompareItems = appDisplay._compareItems;
        this._originalLoadApps = appDisplay._loadApps;
        this._originalGetItemPosition = appDisplay._getItemPosition;
        this._originalRedisplay = appDisplay._redisplay;
        const controller = this;

        appDisplay._getItemPosition = function (item) {
            const target = controller._targetPositions?.get(item);

            if (target) return target;

            return controller._originalGetItemPosition.call(this, item);
        };

        appDisplay._redisplay = function (...args) {
            if (controller._getOrderMode() === "manual")
                return controller._originalRedisplay.apply(this, args);

            const items = controller._originalLoadApps
                .call(this)
                .sort(controller._compareOrderedItems.bind(controller));

            const itemsPerPage = this._grid.itemsPerPage;

            if (!Number.isFinite(itemsPerPage) || itemsPerPage <= 0)
                return controller._originalRedisplay.apply(this, args);

            controller._targetPositions = new Map();

            items.forEach((item, index) => {
                const page = Math.floor(index / itemsPerPage);
                const position = index % itemsPerPage;

                controller._targetPositions.set(item, [page, position]);
            });

            /*
             * Native AppDisplay._redisplay() calls this._loadApps() again.
             * Reuse exactly the same AppIcon objects that were used above,
             * otherwise _targetPositions contains different object identities.
             */
            const originalLoadApps = this._appDisplay._loadApps;

            this._appDisplay._loadApps = function () {
                return items;
            };

            try {
                return controller._originalRedisplay.apply(this, args);
            } finally {
                this._appDisplay._loadApps = originalLoadApps;
                controller._targetPositions = null;
            }
        };

        if (controller._getOrderMode() !== "manual") {
            appDisplay._compareItems = function (left, right) {
                return controller._compareOrderedItems(left, right);
            };
        }

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

            if (
                controller._getOrderMode() === "usage" ||
                controller._getOrderMode() === "last-used"
            )
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

        if (
            this._appDisplay &&
            this._originalGetItemPosition &&
            this._appDisplay._getItemPosition !== this._originalGetItemPosition
        )
            this._appDisplay._getItemPosition = this._originalGetItemPosition;

        if (
            this._appDisplay &&
            this._originalRedisplay &&
            this._appDisplay._redisplay !== this._originalRedisplay
        )
            this._appDisplay._redisplay = this._originalRedisplay;

        if (
            this._appDisplay &&
            this._originalCompareItems &&
            this._appDisplay._compareItems !== this._originalCompareItems
        )
            this._appDisplay._compareItems = this._originalCompareItems;

        this._originalCompareItems = null;
        this._originalLoadApps = null;
        this._originalGetItemPosition = null;
        this._originalRedisplay = null;
        this._targetPositions = null;
    }

    _getOrderMode() {
        const mode = this._settings.get_string("app-grid-order");
        return ORDER_MODES.includes(mode) ? mode : "manual";
    }

    _compareOrderedItems(left, right) {
        const mode = this._getOrderMode();
        if (mode === "manual") return this._compareManualItems(left, right);

        const counts = this._getDictionary("app-grid-launch-counts");
        const lastUsed = this._getDictionary("app-grid-last-used");
        const leftId = this._getItemId(left);
        const rightId = this._getItemId(right);

        if (mode === "usage")
            return (
                (counts[rightId] ?? 0) - (counts[leftId] ?? 0) ||
                this._compareNames(left, right)
            );

        if (mode === "last-used")
            return (
                (lastUsed[rightId] ?? 0) - (lastUsed[leftId] ?? 0) ||
                this._compareNames(left, right)
            );

        const nameOrder = this._compareNames(left, right);
        return mode === "name-descending" ? -nameOrder : nameOrder;
    }

    _compareManualItems(left, right) {
        const order = this._getManualOrder();
        const leftId = this._getItemId(left);
        const rightId = this._getItemId(right);
        const leftPosition = leftId ? order.indexOf(leftId) : -1;
        const rightPosition = rightId ? order.indexOf(rightId) : -1;

        if (leftPosition >= 0 && rightPosition >= 0)
            return leftPosition - rightPosition;
        if (leftPosition >= 0) return -1;
        if (rightPosition >= 0) return 1;

        return this._compareNames(left, right);
    }

    _getManualOrder() {
        return this._settings.get_strv("app-grid-manual-order");
    }

    _setManualOrder(order) {
        this._settings.set_strv("app-grid-manual-order", order);
        this._refreshAppGrid();
    }

    _saveCurrentManualOrder() {
        if (!this._isDragging) return;

        const items = this._appDisplay?._orderedItems;

        if (!items?.length) return;

        const order = items
            .map((item) => this._getItemId(item))
            .filter(Boolean);

        if (!order.length) return;

        const currentOrder = this._getManualOrder();

        if (order.join("\n") === currentOrder.join("\n")) return;

        this._settings.set_strv("app-grid-manual-order", order);
    }

    _normalizeManualOrder(items) {
        const availableIds = items
            .map((item) => this._getItemId(item))
            .filter(Boolean);
        const availableSet = new Set(availableIds);
        const currentOrder = this._getManualOrder();
        const normalizedOrder = [];
        const normalizedSet = new Set();

        for (const id of currentOrder) {
            if (availableSet.has(id) && !normalizedSet.has(id)) {
                normalizedOrder.push(id);
                normalizedSet.add(id);
            }
        }

        for (const id of availableIds) {
            if (!normalizedSet.has(id)) {
                normalizedOrder.push(id);
                normalizedSet.add(id);
            }
        }

        if (normalizedOrder.join("\n") !== currentOrder.join("\n"))
            this._settings.set_strv("app-grid-manual-order", normalizedOrder);

        return normalizedOrder;
    }

    moveItem(itemId, targetIndex) {
        const order = this._getManualOrder().filter((id) => id !== itemId);
        const index = Math.max(0, Math.min(targetIndex, order.length));
        order.splice(index, 0, itemId);
        this._setManualOrder(order);
    }

    resetManualOrder() {
        this._settings.reset("app-grid-manual-order");
        this._refreshAppGrid();
    }

    _refreshAppGrid() {
        const appDisplay = this._appDisplay;

        if (!appDisplay) return;

        appDisplay._redisplay?.();
        const grid = appDisplay._grid;

        if (!grid) return;

        grid.queue_relayout?.();
    }

    _getItemId(item) {
        return item.app ? this._getAppId(item.app) : "";
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
