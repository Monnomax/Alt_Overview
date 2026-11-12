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
import {
    APP_ICON_SIZES,
    APP_ICON_TILE_SIZE,
    HOVER_Z_POSITION,
    ICON_TEXTURE_OVERSAMPLE,
    LABEL_OFFSET_Y,
    TILE_REFERENCE_SCALE,
    IconAppearanceController,
} from "./iconAppearanceController.js";
import { IconGridEntranceController } from "./iconGridEntranceController.js";
import { IconGridGeometryDiagnostics } from "./iconGridGeometryDiagnostics.js";

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
    static ICON_TEXTURE_OVERSAMPLE = ICON_TEXTURE_OVERSAMPLE;
    static ICON_SIZE = APP_ICON_SIZES;
    static LABEL_OFFSET_Y = LABEL_OFFSET_Y;
    static APP_ICON_TILE_SIZE = APP_ICON_TILE_SIZE;
    static HOVER_Z_POSITION = HOVER_Z_POSITION;
    static TILE_REFERENCE_SCALE = TILE_REFERENCE_SCALE;

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._runningIndicators = new RunningIndicators(settings);
        this._geometryDiagnostics = new IconGridGeometryDiagnostics();
        this._appearanceController = new IconAppearanceController(
            settings,
            appDisplay,
            this._runningIndicators,
            (actor) => this._isActorUsable(actor),
            this._geometryDiagnostics,
        );

        this._folderDragDiagnosticsController = new FolderDragDiagnostics(
            appDisplay,
        );

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

        this._controls = Main.overview?._overview?._controls ?? null;
        this._gridEntranceController = new IconGridEntranceController(
            settings,
            appDisplay,
            this._controls,
            (actor) => this._isActorUsable(actor),
            (key, curveName) => this._getCurveDuration(key, curveName),
        );
        this._viewLoadedId = appDisplay.connect("view-loaded", () => {
            this.updateNamesVisibility();
            this._gridEntranceController.schedulePending();
        });

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
        } catch (_error) {}
    }

    _removeActionSafely(actor, action) {
        if (!action || !this._isActorUsable(actor)) return;

        try {
            const actions = actor.get_actions?.();

            if (!actions || actions.includes(action))
                actor.remove_action(action);
        } catch (_error) {}
    }

    updateNamesVisibility() {
        this._appearanceController.updateNamesVisibility(
            (item, isFolderViewItem) =>
                this._ensureHoverHandler(item, isFolderViewItem),
        );
    }

    applyNameVisibilityMode(item, mode, isFolderViewItem = false) {
        this._appearanceController.applyNameVisibilityMode(
            item,
            mode,
            isFolderViewItem,
            (targetItem, isFolderItem) =>
                this._ensureHoverHandler(targetItem, isFolderItem),
        );
    }

    lockTileSize(item, _baseSize = null) {
        return this._appearanceController.lockTileSize(item);
    }

    applyIconSize(item, _baseSize = null) {
        this._appearanceController.applyIconSize(item);
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

        if (grid) {
            for (let index = 0; index < grid.get_n_children(); index++) {
                const item = grid.get_child_at_index(index);
                if (item) items.add(item);
            }
        }

        for (const folderView of folderViews) {
            if (!this._isActorUsable(folderView)) continue;

            try {
                for (const item of folderView.getAllItems?.() ?? []) {
                    if (!item) continue;

                    items.add(item);
                    folderItems.add(item);
                }
            } catch (_error) {}
        }

        for (const folderView of folderViews) {
            if (!this._isActorUsable(folderView)) continue;

            try {
                folderView._resetDragPageSwitch?.();
            } catch (_error) {}
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

        this._gridEntranceController?.destroy();
        this._gridEntranceController = null;

        for (const item of items) {
            if (!item || !this._isActorUsable(item)) continue;

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
                    } catch (_error) {}

                    item._chFolderLongPressGesture = null;
                }

                item._chFolderViewInteractionHandled = false;
                continue;
            }

            if (item._chContextMenuOpenStateId) {
                this._disconnectSignalSafely(
                    item._chContextMenuActor,
                    item._chContextMenuOpenStateId,
                );
            }

            item._chContextMenuActor = null;
            item._chContextMenuOpenStateId = 0;
            item._chContextMenuOpen = false;

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
            } catch (_error) {}

            if (iconBin && iconBin._chOriginalIconBinYAlign !== undefined) {
                iconBin.y_align = iconBin._chOriginalIconBinYAlign;
                delete iconBin._chOriginalIconBinYAlign;

                if (iconBin._chOriginalIconBinYExpand !== undefined) {
                    iconBin.y_expand = iconBin._chOriginalIconBinYExpand;
                    delete iconBin._chOriginalIconBinYExpand;
                }
                iconBin.queue_relayout();
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

            if (item._chDndGesture) {
                const gesture = item._chDndGesture;
                const gestureActor = item._chDndGestureActor;

                this._removeActionSafely(gestureActor, gesture);

                try {
                    item.add_action(gesture);
                } catch (_error) {}

                item._chDndGesture = null;
                item._chDndGestureActor = null;
            }

            if (item._chDndReactiveLockId) {
                try {
                    item._draggable?.disconnect(item._chDndReactiveLockId);
                } catch (_error) {}

                item._chDndReactiveLockId = 0;
            }

            item.reactive = true;
            item.track_hover = true;

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

        this._geometryDiagnostics.schedule(this._appDisplay, "disabled");
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

        if (animationActor._chGridEntranceOpacityPending) {
            animationActor._chGridEntranceGeneration =
                (animationActor._chGridEntranceGeneration ?? 0) + 1;
            animationActor.remove_transition("opacity");
            animationActor.opacity = 255;
            animationActor._chGridEntranceOpacityPending = false;
        }

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
        this._appearanceController.animateLabelVisibility(
            item,
            visible,
            (key, curveName) => this._getCurveDuration(key, curveName),
        );
    }

    _ensureLabelOverlay(item) {
        this._appearanceController.ensureLabelOverlay(item);
    }

    _installFixedPreferredSize(item) {
        this._appearanceController.installFixedPreferredSize(item);
    }

    _closeAppWindows(item) {
        const app = item?.app;

        if (!app) return;

        const windows = app.get_windows?.() ?? [];

        if (!windows.length) return;

        const timestamp = global.get_current_time();

        for (const window of windows) {
            if (!window) continue;

            if (typeof window.can_close === "function" && !window.can_close())
                continue;

            window.delete(timestamp);
        }
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
            controller._ensureContextMenuHoverHandler(this);
            return result;
        };
    }

    _ensureContextMenuHoverHandler(item) {
        const menu = item?._menu;

        if (!menu || !this._isActorUsable(menu)) return;

        if (item._chContextMenuActor !== menu) {
            this._disconnectSignalSafely(
                item._chContextMenuActor,
                item._chContextMenuOpenStateId,
            );

            item._chContextMenuActor = menu;

            item._chContextMenuOpenStateId = menu.connect(
                "open-state-changed",
                (_menu, isOpen) => {
                    if (!this._isActorUsable(item)) return;

                    item._chContextMenuOpen = isOpen;
                    this._syncIconHoverWithContextMenu(item, isOpen);
                },
            );
        }

        if (menu.isOpen && !item._chContextMenuOpen) {
            item._chContextMenuOpen = true;
            this._syncIconHoverWithContextMenu(item, true);
        }
    }

    _syncIconHoverWithContextMenu(item, menuOpen) {
        if (!this._isActorUsable(item)) return;

        const baseIcon = item.icon;
        const icon = baseIcon?.icon;

        if (!this._isActorUsable(icon)) return;

        let hovered = menuOpen;

        if (!menuOpen) {
            const [stageX, stageY] = global.get_pointer();
            const [valid, x, y] = icon.transform_stage_point(stageX, stageY);

            hovered =
                valid &&
                icon.visible &&
                x >= 0 &&
                y >= 0 &&
                x < icon.width &&
                y < icon.height;
        }

        item._chIconHovered = hovered;

        item.z_position = hovered
            ? IconInteractionController.HOVER_Z_POSITION
            : 0;

        item._updateMultiline?.();

        const label = baseIcon.label;
        const namesMode = this._settings.get_string(
            "app-grid-names-visibility",
        );

        if (namesMode === "hover" && this._isActorUsable(label))
            this._animateLabelVisibility(item, hovered);

        this._animate(item, "hover", hovered);
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

        if (isFolderViewItem) {
            item._chFolderViewInteractionHandled = true;
            this._removeFolderLongPressGesture(item);
            return;
        }

        this._runningIndicators.ensureOverlay(item);

        const isFolder = item.has_style_class_name?.("app-folder") === true;

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
            item.reactive = isFolder;
            item.track_hover = false;
            icon.reactive = true;

            return;
        }

        const oldIcon = item._chHoverIcon;

        if (oldIcon && oldIcon !== icon) {
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

            if (item._chDndGestureActor === oldIcon)
                item._chDndGestureActor = null;
        }

        item._chHoverInteractionInstalled = true;
        item._chHoverIcon = icon;

        item.reactive = isFolder;
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
                if (this._isActorUsable(item)) this._closeAppWindows(item);
            });

            icon.add_action(middleClickGesture);

            item._chMiddleClickGesture = middleClickGesture;
            item._chMiddleClickGestureActor = icon;
        }

        const dragGesture = item?._draggable?.startGesture;

        if (dragGesture && !isFolder) {
            item.remove_action(dragGesture);
            icon.add_action(dragGesture);

            item._chDndGesture = dragGesture;
            item._chDndGestureActor = icon;
        }

        if (item._draggable && !item._chDndReactiveLockId) {
            const draggable = item._draggable;

            item._chDndReactiveLockId = draggable.connect("drag-end", () => {
                if (item._draggable !== draggable || !this._isActorUsable(item))
                    return;

                try {
                    item.reactive = isFolder;
                    item.track_hover = false;
                } catch (_error) {}
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

            item.z_position = IconInteractionController.HOVER_Z_POSITION;
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

            if (item._chContextMenuOpen) return Clutter.EVENT_PROPAGATE;

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
            if (this._isActorUsable(item) && item._chIconHovered)
                this._animate(item, "press");
        });
    }
}
