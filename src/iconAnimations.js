import Clutter from "gi://Clutter";

export const ICON_ANIMATION_CURVES = {
    Back: Clutter.AnimationMode.EASE_OUT_BACK,
    Bounce: Clutter.AnimationMode.EASE_OUT_BOUNCE,
    Circ: Clutter.AnimationMode.EASE_OUT_CIRC,
    Cubic: Clutter.AnimationMode.EASE_OUT_CUBIC,
    Elastic: Clutter.AnimationMode.EASE_OUT_ELASTIC,
    Expo: Clutter.AnimationMode.EASE_OUT_EXPO,
    Linear: Clutter.AnimationMode.LINEAR,
    Quad: Clutter.AnimationMode.EASE_OUT_QUAD,
    Quart: Clutter.AnimationMode.EASE_OUT_QUART,
    Quint: Clutter.AnimationMode.EASE_OUT_QUINT,
    Sine: Clutter.AnimationMode.EASE_OUT_SINE,
};

const FALLBACK_CURVE = "Quad";

export class IconAnimator {
    /**
     * @param {Clutter.Actor} actor
     * @param {Object} opts
     * @param {boolean} opts.active
     * @param {number} opts.targetScale
     * @param {string} opts.curveName
     * @param {number} opts.inDuration
     * @param {number} opts.outDuration
     * @param {number|null} opts.startScale
     */
    static scale(
        actor,
        {
            active,
            targetScale,
            curveName,
            inDuration,
            outDuration,
            startScale = null,
        },
    ) {
        if (!actor || actor.is_destroyed?.()) return;

        actor.remove_all_transitions();
        actor.set_pivot_point(0.5, 0.5);

        const mode =
            ICON_ANIMATION_CURVES[curveName] ??
            ICON_ANIMATION_CURVES[FALLBACK_CURVE];
        const duration = active ? inDuration : outDuration;

        const animationScale = active ? targetScale : 1.0;

        const baseScale =
            Number.isFinite(actor._chIconSizeScale) &&
            actor._chIconSizeScale > 0
                ? actor._chIconSizeScale
                : 1.0;

        const scale = baseScale * animationScale;

        if (active && Number.isFinite(startScale) && startScale > 0) {
            const initialScale = baseScale * startScale;
            actor.set_scale(initialScale, initialScale);
        }

        actor.ease({
            scale_x: scale,
            scale_y: scale,
            mode,
            duration,
        });
    }

    static reset(actor) {
        if (!actor || actor.is_destroyed?.()) return;
        actor.remove_all_transitions();
        actor.set_scale(1.0, 1.0);
        actor.opacity = 255;
    }
}
