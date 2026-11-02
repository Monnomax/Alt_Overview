import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Background from "resource:///org/gnome/shell/ui/background.js";

import { BackgroundEffects } from "./effects.js";

export const MonitorBackground = GObject.registerClass(
    class MonitorBackground extends St.Widget {
        _init(monitorIndex, diagnostics = null) {
            super._init({
                layout_manager: new Clutter.BinLayout(),
                reactive: false,
            });

            this._cleanedUp = false;

            this._monitorIndex = monitorIndex;
            this._diagnostics = diagnostics;
            this.effects = new BackgroundEffects();

            this._bgManager = new Background.BackgroundManager({
                container: this,
                layoutManager: Main.layoutManager,
                monitorIndex,
                controlPosition: false,
            });

            this._changedId = this._bgManager.connect("changed", () => {
                try {
                    this._syncBackgroundActor();
                    this._relayout();
                    this._diagnostics?.event(
                        "background",
                        "Wallpaper actor changed",
                        { monitor: this._monitorIndex },
                        "verbose",
                    );
                } catch (error) {
                    this._diagnostics?.error(
                        "background",
                        "Could not update wallpaper after change",
                        error,
                        { monitor: this._monitorIndex },
                    );
                }
            });

            this._syncBackgroundActor();
            this._relayout();
        }

        _syncBackgroundActor() {
            const actor = this._bgManager.backgroundActor;

            if (!actor) {
                this.effects.setActors(null, this);
                this._diagnostics?.event(
                    "background",
                    "Wallpaper actor is not available yet",
                    { monitor: this._monitorIndex },
                    "verbose",
                );
                return;
            }

            this.effects.setActors(actor, this);
        }

        _relayout() {
            const monitor = Main.layoutManager.monitors[this._monitorIndex];
            if (
                !monitor ||
                ![monitor.x, monitor.y, monitor.width, monitor.height].every(
                    (value) => Number.isFinite(value),
                ) ||
                monitor.width <= 0 ||
                monitor.height <= 0
            ) {
                this._diagnostics?.warning(
                    "background",
                    "Monitor geometry is unavailable for wallpaper actor",
                    {
                        monitor: this._monitorIndex,
                        geometry: monitor
                            ? {
                                  x: monitor.x,
                                  y: monitor.y,
                                  width: monitor.width,
                                  height: monitor.height,
                              }
                            : null,
                    },
                );
                return;
            }

            this.set_position(monitor.x, monitor.y);
            this.set_size(monitor.width, monitor.height);
        }

        cleanup() {
            if (this._cleanedUp) return;

            this._cleanedUp = true;

            // Disconnect BackgroundManager signal.
            if (this._changedId) {
                try {
                    this._bgManager?.disconnect(this._changedId);
                } catch (error) {
                    this._diagnostics?.error(
                        "background",
                        "Could not disconnect BackgroundManager signal",
                        error,
                        { monitor: this._monitorIndex },
                    );
                }

                this._changedId = 0;
            }

            // Detach effects from the wallpaper actor.
            try {
                this.effects?.setActors(null, this);
            } catch (error) {
                this._diagnostics?.error(
                    "background",
                    "Could not detach background effects",
                    error,
                    { monitor: this._monitorIndex },
                );
            }

            // Destroy BackgroundManager.
            try {
                this._bgManager?.destroy();
            } catch (error) {
                this._diagnostics?.error(
                    "background",
                    "Could not destroy BackgroundManager",
                    error,
                    { monitor: this._monitorIndex },
                );
            }

            this._bgManager = null;
            this.effects = null;
        }
    },
);
