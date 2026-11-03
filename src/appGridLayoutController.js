import Clutter from "gi://Clutter";
import { AppGridNavigation } from "./appGridNavigation.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

function logGridDiagnostics(tag) {
    const appDisplay = Main.overview?._overview?._controls?._appDisplay;

    if (!appDisplay) return;

    const grid = appDisplay._grid;
    const iconGrid = grid?._grid;
    const scrollView = appDisplay._scrollView;

    const getBox = (actor) => {
        if (!actor) return null;

        const box = actor.get_allocation_box();

        return {
            x: box.x1,
            y: box.y1,
            width: box.x2 - box.x1,
            height: box.y2 - box.y1,
            visible: actor.visible,
            reactive: actor.reactive,
        };
    };

    console.log(
        `[alt-overview] [grid-diag] ${tag} ` +
            JSON.stringify({
                appGrid: getBox(grid),
                iconGrid: getBox(iconGrid),
                scrollView: getBox(scrollView),

                folders: appDisplay._folderIcons?.length ?? 0,

                iconGridChildren: iconGrid?.get_n_children?.() ?? null,

                appGridChildren: grid?.get_n_children?.() ?? null,
            }),
    );
}

export class AppGridLayoutController {
    constructor(settings, appDisplay, iconController, diagnostics = null) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._iconController = iconController;
        this._diagnostics = diagnostics;
        this._adaptToSizeSequence = 0;
        this._appGridNavigation = new AppGridNavigation(settings, appDisplay);
        this._originalAdaptToSize = null;
        this._originalGetChildrenMaxSize = null;
        this._originalCalculateSpacing = null;
        this._centerLastRowChangedId = 0;
        this._originalLastRowAlign = null;
        this._pagesChangedGrid = null;
        this._pagesChangedId = 0;
        this._scrollDirectionChangedId = 0;
        this._edgeFadeChangedId = 0;
        this._fadeScrollView = null;
        this._originalScrollViewReactive = null;
        this._originalFadeClasses = null;
    }

    enable() {
        this._centerLastRowChangedId = this._settings.connect(
            "changed::app-grid-center-last-row",
            () => this._updateLastRowAlignment(),
        );

        this._scrollDirectionChangedId = this._settings.connect(
            "changed::app-grid-scroll-direction",
            () => {
                this._updateScrollViewFade();
                this._appGridNavigation.update();
            },
        );

        this._edgeFadeChangedId = this._settings.connect(
            "changed::app-grid-edge-fade",
            () => this._updateScrollViewFade(),
        );

        this._appGridNavigation.enable();
        this._patchAppGrid();
        const gridActor = this._appDisplay?._grid;
        if (gridActor) {
            this._pagesChangedGrid = gridActor;
            this._pagesChangedId = gridActor.connect("pages-changed", () => {
                const layoutManager = gridActor.layout_manager;
                if (layoutManager?._customGridPatched)
                    layoutManager._childrenMaxSize = -1;

                gridActor.queue_relayout();
            });
        }
        this._updateLastRowAlignment();
        this._updateScrollViewFade();
    }

    _logFolderLayoutDiagnostics(tag = "layout") {
        const appDisplay = Main.overview?._overview?._controls?._appDisplay;

        if (!appDisplay) return;

        const grid = appDisplay._grid;
        const scrollView = appDisplay._scrollView;
        const iconGrid = grid?._grid;

        const getBox = (actor) => {
            if (!actor) return null;

            const box = actor.get_allocation_box();

            return {
                x: box.x1,
                y: box.y1,
                width: box.x2 - box.x1,
                height: box.y2 - box.y1,
                visible: actor.visible,
                reactive: actor.reactive,
            };
        };

        const folders = appDisplay._folderIcons ?? [];

        console.log(
            `[alt-overview] [grid-diag] ${tag} ` +
                JSON.stringify({
                    appGrid: getBox(grid),
                    iconGrid: getBox(iconGrid),
                    scrollView: getBox(scrollView),

                    appGridChildren: grid?.get_n_children?.() ?? null,
                    iconGridChildren: iconGrid?.get_n_children?.() ?? null,

                    folders: folders.length,

                    gridWidth: grid?.width ?? null,
                    gridHeight: grid?.height ?? null,

                    iconGridWidth: iconGrid?.width ?? null,
                    iconGridHeight: iconGrid?.height ?? null,

                    scrollWidth: scrollView?.width ?? null,
                    scrollHeight: scrollView?.height ?? null,
                }),
        );
    }

    disable() {
        if (this._centerLastRowChangedId) {
            this._settings.disconnect(this._centerLastRowChangedId);
            this._centerLastRowChangedId = 0;
        }

        if (this._scrollDirectionChangedId) {
            this._settings.disconnect(this._scrollDirectionChangedId);
            this._scrollDirectionChangedId = 0;
        }

        if (this._edgeFadeChangedId) {
            this._settings.disconnect(this._edgeFadeChangedId);
            this._edgeFadeChangedId = 0;
        }

        if (this._pagesChangedId && this._pagesChangedGrid) {
            this._pagesChangedGrid.disconnect(this._pagesChangedId);
            this._pagesChangedGrid = null;
            this._pagesChangedId = 0;
        }

        this._unpatchAppGrid();
        this._appGridNavigation.disable();
    }

    _updateScrollViewFade() {
        const scrollView = this._appDisplay?._scrollView;

        if (!scrollView) return;

        if (this._fadeScrollView !== scrollView) {
            this._fadeScrollView = scrollView;
            this._originalScrollViewReactive = scrollView.reactive;
            this._originalFadeClasses = {
                hfade: scrollView.has_style_class_name("hfade"),
                vfade: scrollView.has_style_class_name("vfade"),
            };
        }

        // The scroll view covers the full grid, including its empty space.
        // Let child icons remain pickable while blank areas pass clicks through.
        scrollView.reactive = false;

        const fadeOffset = this._settings.get_int("app-grid-edge-fade");
        scrollView.set_style(
            `margin-bottom: 0px !important; padding-bottom: 0px !important; ` +
                `-st-vfade-offset: ${fadeOffset}px; ` +
                `-st-hfade-offset: ${fadeOffset}px;`,
        );

        scrollView.remove_style_class_name("hfade");
        scrollView.remove_style_class_name("vfade");

        if (fadeOffset === 0) return;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";

        scrollView.add_style_class_name(vertical ? "vfade" : "hfade");
    }

    _updateLastRowAlignment() {
        const gridActor = this._appDisplay?._grid;
        const layoutManager = gridActor?.layout_manager;

        if (!layoutManager) return;

        layoutManager.last_row_align = this._settings.get_boolean(
            "app-grid-center-last-row",
        )
            ? Clutter.ActorAlign.CENTER
            : Clutter.ActorAlign.START;
        gridActor.queue_relayout();
    }

    _patchAppGrid() {
        const appDisplay = this._appDisplay;
        const gridActor = appDisplay?._grid;
        if (!appDisplay || !gridActor) return;

        const scrollView = appDisplay._scrollView;
        this._appGridNavigation.mount(scrollView);

        gridActor.set_style(
            "margin-bottom: 0px !important; margin-top: 0px !important; padding-bottom: 0px !important;",
        );
        gridActor.y_expand = true;
        if (scrollView) scrollView.y_expand = true;
        appDisplay.set_style(
            "margin-bottom: 0px !important; padding-bottom: 0px !important;",
        );

        const layoutManager = gridActor.layout_manager;

        layoutManager.page_valign = Clutter.ActorAlign.CENTER;

        if (this._originalLastRowAlign === null)
            this._originalLastRowAlign = layoutManager.last_row_align;
        this._updateLastRowAlignment();

        if (layoutManager._customGridPatched) return;

        this._originalAdaptToSize = layoutManager.adaptToSize;
        this._originalGetChildrenMaxSize = layoutManager._getChildrenMaxSize;
        this._originalCalculateSpacing = layoutManager._calculateSpacing;

        const controller = this;

        const measureAppIconSize = (item) => {
            const [, , naturalWidth, naturalHeight] = item.get_preferred_size();

            return Math.max(naturalWidth || 0, naturalHeight || 0);
        };

        layoutManager._getChildrenMaxSize = function () {
            if (this._childrenMaxSize === -1) {
                let maxSize = 0;

                for (
                    let pageIndex = 0;
                    pageIndex < this._pages.length;
                    pageIndex++
                ) {
                    const page = this._pages[pageIndex];
                    const visibleItems = page.visibleChildren ?? [];

                    for (const item of visibleItems) {
                        maxSize = Math.max(maxSize, measureAppIconSize(item));
                    }
                }

                this._childrenMaxSize = maxSize;
            }

            return this._childrenMaxSize;
        };

        layoutManager._calculateSpacing = function (childSize) {
            const [leftEmptySpace, topEmptySpace] =
                controller._originalCalculateSpacing.call(this, childSize);

            const hSpacing = 0;
            const vSpacing = 0;

            if (
                !Number.isFinite(this._pageWidth) ||
                !Number.isFinite(this._pageHeight) ||
                !Number.isFinite(childSize) ||
                childSize <= 0
            )
                return [leftEmptySpace, topEmptySpace, hSpacing, vSpacing];

            const columns = this.columnsPerPage;
            const rows = this.rowsPerPage;

            if (
                !Number.isFinite(columns) ||
                columns <= 0 ||
                !Number.isFinite(rows) ||
                rows <= 0
            )
                return [leftEmptySpace, topEmptySpace, hSpacing, vSpacing];

            const groupWidth =
                columns * childSize + Math.max(columns - 1, 0) * hSpacing;

            const groupHeight =
                rows * childSize + Math.max(rows - 1, 0) * vSpacing;

            const groupOffsetX =
                (this._pageWidth - groupWidth) / 2 - leftEmptySpace;

            const groupOffsetY =
                (this._pageHeight - groupHeight) / 2 - topEmptySpace;

            return [
                leftEmptySpace + groupOffsetX,
                topEmptySpace + groupOffsetY,
                hSpacing,
                vSpacing,
            ];
        };

        layoutManager.adaptToSize = function (width, height) {
            const call = ++controller._adaptToSizeSequence;
            try {
                controller._originalAdaptToSize.call(this, width, height);
            } catch (error) {
                controller._diagnostics?.error(
                    "app-grid-layout",
                    "GNOME adaptToSize failed",
                    error,
                    { call, width, height },
                );
                throw error;
            }

            controller._appGridNavigation._updateNavigationPosition();

            if (this.page_padding) {
                this.page_padding.bottom = 0;
                this.page_padding.top = 0;
            }

            const cols = controller._settings.get_int("app-grid-columns");
            const rows = controller._settings.get_int("app-grid-rows");

            const columnsChanged = this.columns_per_page !== cols;
            const rowsChanged = this.rows_per_page !== rows;

            this.columns_per_page = cols;
            this.rows_per_page = rows;

            // Check whether the current page distribution matches
            // the configured grid capacity.
            const itemsPerPage = cols * rows;
            const pages = Array.isArray(this._pages) ? this._pages : [];

            const pageCounts = pages.map(
                (page) => page.visibleChildren?.length ?? 0,
            );

            const totalVisibleItems = pageCounts.reduce(
                (total, count) => total + count,
                0,
            );

            const expectedPageCount =
                itemsPerPage > 0 && totalVisibleItems > 0
                    ? Math.ceil(totalVisibleItems / itemsPerPage)
                    : 0;

            const pageDistributionChanged =
                itemsPerPage > 0 &&
                (pageCounts.length !== expectedPageCount ||
                    pageCounts.some(
                        (count, index) =>
                            count > itemsPerPage ||
                            (index < pageCounts.length - 1 &&
                                count !== itemsPerPage),
                    ));

            if (columnsChanged || rowsChanged || pageDistributionChanged) {
                /*
                 * First pass: fill vacancies between existing pages.
                 */
                const fillItemVacancies = () => {
                    if (typeof this._fillItemVacancies !== "function") return;

                    for (
                        let pageIndex = 0;
                        pageIndex < this._pages.length;
                        pageIndex++
                    )
                        this._fillItemVacancies(pageIndex);
                };

                fillItemVacancies();

                /*
                 * Redistribute surplus items according to the new capacity.
                 */
                if (typeof this._updatePages === "function")
                    this._updatePages();

                /*
                 * Second pass: compact any remaining incomplete pages.
                 */
                fillItemVacancies();

                this._childrenMaxSize = -1;
            }

            const padding = this.page_padding;
            const availWidth = width - padding.left - padding.right;
            const availHeight = height - padding.top - padding.bottom;
            if (
                ![width, height, availWidth, availHeight].every(
                    Number.isFinite,
                ) ||
                availWidth <= 0 ||
                availHeight <= 0 ||
                cols <= 0 ||
                rows <= 0
            ) {
                controller._diagnostics?.warning(
                    "app-grid-layout",
                    "Skipped grid sizing because available geometry is invalid",
                    {
                        call,
                        width,
                        height,
                        padding: {
                            left: padding.left,
                            right: padding.right,
                            top: padding.top,
                            bottom: padding.bottom,
                        },
                        availableWidth: availWidth,
                        availableHeight: availHeight,
                        columns: cols,
                        rows,
                    },
                );
                return;
            }
            if (gridActor.get_n_children() === 0) return;

            const baseIconSize = this._iconSize;

            /*
             * КРОК 1: фіксуємо "нормальний" (не залежний від
             * app-grid-icon-size) розмір кожного AppIcon-tile.
             *
             * Це має відбутись ДО будь-яких вимірювань geometry
             * (childWidth/childHeight нижче, slot-fit scale тощо),
             * інакше обраний режим розміру іконки впливатиме на
             * розмір AppIcon/grid-cell.
             */
            for (let i = 0; i < gridActor.get_n_children(); i++)
                controller._iconController.lockTileSize(
                    gridActor.get_child_at_index(i),
                    baseIconSize,
                );

            // КРОК 2: вимірюємо slot-fit геометрію, поки іконки ще
            // у своєму "нормальному" (nominalSize) стані.
            const child = gridActor.get_child_at_index(0);
            const iconBin = child?.icon?._iconBin;

            const [, naturalWidth] = iconBin
                ? iconBin.get_preferred_width(-1)
                : child.get_preferred_width(-1);

            const [, naturalHeight] = iconBin
                ? iconBin.get_preferred_height(naturalWidth)
                : child.get_preferred_height(naturalWidth);

            const childWidth = naturalWidth || 100;
            const childHeight = naturalHeight || 120;
            const minSpacing = 0;
            const slotWidth = (availWidth - (cols - 1) * minSpacing) / cols;
            const slotHeight = (availHeight - (rows - 1) * minSpacing) / rows;
            let scale = 1.0;
            if (childWidth > slotWidth || childHeight > slotHeight)
                scale = Math.min(
                    slotWidth / childWidth,
                    slotHeight / childHeight,
                );

            // КРОК 3: застосовуємо обраний режим розміру ЛИШЕ до графічної
            // іконки всередині кожного AppIcon.
            //
            //    ВАЖЛИВО: це відбувається ПІСЛЯ вимірювання childWidth/
            //    childHeight та обчислення slot-fit scale вище, тому обраний
            //    режим розміру іконки більше не впливає на цю геометрію —
            //    змінюється лише сама графічна іконка всередині AppIcon.
            const mode = controller._settings.get_string(
                "app-grid-names-visibility",
            );
            for (let i = 0; i < gridActor.get_n_children(); i++) {
                const item = gridActor.get_child_at_index(i);
                controller._iconController.applyIconSize(item, baseIconSize);

                item.set_pivot_point(0.5, 0.5);

                /*
                 * AppIcon НІКОЛИ не масштабується.
                 * Його візуальний розмір завжди 150×150.
                 */
                item.set_scale(1.0, 1.0);

                controller._iconController.applyNameVisibilityMode(item, mode);
            }

            const [gridWidth, gridHeight] = gridActor.get_size();
            const layoutMetrics = {
                call,
                inputWidth: width,
                inputHeight: height,
                availableWidth: availWidth,
                availableHeight: availHeight,
                gridWidth,
                gridHeight,
                pageWidth: this._pageWidth,
                pageHeight: this._pageHeight,
                columns: this.columns_per_page,
                rows: this.rows_per_page,
                children: gridActor.get_n_children(),
                pages: this._pages?.length ?? 0,
                pagePadding: {
                    left: padding.left,
                    right: padding.right,
                    top: padding.top,
                    bottom: padding.bottom,
                },
            };
            if (
                ![
                    gridWidth,
                    gridHeight,
                    this._pageWidth,
                    this._pageHeight,
                ].every(Number.isFinite)
            ) {
                controller._diagnostics?.warning(
                    "app-grid-layout",
                    "Grid layout produced non-finite dimensions",
                    layoutMetrics,
                );
            } else {
                controller._diagnostics?.event(
                    "app-grid-layout",
                    "Grid layout completed",
                    layoutMetrics,
                    "verbose",
                );
            }
        };
        layoutManager._customGridPatched = true;
        gridActor.queue_relayout();
    }

    _unpatchAppGrid() {
        const appDisplay = this._appDisplay;
        this._appGridNavigation.unmount();

        if (appDisplay) {
            appDisplay.set_style(null);
            appDisplay._scrollView?.set_style(null);
            const gridActor = appDisplay._grid;
            if (gridActor) {
                gridActor.set_style(null);
                const layoutManager = gridActor.layout_manager;
                if (layoutManager && this._originalLastRowAlign !== null) {
                    layoutManager.last_row_align = this._originalLastRowAlign;
                    this._originalLastRowAlign = null;
                    gridActor.queue_relayout();
                }
                if (layoutManager && this._originalAdaptToSize) {
                    layoutManager.adaptToSize = this._originalAdaptToSize;

                    if (this._originalGetChildrenMaxSize)
                        layoutManager._getChildrenMaxSize =
                            this._originalGetChildrenMaxSize;

                    if (this._originalCalculateSpacing)
                        layoutManager._calculateSpacing =
                            this._originalCalculateSpacing;

                    layoutManager._childrenMaxSize = -1;

                    delete layoutManager._customGridPatched;

                    for (
                        let index = 0;
                        index < gridActor.get_n_children();
                        index++
                    )
                        gridActor.get_child_at_index(index).set_scale(1.0, 1.0);

                    gridActor.queue_relayout();
                }
            }
        }

        const fadeScrollView = this._fadeScrollView;
        if (fadeScrollView) {
            if (this._originalScrollViewReactive !== null)
                fadeScrollView.reactive = this._originalScrollViewReactive;

            fadeScrollView.remove_style_class_name("hfade");
            fadeScrollView.remove_style_class_name("vfade");
            if (this._originalFadeClasses?.hfade)
                fadeScrollView.add_style_class_name("hfade");
            if (this._originalFadeClasses?.vfade)
                fadeScrollView.add_style_class_name("vfade");
        }

        this._fadeScrollView = null;
        this._originalScrollViewReactive = null;
        this._originalFadeClasses = null;
        this._originalAdaptToSize = null;
    }
}
