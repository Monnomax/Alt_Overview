import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import * as IconGrid from "resource:///org/gnome/shell/ui/iconGrid.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const DELAYED_MOVE_TIMEOUT = 100;
const REORDER_EDGE_ZONE = 60;

export class DndManager {
    constructor(appDisplay, diagnostics = null) {
        this._appDisplay = appDisplay;
        this._diagnostics = diagnostics;

        this._originalMaybeMoveItem = null;
        this._originalGetDropTarget = null;
        this._originalMoveItem = null;

        this._patchedItems = new Map();

        this._pagesChangedId = 0;
        this._dragBeginId = 0;
        this._dragEndId = 0;

        this._lastDropTargetDiagnostic = null;

        this._enabled = false;
    }

    enable() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (
            !appDisplay ||
            !grid ||
            typeof appDisplay._maybeMoveItem !== "function" ||
            typeof appDisplay._getDropTarget !== "function" ||
            typeof appDisplay._moveItem !== "function"
        ) {
            this._diagnostics?.warning(
                "dnd",
                "Cannot enable DnD manager: required AppDisplay methods are missing",
            );

            return false;
        }

        if (this._enabled) return true;

        this._originalGetDropTarget = appDisplay._getDropTarget;

        const manager = this;

        appDisplay._getDropTarget = function (x, y, source) {
            return manager._getDropTarget(this, x, y, source);
        };

        this._patchAllItems();

        if (typeof grid.connect === "function") {
            this._pagesChangedId = grid.connect("pages-changed", () => {
                this._patchAllItems();
            });
        }

        this._dragBeginId = Main.overview.connect("item-drag-begin", () => {
            this._lastDropTargetDiagnostic = null;
            this._patchAllItems();
        });

        this._dragEndId = Main.overview.connect("item-drag-end", () => {
            appDisplay._removeDelayedMove?.();
        });

        this._enabled = true;

        this._diagnostics?.event(
            "dnd",
            "DnD manager enabled",
            {
                reorderEdgeZone: REORDER_EDGE_ZONE,
            },
            "verbose",
        );

        return true;
    }

    disable() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (this._dragBeginId) {
            try {
                Main.overview.disconnect(this._dragBeginId);
            } catch {}

            this._dragBeginId = 0;
        }

        if (this._dragEndId) {
            try {
                Main.overview.disconnect(this._dragEndId);
            } catch {}

            this._dragEndId = 0;
        }

        if (this._pagesChangedId && grid) {
            try {
                grid.disconnect(this._pagesChangedId);
            } catch {}

            this._pagesChangedId = 0;
        }

        for (const [item, originalWithinLeeways] of this._patchedItems) {
            if (
                item &&
                !item.is_destroyed?.() &&
                typeof originalWithinLeeways === "function"
            ) {
                item._withinLeeways = originalWithinLeeways;
            }
        }

        this._patchedItems.clear();

        if (appDisplay) {
            if (
                this._originalGetDropTarget &&
                appDisplay._getDropTarget !== this._originalGetDropTarget
            ) {
                appDisplay._getDropTarget = this._originalGetDropTarget;
            }

            try {
                appDisplay._removeDelayedMove?.();
            } catch (error) {
                this._diagnostics?.error(
                    "dnd",
                    "Failed to clear delayed move",
                    error,
                );
            }
        }

        this._originalGetDropTarget = null;

        this._lastDropTargetDiagnostic = null;

        this._enabled = false;

        this._diagnostics?.event("dnd", "DnD manager disabled", {}, "verbose");
    }

    _patchAllItems() {
        const grid = this._appDisplay?._grid;

        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);

            this._patchItem(item);
        }
    }

    _patchItem(item) {
        if (!item || item.is_destroyed?.()) return;

        if (typeof item._withinLeeways !== "function") {
            return;
        }

        if (this._patchedItems.has(item)) return;

        const originalWithinLeeways = item._withinLeeways;

        this._patchedItems.set(item, originalWithinLeeways);

        item._withinLeeways = function (x) {
            return x < REORDER_EDGE_ZONE || x > this.width - REORDER_EDGE_ZONE;
        };
    }

    _getEffectiveDragSource(appDisplay, source) {
        const placeholder = appDisplay?._placeholder;

        if (
            placeholder &&
            source &&
            placeholder.id === source.id &&
            !placeholder.is_destroyed?.()
        ) {
            return placeholder;
        }

        return source;
    }

    _getDropTarget(appDisplay, x, y, source) {
        const grid = appDisplay?._grid;

        if (!grid || !Number.isFinite(x) || !Number.isFinite(y)) {
            return [0, 0, IconGrid.DragLocation.INVALID];
        }

        const [sourcePage, sourcePosition] = grid.getItemPosition(source);

        const [rawTargetPage, rawTargetPosition, rawDragLocation] =
            grid.getDropTarget(x, y);

        if (
            !Number.isInteger(rawTargetPage) ||
            !Number.isInteger(rawTargetPosition) ||
            rawTargetPosition < -1
        ) {
            return [0, 0, IconGrid.DragLocation.INVALID];
        }

        let targetPage = rawTargetPage;

        let targetPosition = rawTargetPosition;

        let dragLocation = rawDragLocation;

        /*
         * Keep GNOME 50's EMPTY_SPACE sentinel.
         *
         * -1 means "append".
         * It must not be converted to the last icon position.
         */

        /*
         * Extend the native horizontal edge zone.
         *
         * GNOME determines START_EDGE / END_EDGE using X even when
         * the grid orientation is vertical. We intentionally keep
         * that behavior.
         */
        if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.ON_ICON
        ) {
            const item = grid.getItemAt(targetPage, targetPosition);

            const box = item?.allocation;

            if (box) {
                if (x < box.x1 + REORDER_EDGE_ZONE) {
                    dragLocation = IconGrid.DragLocation.START_EDGE;
                } else if (x > box.x2 - REORDER_EDGE_ZONE) {
                    dragLocation = IconGrid.DragLocation.END_EDGE;
                }
            }
        }

        const isRtl =
            Clutter.get_default_text_direction() === Clutter.TextDirection.RTL;

        if (isRtl) {
            if (dragLocation === IconGrid.DragLocation.START_EDGE) {
                dragLocation = IconGrid.DragLocation.END_EDGE;
            } else if (dragLocation === IconGrid.DragLocation.END_EDGE) {
                dragLocation = IconGrid.DragLocation.START_EDGE;
            }
        }

        let reflowDirection = Clutter.ActorAlign.END;

        if (sourcePosition === targetPosition) {
            reflowDirection = -1;
        }

        if (sourcePage === targetPage && sourcePosition < targetPosition) {
            reflowDirection = Clutter.ActorAlign.START;
        }

        if (
            !grid.layout_manager.allow_incomplete_pages &&
            sourcePage < targetPage
        ) {
            reflowDirection = Clutter.ActorAlign.START;
        }

        /*
         * Native GNOME 50 edge correction.
         *
         * Important: this is intentionally performed only for a
         * real icon position. EMPTY_SPACE remains -1.
         */
        const nColumns = grid.layout_manager.columns_per_page;

        if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.START_EDGE &&
            reflowDirection === Clutter.ActorAlign.START &&
            Number.isFinite(nColumns) &&
            nColumns > 0
        ) {
            const targetColumn = targetPosition % nColumns;

            if (targetColumn > 0) {
                targetPosition -= 1;

                dragLocation = IconGrid.DragLocation.END_EDGE;
            }
        } else if (
            targetPosition >= 0 &&
            dragLocation === IconGrid.DragLocation.END_EDGE &&
            reflowDirection === Clutter.ActorAlign.END &&
            Number.isFinite(nColumns) &&
            nColumns > 0
        ) {
            const targetColumn = targetPosition % nColumns;

            if (targetColumn < nColumns - 1) {
                targetPosition += 1;

                dragLocation = IconGrid.DragLocation.START_EDGE;
            }
        }

        /*
         * Diagnostics.
         */
        const orientation =
            grid.layout_manager.orientation === Clutter.Orientation.VERTICAL
                ? "vertical"
                : "horizontal";

        const diagnosticSignature = JSON.stringify({
            sourcePage,
            sourcePosition,

            rawTargetPage,
            rawTargetPosition,
            rawDragLocation,

            targetPage,
            targetPosition,
            dragLocation,

            currentPage: grid.currentPage ?? -1,
        });

        if (diagnosticSignature !== this._lastDropTargetDiagnostic) {
            this._lastDropTargetDiagnostic = diagnosticSignature;

            this._diagnostics?.event(
                "dnd",
                "Drop target changed",
                {
                    sourcePage,
                    sourcePosition,

                    rawTargetPage,
                    rawTargetPosition,
                    rawDragLocation,

                    targetPage,
                    targetPosition,
                    dragLocation,

                    reflowDirection,

                    currentPage: grid.currentPage ?? -1,

                    x,
                    y,

                    adjustmentValue: appDisplay?._adjustment?.value ?? null,

                    adjustmentPageSize:
                        appDisplay?._adjustment?.page_size ?? null,

                    edgeZone: REORDER_EDGE_ZONE,

                    orientation,
                },
                "verbose",
            );
        }

        return [targetPage, targetPosition, dragLocation];
    }
}
