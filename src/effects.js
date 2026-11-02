import Clutter from "gi://Clutter";
import Cogl from "gi://Cogl";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Shell from "gi://Shell";

const EFFECT_NAMES = {
    brightness: "overview-bg-brightness",
    saturation: "overview-bg-saturation",
    blur: "overview-bg-blur",
    grain: "overview-bg-grain",
};

/** Remove AltOverview's named effects from an actor, if it is still alive. */
export function removeBackgroundEffects(actor) {
    if (!actor || actor._destroyed || actor.is_destroyed?.()) return;

    for (const name of Object.values(EFFECT_NAMES))
        actor.remove_effect_by_name(name);

    actor.queue_redraw();
}

export const BrightnessEffect = GObject.registerClass(
    class BrightnessEffect extends Clutter.BrightnessContrastEffect {
        _init() {
            super._init();
            this._brightness = 0;
            this.set_brightness(this._brightness);
        }

        setBrightness(percent) {
            const value = Math.min(1, Math.max(-1, percent / 100));
            if (this._brightness === value) return;

            this._brightness = value;
            this.set_brightness(value);
            this.queue_repaint();
        }
    },
);

export const SaturationEffect = GObject.registerClass(
    class SaturationEffect extends Shell.GLSLEffect {
        _init(params) {
            super._init(params);
            this._saturation = 1.0;
            this._saturationLocation = this.get_uniform_location("saturation");
            this.set_uniform_float(this._saturationLocation, 1, [
                this._saturation,
            ]);
        }

        vfunc_build_pipeline() {
            const declarations = `
                uniform float saturation;
            `;
            const code = `
                float _luma = dot(cogl_color_out.rgb, vec3(0.299, 0.587, 0.114));
                cogl_color_out.rgb = clamp(
                    mix(vec3(_luma), cogl_color_out.rgb, saturation),
                    0.0, 1.0
                );
            `;
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
                false,
            );
        }

        setSaturation(value) {
            if (this._saturation === value) return;
            this._saturation = value;
            this.set_uniform_float(this._saturationLocation, 1, [value]);
            this.queue_repaint();
        }
    },
);

export const BlurEffect = GObject.registerClass(
    class BlurEffect extends Shell.BlurEffect {
        _init() {
            super._init({
                mode: Shell.BlurMode.ACTOR,
                brightness: 1.0,
            });
            this._radius = 0;
            this.radius = this._radius;
        }

        setBlur(radius) {
            if (this._radius === radius) return;
            this._radius = radius;
            this.radius = radius;
            this.queue_repaint();
        }
    },
);

export const GrainEffect = GObject.registerClass(
    class GrainEffect extends Shell.GLSLEffect {
        _init(params) {
            super._init(params);
            this._amount = 0.0;
            this._amountLocation = this.get_uniform_location("grain_amount");
            this._actor = null;
            this.set_uniform_float(this._amountLocation, 1, [this._amount]);
        }

        vfunc_build_pipeline() {
            const declarations = `
                uniform float grain_amount;

                float _grain_rand(vec2 co)
{
    co = fract(co * vec2(0.1031, 0.1030));
    co += dot(co, co.yx + 33.33);
    return fract((co.x + co.y) * co.x);
}
            `;
            const code = `
    vec2 _grainPixel = gl_FragCoord.xy;

    float _grainNoise =
        _grain_rand(_grainPixel) - 0.5;

    cogl_color_out.rgb = clamp(
        cogl_color_out.rgb +
        _grainNoise * grain_amount,
        0.0,
        1.0
    );
`;
            this.add_glsl_snippet(
                Cogl.SnippetHook.FRAGMENT,
                declarations,
                code,
                false,
            );
        }

        setAmount(percent) {
            // A small amplitude makes the default value effectively invisible.
            // Keep the 0–100 slider range perceptible across the full range.
            const value = (percent / 100) * 0.2;
            if (this._amount === value) return;
            this._amount = value;
            this.set_uniform_float(this._amountLocation, 1, [value]);
            this.queue_repaint();
            this._actor?.queue_redraw();
        }

        setActor(actor) {
            this._actor = actor;
        }
    },
);

export class BackgroundEffects {
    constructor() {
        this._actor = null;
        this._grainActor = null;
        this._brightness = 0;
        this._saturation = 1.0;
        this._blur = 0;
        this._grain = 0;
    }

    setActors(actor, grainActor) {
        if (!actor) {
            this._detachGrainActor();
            this._actor = null;
            this._grainActor = null;
            return;
        }

        if (this._actor === actor && this._grainActor === grainActor) {
            this._queueRepaint(actor, ...(grainActor ? [grainActor] : []));
            return;
        }

        this._detachGrainActor();
        this._actor = actor;
        this._grainActor = grainActor;

        const brightnessEffect = this._getOrAttach(
            actor,
            EFFECT_NAMES.brightness,
            () => new BrightnessEffect(),
        );
        brightnessEffect?.setBrightness(this._brightness);

        const saturationEffect = this._getOrAttach(
            actor,
            EFFECT_NAMES.saturation,
            () => new SaturationEffect(),
        );
        saturationEffect?.setSaturation(this._saturation);

        const blurEffect = this._getOrAttach(
            actor,
            EFFECT_NAMES.blur,
            () => new BlurEffect(),
        );
        blurEffect?.setBlur(this._blur);

        // Grain can be attached to a parent/container separately from the
        // wallpaper actor. This lets grain render after the actor's blur.
        if (grainActor) {
            const grainEffect = this._getOrAttach(
                grainActor,
                EFFECT_NAMES.grain,
                () => new GrainEffect(),
            );
            grainEffect?.setActor(grainActor);
            grainEffect?.setAmount(this._grain);
        }

        this._queueRepaint(actor, ...(grainActor ? [grainActor] : []));
    }

    setBrightness(percent) {
        this._brightness = percent;
        this._getActorEffect(EFFECT_NAMES.brightness)?.setBrightness(percent);
        this._queueActorRedraw();
    }

    setSaturation(value) {
        this._saturation = value;
        this._getActorEffect(EFFECT_NAMES.saturation)?.setSaturation(value);
        this._queueActorRedraw();
    }

    setBlur(radius) {
        this._blur = radius;
        this._getActorEffect(EFFECT_NAMES.blur)?.setBlur(radius);
        this._queueActorRedraw();
    }

    setGrain(percent) {
        this._grain = percent;
        this._getGrainActorEffect()?.setAmount(percent);
    }

    _getOrAttach(actor, name, createEffect) {
        let effect = actor.get_effect(name);
        if (!effect) {
            effect = createEffect();
            actor.add_effect_with_name(name, effect);
        }
        return effect;
    }

    _getActorEffect(name) {
        if (!this._actor || this._isActorDestroyed(this._actor)) return null;
        return this._actor.get_effect(name);
    }

    _getGrainActorEffect() {
        if (!this._grainActor || this._isActorDestroyed(this._grainActor))
            return null;
        return this._grainActor.get_effect(EFFECT_NAMES.grain);
    }

    _queueActorRedraw() {
        if (this._actor && !this._isActorDestroyed(this._actor))
            this._actor.queue_redraw();
    }

    _detachGrainActor() {
        if (!this._grainActor || this._isActorDestroyed(this._grainActor))
            return;
        this._grainActor.get_effect(EFFECT_NAMES.grain)?.setActor(null);
    }

    _isActorDestroyed(actor) {
        return actor._destroyed || actor.is_destroyed?.();
    }

    _queueRepaint(...actors) {
        const activeActors = actors.filter(
            (actor) => actor && !this._isActorDestroyed(actor),
        );
        if (activeActors.length === 0) return;

        for (const actor of activeActors) {
            for (const name of Object.values(EFFECT_NAMES))
                actor.get_effect(name)?.queue_repaint();
            actor.queue_redraw();
        }

        GLib.idle_add_once(GLib.PRIORITY_DEFAULT_IDLE, () => {
            for (const actor of activeActors) {
                if (this._isActorDestroyed(actor)) continue;
                for (const name of Object.values(EFFECT_NAMES))
                    actor.get_effect(name)?.queue_repaint();
                actor.queue_redraw();
            }
        });
    }
}
