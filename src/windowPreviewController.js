import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import { WindowPreview } from "resource:///org/gnome/shell/ui/windowPreview.js";

const TOOLTIP_ICON_GAP = 10;

export class WindowPreviewController {
    constructor(settings, diagnostics = null) {
        this._settings = settings;
        this._diagnostics = diagnostics;
        this._injectionManager = new InjectionManager();
        this._previews = new Set();
        this._settingsChangedId = 0;
        this._tooltipPositionChangedId = 0;
    }

    enable() {
        const previewPrototype = WindowPreview.prototype;

        this._injectionManager.overrideMethod(
            previewPrototype,
            "_init",
            (originalMethod) => {
                const controller = this;

                return function (...args) {
                    originalMethod.call(this, ...args);

                    controller._previews.add(this);
                    controller._updatePreview(this);
                };
            },
        );

        this._injectionManager.overrideMethod(
            previewPrototype,
            "_windowCanClose",
            (originalMethod) => {
                const controller = this;

                return function () {
                    return (
                        controller._settings.get_boolean(
                            "show-window-close-button",
                        ) && originalMethod.call(this)
                    );
                };
            },
        );

        /*
         * Keep GNOME's original showOverlay() completely intact.
         *
         * In "hidden" mode, temporarily suppress only title.show().
         * GNOME can therefore continue handling the rest of the overlay
         * normally: close button, animations, scaling, etc.
         */
        this._injectionManager.overrideMethod(
            previewPrototype,
            "showOverlay",
            (originalMethod) => {
                const controller = this;

                return function (animate) {
                    const position = controller._settings.get_string(
                        "workspace-tooltip-position",
                    );

                    if (position !== "hidden") {
                        originalMethod.call(this, animate);
                        return;
                    }

                    const title = this._title;

                    if (!title) {
                        originalMethod.call(this, animate);
                        return;
                    }

                    const originalShow = title.show;

                    /*
                     * Make GNOME's title.show() a no-op only while the
                     * original showOverlay() is executing.
                     */
                    title.show = function () {};

                    /*
                     * Make sure the title is already invisible in case
                     * hidden mode was selected while the overlay was shown.
                     */
                    title.remove_all_transitions();
                    title.hide();
                    title.opacity = 0;

                    try {
                        originalMethod.call(this, animate);
                    } finally {
                        title.show = originalShow;

                        /*
                         * GNOME's original showOverlay() may have changed
                         * opacity through ease(), so force the hidden state
                         * once more after it has finished.
                         */
                        title.remove_all_transitions();
                        title.hide();
                        title.opacity = 0;
                    }
                };
            },
        );

        /*
         * GNOME calculates the native icon/title position here.
         * Keep that calculation intact and apply our tooltip position
         * afterwards.
         */
        this._injectionManager.overrideMethod(
            previewPrototype,
            "_adjustOverlayOffsets",
            (originalMethod) => {
                const controller = this;

                return function (...args) {
                    if (!controller._isActorUsable(this)) return;

                    const container = this.window_container;
                    const icon = this._icon;
                    const title = this._title;
                    const closeButton = this._closeButton;

                    const requiredActors = [
                        container,
                        icon,
                        title,
                        closeButton,
                    ];

                    if (
                        !requiredActors.every((actor) =>
                            controller._isActorUsable(actor),
                        )
                    )
                        return;

                    const parent = this.get_parent?.();

                    if (!controller._isActorUsable(parent)) return;

                    const allocation = container.allocation;
                    const [width, height] = allocation?.get_size?.() ?? [
                        NaN,
                        NaN,
                    ];

                    const scaleX = container.scale_x;

                    const allocationValid =
                        allocation &&
                        [
                            allocation.x1,
                            allocation.y1,
                            allocation.x2,
                            allocation.y2,
                            width,
                            height,
                            scaleX,
                        ].every(Number.isFinite) &&
                        width > 0 &&
                        height > 0;

                    if (!allocationValid) {
                        controller._diagnostics?.event(
                            "window-preview",
                            "Skipped overlay offsets for unallocated preview",
                            {
                                title: this.metaWindow?.get_title?.() ?? null,
                                width: String(width),
                                height: String(height),
                                scaleX: String(scaleX),
                                hasParent: true,
                            },
                            "verbose",
                        );
                        return;
                    }

                    try {
                        originalMethod.call(this, ...args);
                    } catch (error) {
                        // GNOME may dispose the preview while its overlay is updating.
                        if (
                            !controller._isActorUsable(this) ||
                            !controller._isActorUsable(container)
                        )
                            return;

                        throw error;
                    }

                    if (controller._isActorUsable(this))
                        controller._updateTooltipPosition(this);
                };
            },
        );

        this._settingsChangedId = this._settings.connect(
            "changed::show-window-close-button",
            () => this._updatePreviews(),
        );

        this._tooltipPositionChangedId = this._settings.connect(
            "changed::workspace-tooltip-position",
            () => this._updateTooltipPositions(),
        );

        this._updatePreviews();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._tooltipPositionChangedId) {
            this._settings.disconnect(this._tooltipPositionChangedId);
            this._tooltipPositionChangedId = 0;
        }

        /*
         * Restore GNOME's methods before touching preview actors. During DND
         * or workspace teardown, a preview can still be in the Set while one
         * of its child actors has already been destroyed. The injected
         * _adjustOverlayOffsets() also applies our custom position, so it must
         * not be used to restore the native state.
         */
        try {
            this._injectionManager.clear();
        } catch (error) {
            this._diagnostics?.error(
                "window-preview",
                "Could not restore GNOME preview methods",
                error,
            );
        }

        for (const preview of this._previews) {
            try {
                if (!this._isActorUsable(preview)) {
                    this._diagnostics?.event(
                        "window-preview",
                        "Skip destroyed preview during cleanup",
                        {},
                        "verbose",
                    );
                    continue;
                }

                if (!preview.get_parent?.()) {
                    this._diagnostics?.event(
                        "window-preview",
                        "Skip detached preview during cleanup",
                        {},
                        "verbose",
                    );
                    continue;
                }

                const previewActors = [
                    preview.window_container,
                    preview._icon,
                    preview._title,
                    preview._closeButton,
                ];
                if (
                    previewActors.some(
                        (actor) =>
                            !this._isActorUsable(actor) ||
                            actor.get_parent?.() !== preview,
                    )
                ) {
                    this._diagnostics?.event(
                        "window-preview",
                        "Skip preview with destroyed child actors during cleanup",
                        {},
                        "verbose",
                    );
                    continue;
                }

                const title = preview._title;
                if (this._isActorUsable(title)) {
                    title.remove_all_transitions();
                    title.show();
                    title.opacity = 255;
                }

                // The injection was cleared above; this calls GNOME's native
                // method to restore its original overlay position.
                preview._adjustOverlayOffsets?.();

                const closeButton = preview._closeButton;
                if (this._isActorUsable(closeButton))
                    closeButton.visible =
                        preview._overlayShown && preview._windowCanClose();
            } catch (error) {
                this._diagnostics?.error(
                    "window-preview",
                    "Could not restore preview actor",
                    error,
                );
            }
        }

        this._previews.clear();
    }

    _isActorUsable(actor) {
        if (!actor) return false;

        try {
            return !actor._destroyed && !actor.is_destroyed?.();
        } catch (_error) {
            return false;
        }
    }

    _updatePreviews() {
        this._previews.clear();

        if (!this._isActorUsable(global.stage)) return;

        this._collectPreviews(global.stage);

        for (const preview of [...this._previews]) this._updatePreview(preview);
    }

    _updatePreview(preview) {
        if (!this._isActorUsable(preview)) {
            this._previews.delete(preview);
            return;
        }

        try {
            const closeButton = preview._closeButton;

            if (this._isActorUsable(closeButton)) {
                const shouldShow =
                    this._settings.get_boolean("show-window-close-button") &&
                    preview._overlayShown &&
                    preview._windowCanClose();

                // Check again immediately before mutating the actor.
                if (
                    !this._isActorUsable(preview) ||
                    !this._isActorUsable(closeButton) ||
                    closeButton.get_parent?.() !== preview
                ) {
                    this._previews.delete(preview);
                    return;
                }

                closeButton.visible = shouldShow;

                if (shouldShow && this._isActorUsable(closeButton))
                    closeButton.opacity = 255;
            }

            if (this._isActorUsable(preview)) preview._adjustOverlayOffsets?.();
        } catch (error) {
            if (!this._isActorUsable(preview)) {
                this._previews.delete(preview);
                return;
            }

            this._diagnostics?.error(
                "window-preview",
                "Could not update preview actor",
                error,
            );
        }
    }

    _updateTooltipPositions() {
        this._previews.clear();

        this._collectPreviews(global.stage);

        for (const preview of [...this._previews]) {
            if (!this._isActorUsable(preview)) {
                this._previews.delete(preview);
                continue;
            }

            try {
                preview._adjustOverlayOffsets?.();
            } catch (error) {
                if (!this._isActorUsable(preview)) {
                    this._previews.delete(preview);
                    continue;
                }

                this._diagnostics?.error(
                    "window-preview",
                    "Could not update preview tooltip position",
                    error,
                );
            }
        }
    }

    _updateTooltipPosition(preview) {
        if (!this._isActorUsable(preview)) return;
        const title = preview._title;
        const icon = preview._icon;

        if (!this._isActorUsable(title) || !this._isActorUsable(icon)) return;

        const position = this._settings.get_string(
            "workspace-tooltip-position",
        );

        const parent = title.get_parent();

        if (!this._isActorUsable(parent)) return;

        /*
         * Hidden:
         * showOverlay() itself prevents GNOME from calling title.show().
         * Keep the title hidden here as well for immediate settings changes.
         */
        if (position === "hidden") {
            title.remove_all_transitions();
            title.hide();
            title.opacity = 0;
            return;
        }

        /*
         * Native GNOME position:
         * 12 px below the icon.
         */
        if (position === "below") {
            parent.set_child_below_sibling(title, icon);
            return;
        }

        /*
         * Above:
         * exactly 12 px above the icon.
         */
        const iconTop = icon.allocation.y1 + icon.translation_y;

        const titleHeight = title.allocation.get_height();

        const titleTop = title.allocation.y1 + title.translation_y;

        const targetTitleTop = iconTop - titleHeight - TOOLTIP_ICON_GAP;

        const deltaY = targetTitleTop - titleTop;

        title.translation_y += deltaY;

        parent.set_child_above_sibling(title, icon);
    }

    _collectPreviews(actor) {
        if (!this._isActorUsable(actor)) return;

        if (actor instanceof WindowPreview) this._previews.add(actor);

        let children;

        try {
            children = actor.get_children?.() ?? [];
        } catch (_error) {
            return;
        }

        for (const child of children) this._collectPreviews(child);
    }
}
