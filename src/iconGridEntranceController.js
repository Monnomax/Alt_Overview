import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { ControlsState } from "resource:///org/gnome/shell/ui/overviewControls.js";
import { IconAnimator } from "./iconAnimations.js";

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
        const shouldAnimate =
            state?.finalState === ControlsState.APP_GRID &&
            this._settings.get_string("app-grid-animation-direction") ===
                "grow-in-place";

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
    }
}
