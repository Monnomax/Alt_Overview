import Pango from "gi://Pango";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import { FolderView } from "resource:///org/gnome/shell/ui/appDisplay.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { IconAnimator } from "./iconAnimations.js";
import { RunningIndicators } from "./runningIndicators.js";
import { FolderDragDiagnostics } from "./folderDragDiagnostics.js";

function openDesktopFileForIcon(item) {
    const appInfo = item?.app?.get_app_info?.();
    const filename = appInfo?.get_filename?.();
    if (!filename) return;

    try {
        const uri = Gio.File.new_for_path(filename).get_uri();
        Gio.AppInfo.launch_default_for_uri(uri, null);
    } catch (error) {
        logError(error, `Could not open desktop file: ${filename}`);
    }
}

export class IconInteractionController {
    static ICON_TEXTURE_OVERSAMPLE = 1.5;

    static ICON_SIZE = {
        smallest: 60,
        small: 70,
        normal: 80,
        large: 90,
        largest: 100,
    };

    static LABEL_OFFSET_Y = 40;
    static APP_ICON_TILE_SIZE = 150;
    static HOVER_Z_POSITION = 0.00000001;

    static TILE_REFERENCE_SCALE = 1.5;

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._runningIndicators = new RunningIndicators();

        this._folderDragDiagnosticsController = new FolderDragDiagnostics(
            appDisplay,
        );

        /*
         * GNOME 50.1 BaseAppView._onDestroy() does not reset
         * FolderView drag-page-switch timeouts.
         *
         * Cancel them during unmap instead of connecting additional
         * JavaScript callbacks to the actor's destroy signal.
         */
        this._folderViewInjectionManager = new InjectionManager();

        this._folderViewInjectionManager.overrideMethod(
            FolderView.prototype,
            "vfunc_unmap",
            (originalMethod) => {
                return function (...args) {
                    this._resetDragPageSwitch?.();
                    return originalMethod.apply(this, args);
                };
            },
        );

        this._viewLoadedId = appDisplay.connect("view-loaded", () =>
            this.updateNamesVisibility(),
        );

        this._openDesktopFileMenuChangedId = settings.connect(
            "changed::app-grid-show-open-desktop-file",
            () => this._updateOpenDesktopFileMenuItems(),
        );
    }

    _isActorUsable(actor) {
        if (
            !actor ||
            (typeof actor !== "object" && typeof actor !== "function")
        )
            return false;

        try {
            if (actor._destroyed) return false;

            return !actor.is_destroyed?.();
        } catch (_error) {
            return false;
        }
    }

    _disconnectSignalSafely(actor, handlerId) {
        if (!handlerId || !this._isActorUsable(actor)) return;

        try {
            if (GObject.signal_handler_is_connected(actor, handlerId))
                actor.disconnect(handlerId);
        } catch (_error) {
            // The actor or its signal connection may already be gone.
        }
    }

    _removeActionSafely(actor, action) {
        if (!action || !this._isActorUsable(actor)) return;

        try {
            const actions = actor.get_actions?.();

            if (!actions || actions.includes(action))
                actor.remove_action(action);
        } catch (_error) {
            // The actor may have been disposed during DND teardown.
        }
    }

    _resolveNominalSize(icon, baseSize) {
        const raw =
            Number.isFinite(baseSize) && baseSize > 0
                ? baseSize
                : icon._chOriginalIconSize;

        return Math.max(
            1,
            Math.round(raw * IconInteractionController.TILE_REFERENCE_SCALE),
        );
    }

    updateNamesVisibility() {
        const appDisplay = this._appDisplay;
        const grid = appDisplay?._grid;

        if (!appDisplay || !grid) return;

        const mode = this._settings.get_string("app-grid-names-visibility");

        const processItem = (item, isFolderViewItem = false) => {
            if (!item || item.is_destroyed?.()) return;

            this.applyNameVisibilityMode(item, mode, isFolderViewItem);
        };

        /*
         * Основний AppGrid.
         */
        for (let index = 0; index < grid.get_n_children(); index++) {
            processItem(grid.get_child_at_index(index));
        }

        /*
         * AppIcons усередині папок.
         *
         * FolderView має власний AppGrid, тому звичайний цикл вище
         * до них не доходить.
         */
        for (const folderIcon of appDisplay._folderIcons ?? []) {
            const folderView = folderIcon?.view;

            if (!this._isActorUsable(folderView)) continue;

            try {
                for (const item of folderView.getAllItems?.() ?? [])
                    processItem(item, true);
            } catch (_error) {
                // FolderView може перебувати на етапі знищення.
            }
        }
    }

    applyNameVisibilityMode(item, mode, isFolderViewItem = false) {
        if (!item || !this._isActorUsable(item)) return;

        const baseIcon = item.icon;

        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const icon = baseIcon.icon;
        const label = baseIcon.label;

        if (icon && !this._isActorUsable(icon)) return;
        if (label && !this._isActorUsable(label)) return;

        if (!label) return;

        this._ensureHoverHandler(item, isFolderViewItem);

        const shouldShow =
            mode === "always" ||
            (mode === "hover" && item._chIconHovered === true);

        /*
         * Do not interrupt an active fade when GNOME redisplays the grid.
         * Reset opacity only when the visibility mode changes or no
         * transition is currently running.
         */
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

    lockTileSize(item, _baseSize = null) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return null;

        this._installFixedPreferredSize(item);

        return IconInteractionController.APP_ICON_TILE_SIZE;
    }

    applyIconSize(item, _baseSize = null) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return;

        const baseIcon = item.icon;

        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const icon = baseIcon.icon;

        if (!icon || icon.is_destroyed?.() || !this._isActorUsable(icon))
            return;

        const key = this._settings.get_string("app-grid-icon-size");

        const size =
            IconInteractionController.ICON_SIZE[key] ??
            IconInteractionController.ICON_SIZE.normal;

        this._installFixedIconPreferredSize(icon, size);

        icon._chIconSizeScale = 1.0;

        icon.icon_size = Math.round(
            size * IconInteractionController.ICON_TEXTURE_OVERSAMPLE,
        );

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
            iconBin.clip_to_allocation = false;
            iconBin.y_align = Clutter.ActorAlign.CENTER;
        }

        baseIcon.clip_to_allocation = false;

        if (iconContainer) iconContainer.clip_to_allocation = false;

        item.clip_to_allocation = false;

        if (!item.has_style_class_name?.("app-folder"))
            this._ensureLabelOverlay(item);
    }

    disable() {
        this._folderDragDiagnosticsController?.destroy();
        this._folderDragDiagnosticsController = null;

        const grid = this._appDisplay?._grid;
        const folderViews = (this._appDisplay?._folderIcons ?? [])
            .map((folderIcon) => folderIcon?.view)
            .filter((folderView) => this._isActorUsable(folderView));
        const items = new Set();
        const folderItems = new Set();

        // Основна сітка.
        if (grid) {
            for (let index = 0; index < grid.get_n_children(); index++) {
                const item = grid.get_child_at_index(index);
                if (item) items.add(item);
            }
        }

        // Вміст усіх FolderView, які відстежує контролер.
        for (const folderView of folderViews) {
            if (!this._isActorUsable(folderView)) continue;

            try {
                for (const item of folderView.getAllItems?.() ?? []) {
                    if (!item) continue;

                    items.add(item);
                    folderItems.add(item);
                }
            } catch (_error) {
                // FolderView може перебувати на етапі знищення.
            }
        }

        /*
         * BaseAppView._onDestroy() не скасовує таймери
         * перемикання сторінок FolderView.
         * Очищаємо їх перед від'єднанням нашого override.
         */
        for (const folderView of folderViews) {
            if (!this._isActorUsable(folderView)) continue;

            try {
                folderView._resetDragPageSwitch?.();
            } catch (_error) {
                // FolderView може вже перебувати на етапі знищення.
            }
        }

        this._folderViewInjectionManager?.clear();

        if (this._openDesktopFileMenuChangedId) {
            this._settings.disconnect(this._openDesktopFileMenuChangedId);
            this._openDesktopFileMenuChangedId = 0;
        }

        if (this._viewLoadedId) {
            this._appDisplay.disconnect(this._viewLoadedId);
            this._viewLoadedId = 0;
        }

        for (const item of items) {
            if (!item || !this._isActorUsable(item)) continue;

            /*
             * FolderView AppIcon не проходить через звичайний шлях
             * налаштування взаємодії. Відновлюємо лише те, що змінили:
             * видимість підпису та native LongPressGesture.
             */
            if (folderItems.has(item)) {
                const baseIconRef = item.icon;
                const baseIcon =
                    baseIconRef && this._isActorUsable(baseIconRef)
                        ? baseIconRef
                        : null;

                if (baseIcon) {
                    const labelRef = baseIcon.label;
                    const label =
                        labelRef && this._isActorUsable(labelRef)
                            ? labelRef
                            : null;

                    if (label) {
                item._chLabelOpacityGeneration =
                    (item._chLabelOpacityGeneration ?? 0) + 1;

                label.remove_transition("opacity");
                label.opacity = 255;
                label.visible = true;
            }
                }

                if (item._chFolderLongPressGesture) {
                    try {
                        const actions = item.get_actions?.() ?? [];

                        if (!actions.includes(item._chFolderLongPressGesture))
                            item.add_action(item._chFolderLongPressGesture);
                    } catch (_error) {
                        // AppIcon може вже завершувати знищення.
                    }

                    item._chFolderLongPressGesture = null;
                }

                item._chFolderViewInteractionHandled = false;
                continue;
            }

            if (item._chOpenDesktopFileMenuItem)
                item._chOpenDesktopFileMenuItem.visible = false;

            if (item._chOriginalPopupMenu) {
                if (item._chPopupMenuHadOwnProperty)
                    item.popupMenu = item._chOriginalPopupMenu;
                else delete item.popupMenu;

                delete item._chOriginalPopupMenu;
                delete item._chPopupMenuHadOwnProperty;
            }

            const baseIconRef = item.icon;
            const baseIcon =
                baseIconRef && this._isActorUsable(baseIconRef)
                    ? baseIconRef
                    : null;

            const labelRef = baseIcon?.label;
            const label =
                labelRef && this._isActorUsable(labelRef) ? labelRef : null;

            const iconRef = baseIcon?.icon;
            const icon =
                iconRef && this._isActorUsable(iconRef) ? iconRef : null;

            const iconBinRef = baseIcon?._iconBin;
            const iconBin =
                iconBinRef && this._isActorUsable(iconBinRef)
                    ? iconBinRef
                    : null;

            const iconBoxRef = baseIcon?._box;
            const iconBox =
                iconBoxRef && this._isActorUsable(iconBoxRef)
                    ? iconBoxRef
                    : null;

            const iconContainerRef = item._iconContainer;
            const iconContainer =
                iconContainerRef && this._isActorUsable(iconContainerRef)
                    ? iconContainerRef
                    : null;

            if (
                label &&
                iconBox &&
                iconContainer &&
                label.get_parent() === iconContainer
            ) {
                iconContainer.remove_child(label);
                iconBox.add_child(label);

                label.set_width(-1);
                label.translation_y = 0;

                label.x_align = Clutter.ActorAlign.FILL;
                label.y_align = Clutter.ActorAlign.FILL;

                label.x_expand = false;
                label.y_expand = false;

                label.clip_to_allocation = true;

                iconBox.queue_relayout();
            }

            if (label) {
                item._chLabelOpacityGeneration =
                    (item._chLabelOpacityGeneration ?? 0) + 1;

                label.remove_transition("opacity");
                label.opacity = 255;
                label.visible = true;
            }

            try {
                this._runningIndicators.restore(item, icon, iconBin);
            } catch (_error) {
                // Індикатор може втратити свій актор під час teardown.
            }

            if (icon) {
                IconAnimator.reset(icon);

                if (icon._chFixedPreferredSizeInstalled) {
                    icon.get_preferred_size = icon._chOriginalGetPreferredSize;

                    icon._chOriginalGetPreferredSize = null;
                    icon._chFixedPreferredSize = null;
                    icon._chFixedPreferredSizeInstalled = false;
                }

                icon.set_scale(1.0, 1.0);
                icon.set_size(-1, -1);
            }

            if (item._chRightClickGesture && item._chRightClickGestureActor) {
                this._removeActionSafely(
                    item._chRightClickGestureActor,
                    item._chRightClickGesture,
                );
            }

            if (item._chMiddleClickGesture && item._chMiddleClickGestureActor) {
                this._removeActionSafely(
                    item._chMiddleClickGestureActor,
                    item._chMiddleClickGesture,
                );
            }

            item._chMiddleClickGesture = null;
            item._chMiddleClickGestureActor = null;

            item._chRightClickGesture = null;
            item._chRightClickGestureActor = null;

            if (item._chLeftClickGesture && item._chLeftClickGestureActor) {
                this._removeActionSafely(
                    item._chLeftClickGestureActor,
                    item._chLeftClickGesture,
                );
            }

            item._chLeftClickGesture = null;
            item._chLeftClickGestureActor = null;

            if (item._chDndReactiveLockId) {
                try {
                    item._draggable?.disconnect(item._chDndReactiveLockId);
                } catch (_error) {
                    // Draggable may already have disconnected.
                }

                item._chDndReactiveLockId = 0;
            }

            item.reactive = true;
            item.track_hover = true;

            if (item._chOriginalButtonMask !== undefined) {
                item.button_mask = item._chOriginalButtonMask;
                item._chOriginalButtonMask = undefined;
            }

            if (icon) icon.reactive = false;

            const hoverIcon = item._chHoverIcon ?? icon;

            if (hoverIcon) {
                this._disconnectSignalSafely(hoverIcon, item._chIconEnterId);

                this._disconnectSignalSafely(hoverIcon, item._chIconLeaveId);

                item._chIconEnterId = 0;
                item._chIconLeaveId = 0;
            }

            item._chHoverIcon = null;
            item._chHoverInteractionInstalled = false;
            item._chIconHovered = false;

            if (item._chHoverHandlerId) {
                this._disconnectSignalSafely(item, item._chHoverHandlerId);

                item._chHoverHandlerId = 0;
            }

            if (item._chPressHandlerId) {
                this._disconnectSignalSafely(item, item._chPressHandlerId);

                item._chPressHandlerId = 0;
            }

            if (item._chOriginalUpdateMultiline) {
                item._updateMultiline = item._chOriginalUpdateMultiline;

                item._chOriginalUpdateMultiline = null;
            }

            if (item._chFixedPreferredSizeInstalled) {
                item.get_preferred_size = item._chOriginalGetPreferredSize;

                item._chOriginalGetPreferredSize = null;
                item._chFixedPreferredSize = null;
                item._chFixedPreferredSizeInstalled = false;
            }

            item.clip_to_allocation = true;

            if (baseIcon) baseIcon.clip_to_allocation = true;

            if (iconBin) iconBin.clip_to_allocation = true;

            if (icon) icon.clip_to_allocation = true;

            if (iconContainer) iconContainer.clip_to_allocation = true;

            item.z_position = 0;
        }
    }

    _animate(item, kind, activeOverride = null) {
        if (!item || !this._isActorUsable(item)) return;

        const baseIcon = item.icon;

        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const icon = baseIcon.icon;

        if (!icon || !this._isActorUsable(icon)) return;

        const overlay = item._chRunningOverlay;
        const animationActor =
            overlay && this._isActorUsable(overlay) ? overlay : icon;

        const active =
            activeOverride !== null
                ? activeOverride
                : kind === "press"
                  ? item.pressed
                  : item.hover;

        const prefix =
            kind === "press" ? "app-grid-icon-press" : "app-grid-icon-hover";

        const curveName = this._settings.get_string(`${prefix}-curve`);

        IconAnimator.scale(animationActor, {
            active,
            targetScale: this._settings.get_double(`${prefix}-scale`),
            curveName,

            inDuration: this._getCurveDuration(
                `${prefix}-in-durations`,
                curveName,
            ),

            outDuration: this._getCurveDuration(
                `${prefix}-out-durations`,
                curveName,
            ),
        });
    }

    _getCurveDuration(key, curveName) {
        const values = this._settings.get_value(key).deep_unpack();
        return curveName in values ? values[curveName] : 200;
    }

    _animateLabelVisibility(item, visible) {
        if (!this._isActorUsable(item)) return;

        const label = item.icon?.label;

        if (!this._isActorUsable(label)) return;

        const curveName = this._settings.get_string(
            "app-grid-icon-hover-curve",
        );

        /*
         * Opacity must change monotonically.
         * Bounce/Elastic/Back curves make text fade in and out repeatedly.
         * Keep the icon's selected curve, but use a smooth fade for its label.
         */
        const animationMode = Clutter.AnimationMode.EASE_OUT_QUAD;

        const durationKey = visible
            ? "app-grid-icon-hover-in-durations"
            : "app-grid-icon-hover-out-durations";

        const duration = this._getCurveDuration(
            durationKey,
            curveName,
        );

        /*
         * A generation token prevents an obsolete fade-out callback
         * from hiding a label that has already started fading in again.
         */
        const generation = (item._chLabelOpacityGeneration ?? 0) + 1;
        item._chLabelOpacityGeneration = generation;

        label.remove_transition("opacity");

        if (visible) {
            /*
             * Start from zero only when the label was actually hidden.
             * If it is already fading out, continue from current opacity.
             */
            if (!label.visible)
                label.opacity = 0;

            label.visible = true;
        }

        label.ease({
            opacity: visible ? 255 : 0,
            mode: animationMode,
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
                    this._settings.get_string(
                        "app-grid-names-visibility",
                    ) === "hover"
                )
                    label.visible = false;
            },
        });
    }

    _ensureLabelOverlay(item) {
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

        const labelWidth = IconInteractionController.APP_ICON_TILE_SIZE;

        label.set_width(labelWidth);

        label.clip_to_allocation = false;

        if (!label._chSingleLineHeight) {
            const [, naturalHeight] = label.get_preferred_height(labelWidth);

            if (Number.isFinite(naturalHeight) && naturalHeight > 0)
                label._chSingleLineHeight = naturalHeight;
        }

        if (
            Number.isFinite(label._chSingleLineHeight) &&
            label._chSingleLineHeight > 0
        ) {
            label.set_height(label._chSingleLineHeight * 4);
        }

        label.clutter_text.set({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const key = this._settings.get_string("app-grid-icon-size");

        const size =
            IconInteractionController.ICON_SIZE[key] ??
            IconInteractionController.ICON_SIZE.normal;

        label.translation_y =
            IconInteractionController.LABEL_OFFSET_Y + size / 2;
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

    _installFixedPreferredSize(item) {
        if (!item || item.is_destroyed?.() || !this._isActorUsable(item))
            return;

        if (item._chFixedPreferredSizeInstalled) return;

        const original = item.get_preferred_size;

        if (typeof original !== "function") return;

        item._chOriginalGetPreferredSize = original;

        item.get_preferred_size = function () {
            const size = this._chFixedPreferredSize;

            if (Number.isFinite(size) && size > 0) {
                return [size, size, size, size];
            }

            return this._chOriginalGetPreferredSize.call(this);
        };

        item._chFixedPreferredSizeInstalled = true;

        this._refreshFixedPreferredSize(item);
    }

    _refreshFixedPreferredSize(item) {
        if (!item) return;

        item._chFixedPreferredSize =
            IconInteractionController.APP_ICON_TILE_SIZE;
    }

    _closeActiveAppWindow(item) {
        const app = item?.app;
        const focusedWindow = global.display?.focus_window;

        if (!app || !focusedWindow) return;

        const windows = app.get_windows?.() ?? [];

        if (!windows.includes(focusedWindow)) return;

        if (!focusedWindow.can_close?.()) return;

        focusedWindow.delete(global.get_current_time());
    }

    _ensureOpenDesktopFileMenuHook(item) {
        if (item._chOriginalPopupMenu || typeof item.popupMenu !== "function")
            return;

        item._chPopupMenuHadOwnProperty = Object.prototype.hasOwnProperty.call(
            item,
            "popupMenu",
        );
        item._chOriginalPopupMenu = item.popupMenu;

        const controller = this;
        const originalPopupMenu = item._chOriginalPopupMenu;
        item.popupMenu = function (...args) {
            const result = originalPopupMenu.apply(this, args);
            controller._ensureOpenDesktopFileMenu(this);
            return result;
        };
    }

    _ensureOpenDesktopFileMenu(item) {
        const menu = item?._menu;
        if (!menu) return;

        const enabled = this._settings.get_boolean(
            "app-grid-show-open-desktop-file",
        );

        if (!item._chOpenDesktopFileMenuItem && !enabled) return;

        if (item._chOpenDesktopFileMenu !== menu) {
            const menuItem = new PopupMenu.PopupMenuItem("Відкрити .desktop");
            menuItem.connect("activate", () => {
                openDesktopFileForIcon(item);
                Main.overview.hide();
            });
            menu.addMenuItem(menuItem);

            item._chOpenDesktopFileMenu = menu;
            item._chOpenDesktopFileMenuItem = menuItem;
        }

        item._chOpenDesktopFileMenuItem.visible = enabled;
    }

    _updateOpenDesktopFileMenuItems() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);
            if (item?._menu && !item.has_style_class_name?.("app-folder")) {
                this._ensureOpenDesktopFileMenu(item);
            }
        }
    }

    _removeFolderLongPressGesture(item) {
        if (!this._isActorUsable(item)) return;

        for (const action of item.get_actions?.() ?? []) {
            if (action instanceof Clutter.LongPressGesture) {
                item._chFolderLongPressGesture = action;
                this._removeActionSafely(item, action);
                break;
            }
        }
    }

    _ensureHoverHandler(item, isFolderViewItem = false) {
        if (!item || !this._isActorUsable(item)) return;

        const baseIcon = item.icon;

        if (!baseIcon || !this._isActorUsable(baseIcon)) return;

        const label = baseIcon.label;
        if (label && !this._isActorUsable(label)) return;

        const icon = baseIcon.icon;

        if (!icon || !this._isActorUsable(icon)) return;

        for (const actor of [
            item._iconContainer,
            baseIcon._box,
            baseIcon._iconBin,
        ]) {
            if (actor && !this._isActorUsable(actor)) return;
        }

        /*
         * AppIcon всередині FolderView залишаємо максимально близьким
         * до native GNOME:
         *
         * - DnD залишається на самому AppViewItem;
         * - native right-click залишається;
         * - прибираємо лише LongPressGesture, яка перехоплює
         *   утримання ЛКМ і викликає popupMenu().
         */
        if (isFolderViewItem) {
            item._chFolderViewInteractionHandled = true;
            this._removeFolderLongPressGesture(item);
            return;
        }

        this._runningIndicators.ensureOverlay(item);

        const isFolder = item.has_style_class_name?.("app-folder") === true;

        if (!isFolder) {
            if (item._chOriginalButtonMask === undefined)
                item._chOriginalButtonMask = item.button_mask;
            // Custom gestures handle clicks instead of St.Button.
            item.button_mask = 0;
        }

        if (!isFolder) {
            this._ensureLabelOverlay(item);
            this._ensureOpenDesktopFileMenuHook(item);
        }

        if (
            !isFolder &&
            item.icon?.label &&
            item._iconContainer &&
            item.icon._box &&
            item.icon.label.get_parent() === item.icon._box
        ) {
            const label = item.icon.label;

            item.icon._box.remove_child(label);
            item._iconContainer.add_child(label);

            label.x_expand = true;
            label.x_align = Clutter.ActorAlign.CENTER;
            label.y_align = Clutter.ActorAlign.END;

            label.queue_relayout();
            item._iconContainer.queue_relayout();
        }

        if (item._chHoverInteractionInstalled && item._chHoverIcon === icon) {
            item.reactive = true;
            item.track_hover = false;
            icon.reactive = true;

            return;
        }

        const oldIcon = item._chHoverIcon;

        if (oldIcon && oldIcon !== icon) {
            /*
             * GNOME may dispose the previous BaseIcon child before
             * AppGrid relayout reaches this method.
             *
             * Do not call GObject or Clutter methods on oldIcon.
             * Its signals and actions belong to the old actor and
             * are released with its destruction.
             */

            item._chIconEnterId = 0;
            item._chIconLeaveId = 0;
            item._chIconHovered = false;

            if (item._chLeftClickGestureActor === oldIcon) {
                item._chLeftClickGesture = null;
                item._chLeftClickGestureActor = null;
            }

            if (item._chRightClickGestureActor === oldIcon) {
                item._chRightClickGesture = null;
                item._chRightClickGestureActor = null;
            }

            if (item._chMiddleClickGestureActor === oldIcon) {
                item._chMiddleClickGesture = null;
                item._chMiddleClickGestureActor = null;
            }
        }

        item._chHoverInteractionInstalled = true;
        item._chHoverIcon = icon;

        // Keep the native DND action on the actor that owns its Draggable.
        item.reactive = true;
        item.track_hover = false;

        icon.reactive = true;

        if (!isFolder && typeof item.activate === "function") {
            const leftClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_PRIMARY,
            });

            leftClickGesture.connect("recognize", () => {
                if (this._isActorUsable(item))
                    item.activate(Clutter.BUTTON_PRIMARY);
            });

            icon.add_action(leftClickGesture);

            item._chLeftClickGesture = leftClickGesture;
            item._chLeftClickGestureActor = icon;
        }

        if (!isFolder && typeof item.popupMenu === "function") {
            const rightClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_SECONDARY,
                recognize_on_press: true,
            });

            rightClickGesture.connect("recognize", () => {
                if (this._isActorUsable(item)) item.popupMenu();
            });

            icon.add_action(rightClickGesture);

            item._chRightClickGesture = rightClickGesture;
            item._chRightClickGestureActor = icon;
        }

        if (!isFolder) {
            const middleClickGesture = new Clutter.ClickGesture({
                required_button: Clutter.BUTTON_MIDDLE,
                recognize_on_press: true,
            });

            middleClickGesture.connect("recognize", () => {
                if (this._isActorUsable(item)) this._closeActiveAppWindow(item);
            });

            icon.add_action(middleClickGesture);

            item._chMiddleClickGesture = middleClickGesture;
            item._chMiddleClickGestureActor = icon;
        }

        if (item._draggable && !item._chDndReactiveLockId) {
            const draggable = item._draggable;

            item._chDndReactiveLockId = draggable.connect("drag-end", () => {
                /*
                 * GNOME AppIcon._onDestroy() clears _draggable.
                 * A folder creation can dispose the source AppIcon
                 * before the drag-end signal is emitted.
                 */
                if (item._draggable !== draggable || !this._isActorUsable(item))
                    return;

                try {
                    item.reactive = true;
                    item.track_hover = false;
                } catch (_error) {
                    // The source actor may be entering teardown.
                }
            });
        }

        this._installFixedPreferredSize(item);

        if (
            !item._chOriginalUpdateMultiline &&
            typeof item._updateMultiline === "function"
        ) {
            item._chOriginalUpdateMultiline = item._updateMultiline;
        }

        const controller = this;

        item._updateMultiline = function () {
            if (!controller._isActorUsable(this)) return;

            const baseIcon = this.icon;

            if (!baseIcon || !controller._isActorUsable(baseIcon)) return;

            const label = baseIcon.label;

            if (
                !label ||
                !controller._isActorUsable(label) ||
                !this._expandTitleOnHover
            )
                return;

            const clutterText = label.clutter_text;

            const expand =
                this._forcedHighlight ||
                this._chIconHovered ||
                this.has_key_focus();

            if (this._expand === expand) return;

            this._expand = expand;

            this.clip_to_allocation = false;
            baseIcon.clip_to_allocation = false;

            if (
                this._iconContainer &&
                controller._isActorUsable(this._iconContainer)
            )
                this._iconContainer.clip_to_allocation = false;

            clutterText.set({
                line_wrap: expand,
                line_wrap_mode: expand
                    ? Pango.WrapMode.WORD_CHAR
                    : Pango.WrapMode.NONE,
                ellipsize: expand
                    ? Pango.EllipsizeMode.NONE
                    : Pango.EllipsizeMode.END,
            });
        };

        item._chIconEnterId = icon.connect("enter-event", () => {
            if (!this._isActorUsable(item) || !this._isActorUsable(icon))
                return Clutter.EVENT_STOP;

            const baseIcon = item.icon;

            if (!baseIcon || !this._isActorUsable(baseIcon))
                return Clutter.EVENT_STOP;

            const label = baseIcon.label;

            item._chIconHovered = true;

            const mode = this._settings.get_string("app-grid-names-visibility");

            if (mode === "hover" && label && this._isActorUsable(label))
                this._animateLabelVisibility(item, true);

            item.clip_to_allocation = false;
            baseIcon.clip_to_allocation = false;

            if (item._iconContainer && this._isActorUsable(item._iconContainer))
                item._iconContainer.clip_to_allocation = false;

            item.z_position = 0.00000001;
            item._updateMultiline();

            this._animate(item, "hover", true);

            return Clutter.EVENT_PROPAGATE;
        });

        item._chIconLeaveId = icon.connect("leave-event", () => {
            if (!this._isActorUsable(item) || !this._isActorUsable(icon))
                return Clutter.EVENT_STOP;

            const baseIcon = item.icon;

            if (!baseIcon || !this._isActorUsable(baseIcon))
                return Clutter.EVENT_STOP;

            const label = baseIcon.label;

            item._chIconHovered = false;

            const mode = this._settings.get_string("app-grid-names-visibility");

            if (mode === "hover" && label && this._isActorUsable(label))
                this._animateLabelVisibility(item, false);

            item.z_position = 0;
            item._updateMultiline();

            this._animate(item, "hover", false);

            return Clutter.EVENT_PROPAGATE;
        });

        item._chPressHandlerId = item.connect("notify::pressed", () => {
            if (this._isActorUsable(item)) this._animate(item, "press");
        });
    }
}
