import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { MonitorBackground } from "./monitorBackground.js";

export class BackgroundController {
    constructor(settings, diagnostics = null) {
        this._settings = settings;
        this._diagnostics = diagnostics;
        this._backgrounds = [];
        this._monitorRebuildSourceId = 0;
        this._container = null;
        this._monitorsChangedId = 0;
    }

    enable() {
        this._diagnostics?.event("background", "Create background container", {
            monitorCount: Main.layoutManager.monitors?.length ?? 0,
        });
        this._container = new St.Widget({
            name: "overview-background-container",
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
        });

        Main.layoutManager.overviewGroup.insert_child_at_index(
            this._container,
            0,
        );
        this._monitorsChangedId = Main.layoutManager.connect(
            "monitors-changed",
            () => {
                this._diagnostics?.event("background", "Monitor configuration changed");
                this._scheduleMonitorRebuild();
            },
        );
        this._rebuildMonitors();
    }

    disable() {
        if (this._monitorRebuildSourceId) {
            GLib.source_remove(this._monitorRebuildSourceId);
            this._monitorRebuildSourceId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        this._container?.destroy();
        this._backgrounds = [];
        this._container = null;
    }

    setVisible(visible) {
        if (this._container) this._container.visible = visible;
    }

    applySettings() {
        const brightness = this._settings.get_int("brightness");
        const saturation = this._settings.get_double("saturation");
        const blur = this._settings.get_int("blur");
        const grain = this._settings.get_int("grain");

        for (const background of this._backgrounds) {
            background.effects.setBrightness(brightness);
            background.effects.setSaturation(saturation);
            background.effects.setBlur(blur);
            background.effects.setGrain(grain);
        }
    }

    _rebuildMonitors() {
        const monitors = Main.layoutManager.monitors;
        if (
            !monitors?.length ||
            monitors.some(
                (monitor) =>
                    ![
                        monitor.x,
                        monitor.y,
                        monitor.width,
                        monitor.height,
                    ].every((value) => Number.isFinite(value)) ||
                    monitor.width <= 0 ||
                    monitor.height <= 0,
            )
        ) {
            this._diagnostics?.warning(
                "background",
                "Cannot build monitor backgrounds from current geometry",
                {
                    monitors: monitors?.map((monitor) => ({
                        x: monitor.x,
                        y: monitor.y,
                        width: monitor.width,
                        height: monitor.height,
                    })) ?? [],
                },
            );
            return;
        }

        this._container.destroy_all_children();
        this._backgrounds = [];

        this._diagnostics?.event(
            "background",
            "Rebuild monitor backgrounds",
            {
                monitors: monitors.map(({ x, y, width, height }) => ({
                    x,
                    y,
                    width,
                    height,
                })),
            },
        );

        for (let index = 0; index < monitors.length; index++) {
            const background = new MonitorBackground(index, this._diagnostics);
            this._container.add_child(background);
            this._backgrounds.push(background);
        }

        this.applySettings();
    }

    _scheduleMonitorRebuild() {
        if (this._monitorRebuildSourceId) return;

        this._monitorRebuildSourceId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT,
            () => {
                this._monitorRebuildSourceId = 0;
                if (this._container) {
                    try {
                        this._rebuildMonitors();
                    } catch (error) {
                        this._diagnostics?.error(
                            "background",
                            "Scheduled monitor rebuild failed",
                            error,
                        );
                    }
                }
                return GLib.SOURCE_REMOVE;
            },
        );
    }
}
