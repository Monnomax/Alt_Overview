import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";

export class AppGridNavigation {
    static PAGE_INDICATOR_BOTTOM_MARGIN = 10;
    static PAGE_INDICATOR_EDGE_MARGIN = 10;
    static PAGE_INDICATOR_SIZE = 30;
    static PAGE_INDICATOR_ICON_SIZE = 10;

    constructor(settings, appDisplay) {
        this._scrollDirectionChangedId = 0;
        this._navigationAllocationSignals = [];
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._originalParent = null;
        this._originalIndex = null;
        this._pagesChangedGrid = null;
        this._pagesChangedId = 0;
        this._originalScrollViewExpand = null;
        this._originalIndicatorsAlign = null;
        this._originalIndicatorsExpand = null;
        this._scrollViewTopLevel = null;
        this._navigationButtonsChangedId = 0;
        this._originalNavigationButtonStates = [];
        this._navigation = null;
        this._navigationPositionLaterId = 0;
        this._navigationButtonsSyncOwner = null;
        this._originalSyncIndicatorsVisibility = null;
        this._originalSyncIndicators = null;
        this._previousButton = null;
        this._nextButton = null;
        this._originalUpdateIndicator = null;
    }

    enable() {
        this._patchNavigationButtons();

        this._scrollDirectionChangedId = this._settings.connect(
            "changed::app-grid-scroll-direction",
            () => this.update(),
        );
    }

    disable() {
        if (this._scrollDirectionChangedId) {
            this._settings.disconnect(this._scrollDirectionChangedId);
            this._scrollDirectionChangedId = 0;
        }
        this.unmount();
        this._unpatchNavigationButtons();
        this._unpatchPageIndicators();
    }

    mount(scrollView) {
        const appDisplay = this._appDisplay;
        const pageIndicators = appDisplay?._pageIndicators;

        if (!appDisplay || !scrollView || !pageIndicators) return;

        this._patchPageIndicators(pageIndicators);

        const grid = appDisplay._grid;
        if (grid && !this._pagesChangedId) {
            this._pagesChangedGrid = grid;
            this._pagesChangedId = grid.connect("pages-changed", () => {
                this.update();
                this._navigation?.queue_relayout();
            });
        }

        const boxParent = pageIndicators.get_parent?.() ?? null;
        let scrollViewTopLevel = scrollView;

        while (
            scrollViewTopLevel &&
            boxParent &&
            scrollViewTopLevel.get_parent() !== boxParent
        ) {
            scrollViewTopLevel = scrollViewTopLevel.get_parent();
        }

        if (
            appDisplay._chOverlayContainer ||
            !boxParent ||
            !scrollViewTopLevel ||
            scrollViewTopLevel.get_parent() !== boxParent ||
            scrollViewTopLevel === pageIndicators
        ) {
            pageIndicators.clip_to_allocation = false;
            this.update();
            return;
        }

        this._originalParent = boxParent;
        this._originalIndex = boxParent
            .get_children()
            .indexOf(scrollViewTopLevel);
        this._originalScrollViewExpand = {
            x: scrollViewTopLevel.x_expand,
            y: scrollViewTopLevel.y_expand,
        };
        this._originalIndicatorsAlign = {
            x: pageIndicators.x_align,
            y: pageIndicators.y_align,
        };
        this._originalIndicatorsExpand = {
            x: pageIndicators.x_expand,
            y: pageIndicators.y_expand,
        };
        this._scrollViewTopLevel = scrollViewTopLevel;

        boxParent.remove_child(scrollViewTopLevel);
        boxParent.remove_child(pageIndicators);

        const overlay = new St.Widget({
            name: "ch-app-grid-overlay",
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });

        scrollViewTopLevel.x_expand = true;
        scrollViewTopLevel.y_expand = true;
        overlay.add_child(scrollViewTopLevel);
        boxParent.insert_child_at_index(overlay, this._originalIndex);
        appDisplay._chOverlayContainer = overlay;

        pageIndicators.clip_to_allocation = false;
        this.update();
    }

    unmount() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        const pageIndicators = appDisplay?._pageIndicators;

        if (this._pagesChangedId && this._pagesChangedGrid) {
            this._pagesChangedGrid.disconnect(this._pagesChangedId);
            this._pagesChangedGrid = null;
            this._pagesChangedId = 0;
        }

        this._destroyNavigation();

        if (overlay && this._originalParent) {
            const scrollViewTopLevel = this._scrollViewTopLevel;
            const parent = this._originalParent;
            const index = this._originalIndex ?? 0;

            if (scrollViewTopLevel?.get_parent() === overlay)
                overlay.remove_child(scrollViewTopLevel);
            if (pageIndicators?.get_parent() === overlay)
                overlay.remove_child(pageIndicators);

            if (scrollViewTopLevel) {
                if (this._originalScrollViewExpand) {
                    scrollViewTopLevel.x_expand =
                        this._originalScrollViewExpand.x;
                    scrollViewTopLevel.y_expand =
                        this._originalScrollViewExpand.y;
                }
                parent.insert_child_at_index(scrollViewTopLevel, index);
            }

            if (pageIndicators) {
                if (this._originalIndicatorsAlign) {
                    pageIndicators.x_align = this._originalIndicatorsAlign.x;
                    pageIndicators.y_align = this._originalIndicatorsAlign.y;
                }
                if (this._originalIndicatorsExpand) {
                    pageIndicators.x_expand = this._originalIndicatorsExpand.x;
                    pageIndicators.y_expand = this._originalIndicatorsExpand.y;
                }
                pageIndicators.clear_constraints();
                pageIndicators.set_style(null);
                pageIndicators.clip_to_allocation = true;
                parent.insert_child_at_index(pageIndicators, index + 1);
            }

            overlay.destroy();
            delete appDisplay._chOverlayContainer;
        }

        this._originalParent = null;
        this._originalIndex = null;
        this._originalScrollViewExpand = null;
        this._originalIndicatorsAlign = null;
        this._originalIndicatorsExpand = null;
        this._scrollViewTopLevel = null;
    }

    update() {
        const pageIndicators = this._appDisplay?._pageIndicators;

        if (!pageIndicators) return;

        pageIndicators.visible = true;

        const vertical =
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical";

        const indicatorOrientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;

        if (pageIndicators.orientation !== indicatorOrientation) {
            pageIndicators.orientation = indicatorOrientation;
            pageIndicators.queue_relayout();
        }

        pageIndicators.x_align = Clutter.ActorAlign.CENTER;
        pageIndicators.y_align = Clutter.ActorAlign.CENTER;
        pageIndicators.x_expand = false;
        pageIndicators.y_expand = false;

        for (const indicator of pageIndicators.get_children()) {
            indicator.set_style(
                `width: ${AppGridNavigation.PAGE_INDICATOR_SIZE}px !important; ` +
                    `height: ${AppGridNavigation.PAGE_INDICATOR_SIZE}px !important; ` +
                    `padding: 0 !important; ` +
                    `margin: 0 !important; ` +
                    `border: 0 !important;`,
            );
            indicator.add_style_class_name("page-indicator");
            indicator.visible = true;

            indicator.x_align = Clutter.ActorAlign.CENTER;
            indicator.y_align = Clutter.ActorAlign.CENTER;
            indicator.x_expand = false;
            indicator.y_expand = false;

            indicator.set_size(
                AppGridNavigation.PAGE_INDICATOR_SIZE,
                AppGridNavigation.PAGE_INDICATOR_SIZE,
            );

            const icon = indicator.get_children?.()?.[0];
            if (!icon) continue;

            const iconSize = AppGridNavigation.PAGE_INDICATOR_ICON_SIZE;
            icon.set_style(
                `width: ${iconSize}px !important; ` +
                    `height: ${iconSize}px !important; ` +
                    `min-width: ${iconSize}px !important; ` +
                    `min-height: ${iconSize}px !important; ` +
                    `max-width: ${iconSize}px !important; ` +
                    `max-height: ${iconSize}px !important; ` +
                    `margin: 0 !important; ` +
                    `padding: 0 !important;`,
            );

            icon.x_align = Clutter.ActorAlign.CENTER;
            icon.y_align = Clutter.ActorAlign.CENTER;
            icon.x_expand = false;
            icon.y_expand = false;
            icon.scale_x = 1;
            icon.scale_y = 1;
        }

        this._createNavigation();
        this._updateNavigationOrientation();
        this._enforceNavigationButtonsVisibility();
    }

    _patchPageIndicators(pageIndicators) {
        if (
            !this._originalUpdateIndicator &&
            typeof pageIndicators._updateIndicator === "function"
        ) {
            this._originalUpdateIndicator = pageIndicators._updateIndicator;
            const originalUpdateIndicator = this._originalUpdateIndicator;

            pageIndicators._updateIndicator = function (indicator, pageIndex) {
                originalUpdateIndicator.call(this, indicator, pageIndex);
                indicator?.child?.set_scale(1, 1);
            };
        }
    }

    _unpatchPageIndicators() {
        const pageIndicators = this._appDisplay?._pageIndicators;

        if (pageIndicators && this._originalUpdateIndicator) {
            pageIndicators._updateIndicator = this._originalUpdateIndicator;
            this._originalUpdateIndicator = null;
        }
    }

    _patchNavigationButtons() {
        const appDisplay = this._appDisplay;
        if (!appDisplay) return;

        const buttons = [
            appDisplay._prevPageArrow,
            appDisplay._nextPageArrow,
        ].filter(Boolean);

        if (buttons.length !== 2) return;

        this._originalNavigationButtonStates = buttons.map((button) => ({
            button,
            visible: button.visible,
            opacity: button.opacity,
            reactive: button.reactive,
            canFocus: button.can_focus,
            translationX: button.translation_x,
            translationY: button.translation_y,
        }));

        const parent = buttons[0].get_parent();
        if (!parent) return;

        const syncOwner =
            typeof appDisplay._syncPageIndicatorsVisibility === "function"
                ? appDisplay
                : parent.layout_manager;
        const originalSyncVisibility = syncOwner?._syncPageIndicatorsVisibility;
        const originalSyncIndicators = syncOwner?._syncPageIndicators;

        if (
            typeof originalSyncVisibility === "function" ||
            typeof originalSyncIndicators === "function"
        ) {
            this._navigationButtonsSyncOwner = syncOwner;

            if (typeof originalSyncVisibility === "function") {
                this._originalSyncIndicatorsVisibility = originalSyncVisibility;
                syncOwner._syncPageIndicatorsVisibility = () =>
                    this._enforceNavigationButtonsVisibility();
            }

            if (typeof originalSyncIndicators === "function") {
                this._originalSyncIndicators = originalSyncIndicators;
                const indicators = this;
                syncOwner._syncPageIndicators = function (...args) {
                    originalSyncIndicators.apply(this, args);
                    // Keep GNOME's page preview calculations and reset its
                    // translations on the independent navigation buttons.
                    indicators._lockNavigationButtons();
                };
            }
        }

        this._navigationButtonsChangedId = this._settings.connect(
            "changed::show-app-grid-navigation-buttons",
            () => this._updateNavigationButtons(),
        );
        this._updateNavigationButtons();
    }

    _lockNavigationButtons() {
        // Keep GNOME's own arrows in their native container. Its layout
        // manager continues to allocate them even when custom arrows are used.
        // Hiding them is safe; detaching them makes GNOME allocate actors that
        // are no longer descendants of the stage.
        if (this._navigation) {
            for (const { button } of this._originalNavigationButtonStates) {
                if (!button) continue;
                button.remove_transition("opacity");
                button.visible = false;
                button.opacity = 0;
                button.reactive = false;
                button.can_focus = false;
                button.translation_x = 0;
                button.translation_y = 0;
            }
        }

        for (const button of [this._previousButton, this._nextButton]) {
            if (!button) continue;
            button.remove_transition("opacity");
            button.translation_x = 0;
            button.translation_y = 0;
        }
        this._enforceNavigationButtonsVisibility();
    }

    _updateNavigationButtons() {
        const syncOwner = this._navigationButtonsSyncOwner;
        const originalSync = this._originalSyncIndicatorsVisibility;
        if (syncOwner && originalSync) originalSync.call(syncOwner, false);

        this._createNavigation();
        this._lockNavigationButtons();
        this.update();
    }

    _createNavigation() {
        const appDisplay = this._appDisplay;
        const overlay = appDisplay?._chOverlayContainer;
        const pageIndicators = appDisplay?._pageIndicators;
        const originalPrevious = appDisplay?._prevPageArrow;
        const originalNext = appDisplay?._nextPageArrow;

        if (
            !overlay ||
            !pageIndicators ||
            !originalPrevious ||
            !originalNext ||
            this._navigation
        ) {
            return;
        }

        // Leave the original arrows in GNOME's scroll container: its
        // BaseAppViewGridLayout still allocates these actors on every layout.
        if (pageIndicators.get_parent() === overlay)
            overlay.remove_child(pageIndicators);

        const vertical = this._isVertical();
        const previous = new St.Button({
            name: "ch-page-navigation-previous",
            style_class: "page-navigation-arrow",
            icon_name: vertical ? "go-up-symbolic" : "go-previous-symbolic",
            x_align: 0,
            y_align: 0,
        });
        const next = new St.Button({
            name: "ch-page-navigation-next",
            style_class: "page-navigation-arrow",
            icon_name: vertical ? "go-down-symbolic" : "go-next-symbolic",
            x_align: 0,
            y_align: 0,
        });

        previous.connect("clicked", () => {
            const currentPage = appDisplay?._grid?.currentPage ?? 0;
            if (typeof appDisplay?.goToPage === "function")
                appDisplay.goToPage(currentPage - 1);
        });
        next.connect("clicked", () => {
            const currentPage = appDisplay?._grid?.currentPage ?? 0;
            if (typeof appDisplay?.goToPage === "function")
                appDisplay.goToPage(currentPage + 1);
        });

        this._previousButton = previous;
        this._nextButton = next;

        const navigation = new St.Widget({
            name: "ch-page-navigation",
            layout_manager: new Clutter.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                spacing: 0,
            }),
            x_expand: false,
            y_expand: false,
        });
        navigation.set_style(
            "spacing: 0px !important; margin: 0px !important; padding: 0px !important;",
        );
        navigation.add_child(previous);
        navigation.add_child(pageIndicators);
        navigation.add_child(next);
        overlay.add_child(navigation);

        this._navigation = navigation;
        /*
         * Recalculate navigation position when its geometry changes
         * or when it becomes visible for the first time.
         */
        this._navigationAllocationSignals = [];

        const updatePosition = () => this._updateNavigationPosition();

        for (const actor of [overlay, navigation]) {
            for (const signal of ["notify::allocation", "notify::mapped"]) {
                const id = actor.connect(signal, updatePosition);

                this._navigationAllocationSignals.push({
                    actor,
                    id,
                });
            }
        }
        this._lockNavigationButtons();
    }

    _updateNavigationOrientation() {
        const navigation = this._navigation;

        if (!navigation) return;

        const vertical = this._isVertical();
        const layout = navigation.layout_manager;

        if (!layout) return;

        const targetOrientation = vertical
            ? Clutter.Orientation.VERTICAL
            : Clutter.Orientation.HORIZONTAL;

        if (layout.orientation !== targetOrientation) {
            layout.orientation = targetOrientation;
            navigation.queue_relayout();
        }

        if (layout.spacing !== 0) {
            layout.spacing = 0;
            navigation.queue_relayout();
        }

        this._updateNavigationButtonIcons(vertical);
        this._updateNavigationPosition();
    }

    _updateNavigationPosition() {
        if (this._navigationPositionLaterId) return;

        const laters = global.compositor?.get_laters?.();
        if (!laters) {
            this._applyNavigationPosition();
            return;
        }

        let attempts = 0;
        this._navigationPositionLaterId = laters.add(
            Meta.LaterType.BEFORE_REDRAW,
            () => {
                const navigation = this._navigation;
                const overlay = this._appDisplay?._chOverlayContainer;

                if (
                    !navigation ||
                    !overlay ||
                    navigation.is_destroyed?.() ||
                    overlay.is_destroyed?.()
                ) {
                    this._navigationPositionLaterId = 0;
                    return false;
                }

                const dimensions = [
                    navigation.width,
                    navigation.height,
                    overlay.width,
                    overlay.height,
                ];
                const hasAllocation = dimensions.every(
                    value => Number.isFinite(value) && value > 0,
                );

                if (!hasAllocation) {
                    // Wait for Clutter's first real allocation. A pointer hover
                    // must not be needed to trigger the missing relayout.
                    attempts++;
                    if (attempts < 30) return true;

                    this._navigationPositionLaterId = 0;
                    return false;
                }

                this._applyNavigationPosition();
                this._navigationPositionLaterId = 0;
                return false;
            },
        );
    }

    _applyNavigationPosition() {
        const navigation = this._navigation;
        const overlay = this._appDisplay?._chOverlayContainer;

        if (!navigation || !overlay) return;

        const width = navigation.width;
        const height = navigation.height;
        const overlayWidth = overlay.width;
        const overlayHeight = overlay.height;

        if (
            ![width, height, overlayWidth, overlayHeight].every(
                Number.isFinite,
            ) ||
            width <= 0 ||
            height <= 0 ||
            overlayWidth <= 0 ||
            overlayHeight <= 0
        )
            return;

        const vertical = this._isVertical();

        let x;
        let y;

        if (vertical) {
            x =
                overlayWidth -
                width -
                AppGridNavigation.PAGE_INDICATOR_EDGE_MARGIN;

            y = (overlayHeight - height) / 2;
        } else {
            x = (overlayWidth - width) / 2;

            y =
                overlayHeight -
                height -
                AppGridNavigation.PAGE_INDICATOR_BOTTOM_MARGIN;
        }

        if (![x, y].every(Number.isFinite)) return;

        const targetX = Math.round(x);
        const targetY = Math.round(y);

        // translation is an offset from the actor's allocated position.
        const targetTranslationX = targetX - navigation.x;
        const targetTranslationY = targetY - navigation.y;

        if (![targetTranslationX, targetTranslationY].every(Number.isFinite))
            return;

        if (
            Math.abs(navigation.translation_x - targetTranslationX) < 0.5 &&
            Math.abs(navigation.translation_y - targetTranslationY) < 0.5
        )
            return;

        navigation.translation_x = targetTranslationX;
        navigation.translation_y = targetTranslationY;
    }
    _updateNavigationButtonIcons(vertical) {
        if (this._previousButton) {
            this._previousButton.icon_name = vertical
                ? "go-up-symbolic"
                : "go-previous-symbolic";
        }
        if (this._nextButton) {
            this._nextButton.icon_name = vertical
                ? "go-down-symbolic"
                : "go-next-symbolic";
        }
    }

    _enforceNavigationButtonsVisibility() {
        const showButtons = this._settings.get_boolean(
            "show-app-grid-navigation-buttons",
        );
        for (const button of [this._previousButton, this._nextButton]) {
            if (!button) continue;
            button.remove_transition("opacity");
            button.visible = showButtons;
            button.opacity = showButtons ? 255 : 0;
            button.reactive = showButtons;
            button.can_focus = showButtons;
        }
    }

    _unpatchNavigationButtons() {
        if (this._navigationButtonsChangedId) {
            this._settings.disconnect(this._navigationButtonsChangedId);
            this._navigationButtonsChangedId = 0;
        }

        const syncOwner = this._navigationButtonsSyncOwner;
        if (
            syncOwner &&
            this._originalSyncIndicatorsVisibility &&
            syncOwner._syncPageIndicatorsVisibility !==
                this._originalSyncIndicatorsVisibility
        ) {
            syncOwner._syncPageIndicatorsVisibility =
                this._originalSyncIndicatorsVisibility;
        }
        if (
            syncOwner &&
            this._originalSyncIndicators &&
            syncOwner._syncPageIndicators !== this._originalSyncIndicators
        ) {
            syncOwner._syncPageIndicators = this._originalSyncIndicators;
        }
        this._navigationButtonsSyncOwner = null;
        this._originalSyncIndicatorsVisibility = null;
        this._originalSyncIndicators = null;

        for (const state of this._originalNavigationButtonStates) {
            const { button } = state;
            if (!button) continue;

            button.remove_transition("opacity");
            button.visible = state.visible;
            button.opacity = state.opacity;
            button.reactive = state.reactive;
            button.can_focus = state.canFocus;
            button.translation_x = Number.isFinite(state.translationX)
                ? state.translationX
                : 0;
            button.translation_y = Number.isFinite(state.translationY)
                ? state.translationY
                : 0;
        }
        this._originalNavigationButtonStates = [];
    }

    _destroyNavigation() {
        const navigation = this._navigation;
        if (!navigation) return;

        for (const { actor, id } of this._navigationAllocationSignals) {
            try {
                actor.disconnect(id);
            } catch (_error) {}
        }

        this._navigationAllocationSignals = [];

        const appDisplay = this._appDisplay;
        const pageIndicators = appDisplay?._pageIndicators;

        if (pageIndicators?.get_parent() === navigation)
            navigation.remove_child(pageIndicators);

        this._previousButton = null;
        this._nextButton = null;

        if (this._navigationPositionLaterId) {
            global.compositor?.get_laters?.()?.remove(
                this._navigationPositionLaterId,
            );
            this._navigationPositionLaterId = 0;
        }

        navigation.destroy();
        this._navigation = null;
    }

    _isVertical() {
        return (
            this._settings.get_string("app-grid-scroll-direction") ===
            "vertical"
        );
    }
}
