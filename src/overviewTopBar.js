import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

const TOP_BAR_HEIGHT = 60;
const THUMBNAILS_BOX_HEIGHT = 60;
const THUMBNAIL_HEIGHT = 40;
const THUMBNAIL_SPACING = 10;
const THUMBNAIL_EDGE_MARGIN = 10;
const THUMBNAIL_VERTICAL_OFFSET =
    (THUMBNAILS_BOX_HEIGHT - THUMBNAIL_HEIGHT) / 2;
const TOP_BAR_SPACING = 20;

const TopBar = GObject.registerClass(
    class TopBar extends St.Widget {
        _init() {
            const layout = new Clutter.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                spacing: TOP_BAR_SPACING,
            });

            super._init({
                layout_manager: layout,
                reactive: false,
                x_expand: false,
                y_expand: false,
                style: "background-color: transparent; border: none; box-shadow: none;",
            });
        }

        vfunc_get_preferred_height(_forWidth) {
            return [TOP_BAR_HEIGHT, TOP_BAR_HEIGHT];
        }
    },
);

export class OverviewTopBar {
    constructor(layoutManager, searchEntry) {
        this._layoutManager = layoutManager;
        this._searchEntry = searchEntry;
        this._controls = null;
        this._searchEntryBin = null;
        this._topBar = null;
        this._thumbnailsBox = null;
        this._thumbnailLayoutSpacer = null;

        this._originalThumbnailsParent = null;
        this._originalThumbnailsIndex = -1;
        this._originalThumbnailsXExpand = null;
        this._originalThumbnailsYExpand = null;
        this._originalThumbnailsXAlign = null;
        this._originalThumbnailsYAlign = null;
        this._originalThumbnailsHeightRequest = null;
        this._originalThumbnailsTranslationY = null;
        this._originalThumbnailsMaxScale = null;
        this._originalThumbnailsUpdatePorthole = null;
        this._originalThumbnailsStyle = null;
        this._originalThumbnailsAddThumbnails = null;
        this._wrappedThumbnailsAddThumbnails = null;
    }

    get controls() {
        return this._controls;
    }

    create() {
        if (this._topBar && !this._topBar.is_destroyed?.()) return true;

        const searchEntry = this._searchEntry;
        const searchEntryBin = searchEntry?.get_parent();
        const controls = searchEntryBin?.get_parent();
        const thumbnailsBox = this._layoutManager?._workspacesThumbnails;

        if (!searchEntry || !searchEntryBin || !controls || !thumbnailsBox)
            return false;

        this._controls = controls;
        this._searchEntryBin = searchEntryBin;
        this._thumbnailsBox = thumbnailsBox;

        this._originalThumbnailsParent = thumbnailsBox.get_parent();
        this._originalThumbnailsIndex =
            this._originalThumbnailsParent
                ?.get_children()
                .indexOf(thumbnailsBox) ?? -1;
        this._originalThumbnailsXExpand = thumbnailsBox.x_expand;
        this._originalThumbnailsYExpand = thumbnailsBox.y_expand;
        this._originalThumbnailsXAlign = thumbnailsBox.x_align;
        this._originalThumbnailsYAlign = thumbnailsBox.y_align;
        this._originalThumbnailsHeightRequest =
            typeof thumbnailsBox.get_height_request === "function"
                ? thumbnailsBox.get_height_request()
                : -1;
        this._originalThumbnailsStyle = thumbnailsBox.get_style();

        this._originalThumbnailsTranslationY = thumbnailsBox.translation_y;
        this._originalThumbnailsMaxScale = thumbnailsBox._maxThumbnailScale;
        this._originalThumbnailsUpdatePorthole = thumbnailsBox._updatePorthole;

        if (typeof this._originalThumbnailsUpdatePorthole === "function") {
            const originalUpdatePorthole =
                this._originalThumbnailsUpdatePorthole;
            const overviewTopBar = this;

            thumbnailsBox._updatePorthole = function (...args) {
                const result = originalUpdatePorthole.apply(this, args);
                overviewTopBar._updateThumbnailScale(this);
                return result;
            };
        }

        this._originalThumbnailsAddThumbnails = thumbnailsBox.addThumbnails;

        if (typeof this._originalThumbnailsAddThumbnails === "function") {
            const originalAddThumbnails = this._originalThumbnailsAddThumbnails;
            const topBarController = this;

            this._wrappedThumbnailsAddThumbnails = function (...args) {
                const result = originalAddThumbnails.apply(this, args);
                topBarController._applyThumbnailVerticalOffset(this);
                return result;
            };

            thumbnailsBox.addThumbnails = this._wrappedThumbnailsAddThumbnails;
        }

        const originalStyle = this._originalThumbnailsStyle?.trim();
        const stylePrefix = originalStyle
            ? `${originalStyle.replace(/;+\s*$/, "")}; `
            : "";

        thumbnailsBox.set_style(
            `${stylePrefix}` +
                `padding: 0px !important; ` +
                `border-width: 0px !important; ` +
                `spacing: ${THUMBNAIL_SPACING}px !important; ` +
                `margin-left: ${THUMBNAIL_EDGE_MARGIN}px !important; ` +
                `margin-right: ${THUMBNAIL_EDGE_MARGIN}px !important;`,
        );

        this._applyThumbnailVerticalOffset(thumbnailsBox);
        this._updateThumbnailScale(thumbnailsBox);

        if (searchEntry.get_parent() === searchEntryBin)
            searchEntryBin.remove_child(searchEntry);

        const topBar = new TopBar();
        topBar.clip_to_allocation = false;

        thumbnailsBox.x_expand = false;
        thumbnailsBox.y_expand = false;
        thumbnailsBox.set_height(THUMBNAILS_BOX_HEIGHT);
        thumbnailsBox.x_align = Clutter.ActorAlign.CENTER;
        thumbnailsBox.y_align = Clutter.ActorAlign.CENTER;

        searchEntry.x_expand = false;
        searchEntry.y_expand = false;
        searchEntry.x_align = Clutter.ActorAlign.CENTER;
        searchEntry.y_align = Clutter.ActorAlign.CENTER;
        searchEntry.translation_y = 0;

        if (
            this._originalThumbnailsParent &&
            thumbnailsBox.get_parent() === this._originalThumbnailsParent
        ) {
            this._originalThumbnailsParent.remove_child(thumbnailsBox);
        }

        topBar.add_child(searchEntry);
        topBar.add_child(thumbnailsBox);

        thumbnailsBox.x_expand = false;
        thumbnailsBox.y_expand = false;
        thumbnailsBox.x_align = Clutter.ActorAlign.CENTER;
        thumbnailsBox.y_align = Clutter.ActorAlign.CENTER;

        searchEntryBin.child = topBar;
        this._topBar = topBar;

        const spacer = new St.Widget({
            visible: false,
            reactive: false,
        });

        this._thumbnailLayoutSpacer = spacer;
        this._layoutManager._workspacesThumbnails = spacer;

        return true;
    }

    _applyThumbnailVerticalOffset(thumbnailsBox) {
        const actors = [
            ...(thumbnailsBox?._thumbnails ?? []),
            thumbnailsBox?._indicator,
            thumbnailsBox?._dropPlaceholder,
        ];

        for (const actor of actors) {
            if (!actor || actor.is_destroyed?.()) continue;

            if (actor._altOverviewOriginalTranslationY === undefined)
                actor._altOverviewOriginalTranslationY = actor.translation_y;

            actor.translation_y = THUMBNAIL_VERTICAL_OFFSET;
        }
    }

    _restoreThumbnailVerticalOffset(thumbnailsBox) {
        const actors = [
            ...(thumbnailsBox?._thumbnails ?? []),
            thumbnailsBox?._indicator,
            thumbnailsBox?._dropPlaceholder,
        ];

        for (const actor of actors) {
            if (!actor || actor.is_destroyed?.()) continue;

            if (actor._altOverviewOriginalTranslationY !== undefined) {
                actor.translation_y = actor._altOverviewOriginalTranslationY;
                delete actor._altOverviewOriginalTranslationY;
            }
        }
    }

    _updateThumbnailScale(thumbnailsBox) {
        const portholeHeight = thumbnailsBox?._porthole?.height;
        if (!Number.isFinite(portholeHeight) || portholeHeight <= 0) return;

        thumbnailsBox._maxThumbnailScale = Math.min(
            1,
            THUMBNAIL_HEIGHT / portholeHeight,
        );
        thumbnailsBox.queue_relayout();
    }

    updateSearchEntry(show) {
        const searchEntry = this._searchEntry;
        if (!searchEntry || searchEntry.is_destroyed?.()) return;

        searchEntry.visible = show;
        searchEntry.set_height(show ? -1 : 0);
        searchEntry.translation_y = 0;
        searchEntry.queue_relayout();
        searchEntry.get_parent()?.queue_relayout();
        this._topBar?.queue_relayout();
    }

    setVisible(visible) {
        if (this._topBar && !this._topBar.is_destroyed?.())
            this._topBar.visible = visible;
    }

    destroy() {
        const topBar = this._topBar;
        const searchEntryBin = this._searchEntryBin;
        const searchEntry = this._searchEntry;
        const thumbnailsBox = this._thumbnailsBox;
        const controls = this._controls;

        if (
            this._layoutManager &&
            thumbnailsBox &&
            !thumbnailsBox.is_destroyed?.()
        ) {
            this._layoutManager._workspacesThumbnails = thumbnailsBox;
        }

        if (
            topBar &&
            !topBar.is_destroyed?.() &&
            searchEntry &&
            !searchEntry.is_destroyed?.()
        ) {
            if (searchEntry.get_parent() === topBar)
                topBar.remove_child(searchEntry);

            if (searchEntryBin && !searchEntryBin.is_destroyed?.())
                searchEntryBin.child = searchEntry;
        }

        if (
            topBar &&
            !topBar.is_destroyed?.() &&
            thumbnailsBox &&
            !thumbnailsBox.is_destroyed?.() &&
            thumbnailsBox.get_parent() === topBar
        ) {
            topBar.remove_child(thumbnailsBox);
        }

        const thumbnailsParent =
            this._originalThumbnailsParent &&
            !this._originalThumbnailsParent.is_destroyed?.()
                ? this._originalThumbnailsParent
                : controls;

        if (
            thumbnailsParent &&
            !thumbnailsParent.is_destroyed?.() &&
            thumbnailsBox &&
            !thumbnailsBox.is_destroyed?.() &&
            thumbnailsBox.get_parent() !== thumbnailsParent
        ) {
            const index =
                this._originalThumbnailsIndex >= 0
                    ? Math.min(
                          this._originalThumbnailsIndex,
                          thumbnailsParent.get_n_children(),
                      )
                    : thumbnailsParent.get_n_children();

            thumbnailsParent.insert_child_at_index(thumbnailsBox, index);
        }

        if (thumbnailsBox && !thumbnailsBox.is_destroyed?.()) {
            this._restoreThumbnailVerticalOffset(thumbnailsBox);

            if (
                this._wrappedThumbnailsAddThumbnails &&
                thumbnailsBox.addThumbnails ===
                    this._wrappedThumbnailsAddThumbnails
            ) {
                thumbnailsBox.addThumbnails =
                    this._originalThumbnailsAddThumbnails;
            }

            thumbnailsBox.set_height(
                this._originalThumbnailsHeightRequest ?? -1,
            );
            thumbnailsBox.x_expand = this._originalThumbnailsXExpand;
            thumbnailsBox.y_expand = this._originalThumbnailsYExpand;
            thumbnailsBox.x_align = this._originalThumbnailsXAlign;
            thumbnailsBox.y_align = this._originalThumbnailsYAlign;
            thumbnailsBox.set_style(this._originalThumbnailsStyle);

            if (typeof this._originalThumbnailsUpdatePorthole === "function")
                thumbnailsBox._updatePorthole =
                    this._originalThumbnailsUpdatePorthole;

            if (Number.isFinite(this._originalThumbnailsMaxScale))
                thumbnailsBox._maxThumbnailScale =
                    this._originalThumbnailsMaxScale;

            if (Number.isFinite(this._originalThumbnailsTranslationY))
                thumbnailsBox.translation_y =
                    this._originalThumbnailsTranslationY;

            thumbnailsBox.queue_relayout();
        }

        if (
            this._thumbnailLayoutSpacer &&
            !this._thumbnailLayoutSpacer.is_destroyed?.()
        ) {
            this._thumbnailLayoutSpacer.destroy();
        }
        this._thumbnailLayoutSpacer = null;

        if (topBar && !topBar.is_destroyed?.()) {
            if (topBar.get_parent()) topBar.get_parent().remove_child(topBar);
            topBar.destroy();
        }

        this._topBar = null;
        this._controls = null;
        this._searchEntryBin = null;
        this._thumbnailsBox = null;
        this._originalThumbnailsParent = null;
        this._originalThumbnailsIndex = -1;
        this._originalThumbnailsXExpand = null;
        this._originalThumbnailsYExpand = null;
        this._originalThumbnailsXAlign = null;
        this._originalThumbnailsYAlign = null;
        this._originalThumbnailsHeightRequest = null;
        this._originalThumbnailsTranslationY = null;
        this._originalThumbnailsMaxScale = null;
        this._originalThumbnailsUpdatePorthole = null;
        this._originalThumbnailsStyle = null;
        this._originalThumbnailsAddThumbnails = null;
        this._wrappedThumbnailsAddThumbnails = null;

        if (searchEntry && !searchEntry.is_destroyed?.()) {
            searchEntry.visible = true;
            searchEntry.set_height(-1);
            searchEntry.translation_y = 0;
        }
    }
}
