import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

export default class CloseOverviewController {
    constructor(settings) {
        this._settings = settings;
        this._handlerId = null;
    }

    enable() {
        this._handlerId = global.stage.connect(
            "captured-event",
            (_actor, event) => {
                if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                    return Clutter.EVENT_PROPAGATE;

                return this._handleButtonPress(event);
            },
        );
    }

    disable() {
        if (this._handlerId !== null) {
            global.stage.disconnect(this._handlerId);
            this._handlerId = null;
        }

        this._settings = null;
    }

    _handleButtonPress(event) {
        if (!Main.overview.visible) return Clutter.EVENT_PROPAGATE;

        const button = event.get_button();

        /*
         * Обробляємо порожню частину AppIcon на capture-фазі,
         * до того, як подія потрапить до внутрішніх обробників.
         */
        if (button === 1 || button === 2 || button === 3) {
            const [x, y] = event.get_coords();

            if (this._isAppIconTileBackground(x, y)) {
                const setting =
                    button === 1
                        ? "close-on-left-click"
                        : button === 3
                          ? "close-on-right-click"
                          : "close-on-middle-click";

                if (this._settings.get_boolean(setting))
                    Main.overview.hide();

                // Never propagate clicks from an empty AppIcon tile.
                return Clutter.EVENT_STOP;
            }
        }

        // A middle click closes a window preview or an Overview background.
        if (button === 2) {
            if (!this._settings.get_boolean("close-on-middle-click"))
                return Clutter.EVENT_PROPAGATE;

            return this._handleMiddleClick(event);
        }

        // Only left and right clicks can close Overview.
        if (button !== 1 && button !== 3) return Clutter.EVENT_PROPAGATE;

        const setting =
            button === 1 ? "close-on-left-click" : "close-on-right-click";

        if (!this._settings.get_boolean(setting))
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE,
            x,
            y,
        );

        if (!target || this._isBackgroundTarget(target)) {
            Main.overview.hide();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _isAppIconTileBackground(stageX, stageY) {
        const appDisplay =
            Main.overview?._overview?._controls?._appDisplay;
        const grid = appDisplay?._grid;

        if (!grid) return false;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);

            if (!item?.app || !item.visible || !item.icon?.icon)
                continue;

            const icon = item.icon.icon;

            try {
                const [tileValid, tileX, tileY] =
                    item.transform_stage_point(stageX, stageY);

                if (
                    !tileValid ||
                    tileX < 0 ||
                    tileY < 0 ||
                    tileX >= item.width ||
                    tileY >= item.height
                )
                    continue;

                if (icon.visible) {
                    const [iconValid, iconX, iconY] =
                        icon.transform_stage_point(stageX, stageY);

                    if (
                        iconValid &&
                        iconX >= 0 &&
                        iconY >= 0 &&
                        iconX < icon.width &&
                        iconY < icon.height
                    )
                        return false;
                }

                return true;
            } catch (_error) {
                // Актор міг бути перебудований під час оновлення AppGrid.
            }
        }

        return false;
    }

    _isBackgroundTarget(target) {
        // Empty Overview background.
        if (
            typeof target.get_name === "function" &&
            target.get_name() === "overviewGroup"
        ) {
            return true;
        }

        // This must be the actual reactive target, not just an ancestor,
        // so clicks on AppGrid icons and folders continue to work normally.
        if (
            typeof target.get_style_class_name === "function" &&
            target.get_style_class_name() === "apps-scroll-view"
        ) {
            return true;
        }

        // WindowPicker may return an actor inside a workspace. Stop at a
        // WindowPreview so clicking a real window does not close Overview.
        let current = target;

        while (current) {
            if (current.constructor?.name === "WindowPreview") return false;

            if (
                typeof current.get_style_class_name === "function" &&
                current.get_style_class_name() === "window-picker"
            ) {
                return true;
            }

            current = current.get_parent?.() ?? null;
        }

        return false;
    }

    _handleMiddleClick(event) {
        const [x, y] = event.get_coords();
        const target = global.stage.get_actor_at_pos(
            Clutter.PickMode.REACTIVE,
            x,
            y,
        );
        const windowPreview = this._getWindowPreview(target);

        // Middle click on a WindowPreview closes that window.
        if (windowPreview?.metaWindow) {
            windowPreview.metaWindow.delete(global.get_current_time());
            return Clutter.EVENT_STOP;
        }

        // Middle click on empty Overview, AppGrid, or workspace background
        // closes Overview.
        if (!target || this._isBackgroundTarget(target)) {
            Main.overview.hide();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _getWindowPreview(target) {
        let current = target;

        while (current) {
            if (current.constructor?.name === "WindowPreview") return current;
            current = current.get_parent?.() ?? null;
        }

        return null;
    }
}
