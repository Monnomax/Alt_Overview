import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
    BackgroundEffects,
    GrainEffect,
    removeBackgroundEffects,
} from "./effects.js";

const GRAIN_EFFECT_NAME = "overview-bg-grain";

const EFFECT_SETTINGS_KEYS = new Set([
    "apply-to-wallpaper",
    "brightness",
    "blur",
    "saturation",
    "grain",
]);

/**
 * Applies the background sliders to GNOME Shell's real desktop wallpaper
 * actors. This controller intentionally lives for the whole extension
 * lifetime; it must not depend on Overview having been opened.
 */
export class DesktopWallpaperEffectsController {
    constructor(settings, diagnostics = null) {
        this._settings = settings;
        this._diagnostics = diagnostics;
        this._entries = new Map();
        this._enabled = false;
        this._settingsChangedId = 0;
        this._monitorsChangedId = 0;
        this._initialSyncId = 0;
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;

        this._settingsChangedId = this._settings.connect(
            "changed",
            (_settings, key) => {
                if (!EFFECT_SETTINGS_KEYS.has(key)) return;
                this._syncManagers();
            },
        );

        this._monitorsChangedId = Main.layoutManager.connect(
            "monitors-changed",
            () => this._syncManagers(),
        );

        // On startup, GNOME can still be constructing its initial wallpaper
        // managers. Sync now and once again after the current main-loop turn.
        this._syncManagers();
        this._initialSyncId = GLib.idle_add_once(
            GLib.PRIORITY_DEFAULT_IDLE,
            () => {
                this._initialSyncId = 0;
                this._syncManagers();
            },
        );
    }

    disable() {
        this._enabled = false;

        if (this._initialSyncId) {
            GLib.source_remove(this._initialSyncId);
            this._initialSyncId = 0;
        }

        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        for (const [manager, entry] of this._entries)
            this._disposeEntry(manager, entry);

        this._entries.clear();
        this._removeGrainEffect();
        this._settings = null;
        this._diagnostics = null;
    }

    _syncManagers() {
        if (!this._enabled) return;

        // GNOME Shell 50's LayoutManager owns the active desktop BackgroundManagers.
        // Their actors are the real wallpaper actors under _backgroundGroup,
        // unlike AltOverview's separate actors in overviewGroup.
        const managers = Main.layoutManager?._bgManagers;
        if (!Array.isArray(managers)) {
            this._syncGrainEffect();
            return;
        }

        const currentManagers = new Set(managers.filter(Boolean));

        for (const [manager, entry] of this._entries) {
            if (currentManagers.has(manager)) continue;
            this._disposeEntry(manager, entry);
            this._entries.delete(manager);
        }

        for (const manager of currentManagers) {
            let entry = this._entries.get(manager);
            if (!entry) {
                entry = {
                    actor: null,
                    actors: new Map(),
                    effects: new BackgroundEffects(),
                    effectsAttached: false,
                    changedId: 0,
                };
                entry.changedId = manager.connect("changed", () => {
                    try {
                        this._syncEntry(manager, entry);
                    } catch (error) {
                        this._diagnostics?.error(
                            "desktop-wallpaper",
                            "Could not update wallpaper actor effects",
                            error,
                        );
                    }
                });
                this._entries.set(manager, entry);
            }

            try {
                this._syncEntry(manager, entry);
            } catch (error) {
                this._diagnostics?.error(
                    "desktop-wallpaper",
                    "Could not synchronize wallpaper effects",
                    error,
                );
            }
        }
        this._syncGrainEffect();
    }

    _syncGrainEffect() {
        const group = Main.layoutManager?._backgroundGroup;
        if (!group || this._isActorDestroyed(group)) return;

        const applyToWallpaper =
            this._settings?.get_boolean("apply-to-wallpaper") ?? false;
        const grain = this._settings?.get_int("grain") ?? 0;
        if (!applyToWallpaper || grain <= 0) {
            this._removeGrainEffect();
            return;
        }

        let effect = group.get_effect(GRAIN_EFFECT_NAME);
        if (!effect) {
            effect = new GrainEffect();
            group.add_effect_with_name(GRAIN_EFFECT_NAME, effect);
        }

        effect.setActor(group);
        effect.setAmount(grain);
        group.queue_redraw();
    }

    _removeGrainEffect() {
        const group = Main.layoutManager?._backgroundGroup;
        if (!group || this._isActorDestroyed(group)) return;

        const effect = group.get_effect(GRAIN_EFFECT_NAME);
        if (!effect) return;

        effect.setActor(null);
        group.remove_effect_by_name(GRAIN_EFFECT_NAME);
        group.queue_redraw();
    }

    _syncEntry(manager, entry) {
        if (!this._enabled) return;

        const actor = manager.backgroundActor ?? null;
        const actorChanged = actor !== entry.actor;
        entry.actor = actor;

        const applyToWallpaper = this._settings.get_boolean("apply-to-wallpaper");
        const brightness = this._settings.get_int("brightness");
        const saturation = this._settings.get_double("saturation");
        const blur = this._settings.get_int("blur");
        // Grain is applied once on _backgroundGroup, after per-wallpaper blur.
        const needsEffects =
            brightness !== 0 ||
            saturation !== 1.0 ||
            blur !== 0;

        const actorAvailable = actor && !this._isActorDestroyed(actor);
        if (!applyToWallpaper || !needsEffects || !actorAvailable) {
            // Also clean up a stale effect left behind by an interrupted reload.
            if (actorAvailable) removeBackgroundEffects(actor);
            this._deactivateEntry(entry);
            return;
        }

        if (actorChanged || !entry.effectsAttached) {
            this._trackActor(entry, actor);
            entry.effects.setActors(actor, null);
            entry.effectsAttached = true;

            if (actorChanged) {
                this._diagnostics?.event(
                    "desktop-wallpaper",
                    "Attached effects to desktop wallpaper actor",
                    {},
                    "verbose",
                );
            }
        }

        entry.effects.setBrightness(brightness);
        entry.effects.setSaturation(saturation);
        entry.effects.setBlur(blur);
    }

    _trackActor(entry, actor) {
        if (entry.actors.has(actor) || this._isActorDestroyed(actor)) return;

        const destroyId = actor.connect("destroy", () => {
            entry.actors.delete(actor);
            if (entry.actor === actor) entry.actor = null;
        });
        entry.actors.set(actor, destroyId);
    }

    _deactivateEntry(entry) {
        // Clear BackgroundEffects' references first, then remove our named effects
        // from every current or fading wallpaper actor we have touched.
        entry.effects.setActors(null, null);
        entry.effectsAttached = false;

        for (const [actor, destroyId] of entry.actors) {
            if (this._isActorDestroyed(actor)) continue;

            removeBackgroundEffects(actor);
            if (destroyId) actor.disconnect(destroyId);
        }
        entry.actors.clear();
    }

    _disposeEntry(manager, entry) {
        if (entry.changedId) {
            try {
                manager.disconnect(entry.changedId);
            } catch (error) {
                this._diagnostics?.error(
                    "desktop-wallpaper",
                    "Could not disconnect wallpaper manager signal",
                    error,
                );
            }
            entry.changedId = 0;
        }

        this._deactivateEntry(entry);
        entry.actor = null;
    }

    _isActorDestroyed(actor) {
        return !actor || actor._destroyed || actor.is_destroyed?.();
    }
}
