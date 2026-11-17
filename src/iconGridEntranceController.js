import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { ControlsState } from "resource:///org/gnome/shell/ui/overviewControls.js";
import { IconAnimator } from "./iconAnimations.js";

function _altIconEntranceSnapshot(actor) {
    if (!actor) return null;

    const read = (fn) => {
        try {
            return fn();
        } catch (_error) {
            return null;
        }
    };

    return {
        type: read(() => actor.constructor?.name),
        parent: read(() => actor.get_parent()?.constructor?.name),
        opacity: read(() => actor.opacity),
        scaleX: read(() => actor.scale_x),
        scaleY: read(() => actor.scale_y),
        visible: read(() => actor.visible),
        mapped: read(() => actor.mapped),
        destroyed: read(() => actor.is_destroyed?.() ?? false),
        opacityTransition: read(() =>
            Boolean(actor.get_transition?.("opacity"))
        ),
        scaleXTransition: read(() =>
            Boolean(actor.get_transition?.("scale-x"))
        ),
        scaleYTransition: read(() =>
            Boolean(actor.get_transition?.("scale-y"))
        ),
    };
}

// Matches GNOME Shell Overview.ANIMATION_TIME.
const APP_GRID_EXIT_ANIMATION_DURATION = 250;

export class IconGridEntranceController {
    constructor(
        settings,
        appDisplay,
        controls,
        isActorUsable,
        getCurveDuration,
    ) {
        this._settings = settings;
        this._appDisplay = appDisplay;
        this._controls = controls;
        this._stateAdjustment = controls?._stateAdjustment ?? null;
        this._isActorUsable = isActorUsable;
        this._getCurveDuration = getCurveDuration;
        this._pending = false;
        this._shown = false;
        this._exiting = false;
        this._laterId = 0;

        this._stateChangedId =
            this._stateAdjustment?.connect("notify::value", () =>
                this._onOverviewStateChanged(),
            ) ?? 0;
        this._directionChangedId = settings.connect(
            "changed::app-grid-animation-direction",
            () => this._onOverviewStateChanged(),
        );
        this._displayVisibleId = appDisplay.connect("notify::visible", () =>
            this._onAppDisplayVisibilityChanged(),
        );

        this._onOverviewStateChanged();
        if (appDisplay.visible) this._onAppDisplayVisibilityChanged();
    }

    destroy() {
        if (this._stateChangedId && this._stateAdjustment) {
            this._stateAdjustment.disconnect(this._stateChangedId);
            this._stateChangedId = 0;
        }

        if (this._directionChangedId) {
            this._settings.disconnect(this._directionChangedId);
            this._directionChangedId = 0;
        }

        if (this._displayVisibleId) {
            this._appDisplay.disconnect(this._displayVisibleId);
            this._displayVisibleId = 0;
        }

        this._pending = false;
        this._shown = false;
        this._cancelPending();
    }

    schedulePending() {
        if (
            !this._pending ||
            this._laterId ||
            !this._appDisplay?.visible ||
            this._controls?._searchController?.searchActive
        )
            return;

        const laters = global.compositor?.get_laters?.();
        if (!laters) {
            this._animatePending();
            return;
        }

        this._laterId = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._animatePending();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelPending() {
        if (!this._laterId) return;

        try {
            global.compositor?.get_laters?.()?.remove(this._laterId);
        } catch (_error) {}

        this._laterId = 0;
    }

    _onOverviewStateChanged() {
        const state = this._stateAdjustment?.getStateTransitionParams?.();
        const growInPlace =
            this._settings.get_string("app-grid-animation-direction") ===
            "grow-in-place";

        const shouldAnimateExit =
            growInPlace &&
            this._shown &&
            !this._exiting &&
            state?.initialState === ControlsState.APP_GRID &&
            state?.finalState === ControlsState.HIDDEN;

        if (shouldAnimateExit) {
            this._pending = false;
            this._shown = false;
            this._exiting = true;
            this._cancelPending();
            this._animateExit();
            return;
        }

        if (state?.finalState === ControlsState.APP_GRID) {
            this._exiting = false;
            if (!this._shown) this._restoreExitActors();
        } else if (
            state?.finalState !== ControlsState.HIDDEN ||
            !state?.transitioning
        ) {
            this._exiting = false;
        }

        const shouldAnimate =
            state?.finalState === ControlsState.APP_GRID && growInPlace;

        if (!shouldAnimate) {
            this._pending = false;
            this._shown = false;
            this._cancelPending();
            return;
        }

        if (this._shown) return;

        this._pending = true;
        if (
            this._appDisplay?.visible &&
            !this._controls?._searchController?.searchActive
        )
            this.schedulePending();
    }

    _onAppDisplayVisibilityChanged() {
        if (!this._appDisplay?.visible) {
            this._cancelPending();
            return;
        }

        this._onOverviewStateChanged();
    }

    _animateExit() {
        const appDisplay = this._appDisplay;
        if (
            !appDisplay?.visible ||
            this._controls?._searchController?.searchActive
        )
            return;

        const grid = appDisplay._grid;
        if (!grid) return;

        const currentPage = Number.isInteger(grid.currentPage)
            ? grid.currentPage
            : 0;
        const pageItems = grid.getItemsAtPage?.(currentPage);
        const items =
            Array.isArray(pageItems) && pageItems.length > 0
                ? pageItems
                : Array.from({ length: grid.get_n_children() }, (_, index) =>
                      grid.get_child_at_index(index),
                  );

        for (const item of items) {
            if (!this._isActorUsable(item) || item.visible === false) continue;

            const baseIcon = item.icon;
            const icon = baseIcon?.icon;
            if (!this._isActorUsable(icon)) continue;

            const overlay = item._chRunningOverlay;
            const animationActor =
                overlay && this._isActorUsable(overlay) ? overlay : icon;

            const generation =
                (animationActor._chGridEntranceGeneration ?? 0) + 1;
            animationActor._chGridEntranceGeneration = generation;
            animationActor._chGridEntranceOpacityPending = false;
            animationActor._chGridExitPending = true;

            IconAnimator.scale(animationActor, {
                active: true,
                targetScale: 0.5,
                curveName: "Quad",
                inDuration: APP_GRID_EXIT_ANIMATION_DURATION,
                outDuration: APP_GRID_EXIT_ANIMATION_DURATION,
                startScale: 1.0,
            });

            animationActor.ease({
                opacity: 0,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                duration: APP_GRID_EXIT_ANIMATION_DURATION,
            });
        }
    }

    _restoreExitActors() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;

        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);
            if (!this._isActorUsable(item)) continue;

            const icon = item.icon?.icon;
            if (!this._isActorUsable(icon)) continue;

            const overlay = item._chRunningOverlay;
            const animationActor =
                overlay && this._isActorUsable(overlay) ? overlay : icon;

            if (!animationActor._chGridExitPending) continue;

            animationActor._chGridEntranceGeneration =
                (animationActor._chGridEntranceGeneration ?? 0) + 1;
            animationActor._chGridEntranceOpacityPending = false;
            animationActor._chGridExitPending = false;
            IconAnimator.reset(animationActor);
        }
    }

    _animatePending() {
        if (!this._pending) return;

        const appDisplay = this._appDisplay;
        const state = this._stateAdjustment?.getStateTransitionParams?.();
        if (
            state?.finalState !== ControlsState.APP_GRID ||
            this._settings.get_string("app-grid-animation-direction") !==
                "grow-in-place"
        ) {
            this._pending = false;
            this._shown = false;
            this._cancelPending();
            return;
        }

        if (
            !appDisplay?.visible ||
            this._controls?._searchController?.searchActive
        )
            return;

        const grid = appDisplay._grid;
        if (!grid) return;

        const currentPage = Number.isInteger(grid.currentPage)
            ? grid.currentPage
            : 0;
        const pageItems = grid.getItemsAtPage?.(currentPage);
        const items =
            Array.isArray(pageItems) && pageItems.length > 0
                ? pageItems
                : Array.from({ length: grid.get_n_children() }, (_, index) =>
                      grid.get_child_at_index(index),
                  );

        if (items.length === 0) return;

        const curveName = this._settings.get_string(
            "app-grid-icon-hover-curve",
        );
        const duration = this._getCurveDuration(
            "app-grid-icon-hover-in-durations",
            curveName,
        );

        let animated = false;
        const diagnosticEntries = [];

        for (const item of items) {
            if (!this._isActorUsable(item) || item.visible === false) continue;

            const baseIcon = item.icon;
            const icon = baseIcon?.icon;
            if (!this._isActorUsable(icon)) continue;

            const overlay = item._chRunningOverlay;
            const animationActor =
                overlay && this._isActorUsable(overlay) ? overlay : icon;

            let appName = "Unknown";
            try {
                appName = item.app?.get_name?.() ?? "Unknown";
            } catch (_error) {}

            diagnosticEntries.push({
                app: appName,
                item,
                icon,
                overlay:
                    overlay && this._isActorUsable(overlay)
                        ? overlay
                        : null,
                animationActor,
                start: {
                    icon: _altIconEntranceSnapshot(icon),
                    overlay: _altIconEntranceSnapshot(overlay),
                    animationActor:
                        _altIconEntranceSnapshot(animationActor),
                },
            });

            animationActor._chGridExitPending = false;
            const generation =
                (animationActor._chGridEntranceGeneration ?? 0) + 1;
            animationActor._chGridEntranceGeneration = generation;
            animationActor._chGridEntranceOpacityPending = true;
            animationActor.opacity = 0;

            IconAnimator.scale(animationActor, {
                active: true,
                targetScale: 1.0,
                curveName,
                inDuration: duration,
                outDuration: duration,
                startScale: 0.5,
            });

            animationActor.ease({
                opacity: 255,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                duration,
                onComplete: () => {
                    if (
                        !this._isActorUsable(animationActor) ||
                        animationActor._chGridEntranceGeneration !== generation
                    )
                        return;

                    animationActor._chGridEntranceOpacityPending = false;
                    animationActor.opacity = 255;
                },
            });

            animated = true;
        }

        if (animated) {
            this._pending = false;
            this._shown = true;
        }

        if (diagnosticEntries.length > 0) {
            GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                Math.max(1000, duration + 700),
                () => {
                    if (!this._shown || this._exiting)
                        return GLib.SOURCE_REMOVE;

                    const records = diagnosticEntries.map((entry) => {
                        const read = (fn) => {
                            try {
                                return fn();
                            } catch (_error) {
                                return null;
                            }
                        };

                        const currentIcon = read(
                            () => entry.item?.icon?.icon
                        );

                        const overlayCandidate = read(
                            () => entry.item?._chRunningOverlay
                        );

                        const currentOverlay =
                            overlayCandidate &&
                            this._isActorUsable(overlayCandidate)
                                ? overlayCandidate
                                : null;

                        const currentActor = currentOverlay ?? currentIcon;

                        const animationState =
                            _altIconEntranceSnapshot(entry.animationActor);
                        const iconState =
                            _altIconEntranceSnapshot(currentIcon);
                        const overlayState =
                            _altIconEntranceSnapshot(currentOverlay);

                        const changes = [];
                        const issues = [];

                        if (entry.icon !== currentIcon)
                            changes.push("icon-reference-changed");

                        if (entry.overlay !== currentOverlay)
                            changes.push("overlay-reference-changed");

                        if (entry.animationActor !== currentActor)
                            changes.push("animation-actor-changed");

                        if (!this._isActorUsable(entry.animationActor))
                            issues.push("animation-actor-unusable");

                        const lowOpacity = (state) =>
                            Number.isFinite(state?.opacity) &&
                            state.opacity < 250;

                        const reducedScale = (state) =>
                            [state?.scaleX, state?.scaleY].some(
                                (value) =>
                                    Number.isFinite(value) && value < 0.95
                            );

                        if (lowOpacity(animationState))
                            issues.push("animation-actor-opacity-low");

                        if (lowOpacity(iconState))
                            issues.push("icon-opacity-low");

                        if (lowOpacity(overlayState))
                            issues.push("overlay-opacity-low");

                        if (reducedScale(animationState))
                            issues.push("animation-actor-scale-low");

                        if (reducedScale(iconState))
                            issues.push("icon-scale-low");

                        const overlayIcon = read(
                            () => entry.item?._chRunningOverlayIcon
                        );

                        if (
                            currentOverlay &&
                            overlayIcon !== currentIcon
                        )
                            issues.push("overlay-icon-mismatch");

                        if (
                            currentOverlay &&
                            read(() => currentIcon?.get_parent()) !==
                                currentOverlay
                        )
                            issues.push("icon-not-child-of-overlay");

                        return {
                            app: entry.app,
                            issues,
                            changes,
                            start: entry.start,
                            after: {
                                animationActor: animationState,
                                icon: iconState,
                                overlay: overlayState,
                            },
                        };
                    });

                    const affected = records.filter(
                        (record) =>
                            record.issues.length > 0 ||
                            record.changes.length > 0
                    );

                    console.log(
                        `[ALT_ICON_ENTRANCE_DIAG] ${JSON.stringify({
                            checked: records.length,
                            affected: affected.length,
                            records: affected.length
                                ? affected.slice(0, 20)
                                : records.slice(0, 5),
                        })}`
                    );

                    return GLib.SOURCE_REMOVE;
                }
            );
        }
    }
}
