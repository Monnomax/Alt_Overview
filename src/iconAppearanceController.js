import Clutter from "gi://Clutter";
export const APP_ICON_SIZES = {
    smallest: 60,
    small: 70,
    normal: 80,
    large: 90,
    largest: 100,
};

export const ICON_TEXTURE_OVERSAMPLE = 1.5;
export const LABEL_OFFSET_Y = 40;
export const APP_ICON_TILE_SIZE = 150;
export const HOVER_Z_POSITION = 0.00000001;
export const TILE_REFERENCE_SCALE = 1.5;

export class IconAppearanceController {
    constructor(
        settings,
        appDisplay,
        runningIndicators,
        isActorUsable,
        geometryDiagnostics,
    ) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._runningIndicators = runningIndicators;
        this._isActorUsable = isActorUsable;
        this._geometryDiagnostics = geometryDiagnostics;
    }

    updateNamesVisibility(ensureHoverHandler) {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (!appDisplay || !grid) return;

        const mode = this._settings.get_string("app-grid-names-visibility");
        const processItem = (item, isFolderViewItem = false) => {
            if (!item || item.is_destroyed?.()) return;

            this.applyNameVisibilityMode(
                item,
                mode,
                isFolderViewItem,
                ensureHoverHandler,
            );
        };

        for (let index = 0; index < grid.get_n_children(); index++)
            processItem(grid.get_child_at_index(index));

        for (const folderIcon of appDisplay._folderIcons ?? []) {
            const folderView = folderIcon?.view;

            if (!this._isActorUsable(folderView)) continue;

            try {
                for (const item of folderView.getAllItems?.() ?? [])
                    processItem(item, true);
            } catch (_error) {}
        }
    }

    applyNameVisibilityMode(item, mode, isFolderViewItem, ensureHoverHandler) {
        if (!item || !this._isActorUsable(item)) return;

        const baseIcon = item.icon;
        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const icon = baseIcon.icon;
        const label = baseIcon.label;

        if (icon && !this._isActorUsable(icon)) return;
        if (label && !this._isActorUsable(label)) return;
        if (!label) return;

        ensureHoverHandler(item, isFolderViewItem);

        const shouldShow =
            mode === "always" ||
            (mode === "hover" && item._chIconHovered === true);
        const modeChanged = item._chNameVisibilityMode !== mode;

        if (modeChanged) {
            item._chLabelOpacityGeneration =
                (item._chLabelOpacityGeneration ?? 0) + 1;
            label.remove_transition("opacity");
            item._chNameVisibilityMode = mode;
        } else if (label.get_transition("opacity")) {
            return;
        }

        label.opacity = shouldShow ? 255 : 0;
        label.visible = shouldShow;
    }

    lockTileSize(item) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return null;

        this.installFixedPreferredSize(item);
        return APP_ICON_TILE_SIZE;
    }

    applyIconSize(item) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return;

        const baseIcon = item.icon;
        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const icon = baseIcon.icon;
        if (!icon || icon.is_destroyed?.() || !this._isActorUsable(icon))
            return;

        const key = this._settings.get_string("app-grid-icon-size");
        const size = APP_ICON_SIZES[key] ?? APP_ICON_SIZES.normal;

        this._installFixedIconPreferredSize(icon, size);
        icon._chIconSizeScale = 1.0;
        icon.icon_size = Math.round(size * ICON_TEXTURE_OVERSAMPLE);
        icon.set_size(size, size);
        icon.set_pivot_point(0.5, 0.5);

        this._runningIndicators.ensureOverlay(item, size);

        const iconBinRef = baseIcon._iconBin;
        const iconBin =
            iconBinRef && this._isActorUsable(iconBinRef) ? iconBinRef : null;
        const iconContainerRef = item._iconContainer;
        const iconContainer =
            iconContainerRef && this._isActorUsable(iconContainerRef)
                ? iconContainerRef
                : null;

        icon.clip_to_allocation = false;

        if (iconBin) {
            if (iconBin._chOriginalIconBinYAlign === undefined)
                iconBin._chOriginalIconBinYAlign = iconBin.y_align;

            iconBin.clip_to_allocation = false;
            iconBin.y_align = Clutter.ActorAlign.CENTER;

            if (iconBin._chOriginalIconBinYExpand === undefined)
                iconBin._chOriginalIconBinYExpand = iconBin.y_expand;

            iconBin.y_expand = true;
        }

        baseIcon.clip_to_allocation = false;
        if (iconContainer) iconContainer.clip_to_allocation = false;
        item.clip_to_allocation = false;

        if (!item.has_style_class_name?.("app-folder"))
            this.ensureLabelOverlay(item);

        this._geometryDiagnostics.schedule(this._appDisplay, "enabled");
    }

    animateLabelVisibility(item, visible, getCurveDuration) {
        if (!this._isActorUsable(item)) return;

        const label = item.icon?.label;
        if (!this._isActorUsable(label)) return;

        const curveName = this._settings.get_string(
            "app-grid-icon-hover-curve",
        );
        const durationKey = visible
            ? "app-grid-icon-hover-in-durations"
            : "app-grid-icon-hover-out-durations";
        const duration = getCurveDuration(durationKey, curveName);
        const generation = (item._chLabelOpacityGeneration ?? 0) + 1;
        item._chLabelOpacityGeneration = generation;

        label.remove_transition("opacity");

        if (visible) {
            if (!label.visible) label.opacity = 0;

            label.visible = true;
        }

        label.ease({
            opacity: visible ? 255 : 0,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            duration,
            onComplete: () => {
                if (
                    !this._isActorUsable(item) ||
                    !this._isActorUsable(label) ||
                    item._chLabelOpacityGeneration !== generation
                )
                    return;

                if (
                    !visible &&
                    item._chIconHovered !== true &&
                    this._settings.get_string("app-grid-names-visibility") ===
                        "hover"
                )
                    label.visible = false;
            },
        });
    }

    ensureLabelOverlay(item) {
        const baseIcon = item?.icon;
        const label = baseIcon?.label;
        const container = item?._iconContainer;
        const icon = baseIcon?.icon;

        if (!label || !container || !icon) return;

        if (label.get_parent() !== container) {
            const parent = label.get_parent();
            if (parent) parent.remove_child(label);
            container.add_child(label);
        }

        label.x_expand = false;
        label.y_expand = false;
        label.x_align = Clutter.ActorAlign.CENTER;
        label.y_align = Clutter.ActorAlign.START;
        label.set_width(APP_ICON_TILE_SIZE);
        label.clip_to_allocation = false;

        if (!label._chSingleLineHeight) {
            const [, naturalHeight] =
                label.get_preferred_height(APP_ICON_TILE_SIZE);

            if (Number.isFinite(naturalHeight) && naturalHeight > 0)
                label._chSingleLineHeight = naturalHeight;
        }

        if (
            Number.isFinite(label._chSingleLineHeight) &&
            label._chSingleLineHeight > 0
        )
            label.set_height(label._chSingleLineHeight * 4);

        label.clutter_text.set({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const key = this._settings.get_string("app-grid-icon-size");
        const size = APP_ICON_SIZES[key] ?? APP_ICON_SIZES.normal;
        label.translation_y = LABEL_OFFSET_Y + size / 2;
    }

    installFixedPreferredSize(item) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return;

        if (item._chFixedPreferredSizeInstalled) return;

        const original = item.get_preferred_size;
        if (typeof original !== "function") return;

        item._chOriginalGetPreferredSize = original;
        item.get_preferred_size = function () {
            const size = this._chFixedPreferredSize;
            if (Number.isFinite(size) && size > 0)
                return [size, size, size, size];

            return this._chOriginalGetPreferredSize.call(this);
        };
        item._chFixedPreferredSizeInstalled = true;
        item._chFixedPreferredSize = APP_ICON_TILE_SIZE;
    }

    _installFixedIconPreferredSize(icon, size) {
        if (!icon || icon.is_destroyed?.() || !this._isActorUsable(icon))
            return;

        if (icon._chFixedPreferredSizeInstalled) {
            icon._chFixedPreferredSize = size;
            return;
        }

        const original = icon.get_preferred_size;
        if (typeof original !== "function") return;

        icon._chOriginalGetPreferredSize = original;
        icon.get_preferred_size = function () {
            const fixedSize = this._chFixedPreferredSize;
            if (Number.isFinite(fixedSize) && fixedSize > 0)
                return [fixedSize, fixedSize, fixedSize, fixedSize];

            return this._chOriginalGetPreferredSize.call(this);
        };
        icon._chFixedPreferredSizeInstalled = true;
        icon._chFixedPreferredSize = size;
    }
}
