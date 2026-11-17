import GLib from "gi://GLib";

export class IconGridGeometryDiagnostics {
    constructor() {
        this._phases = new Set();
    }

    schedule(appDisplay, phase) {
        if (this._phases.has(phase)) return;

        this._phases.add(phase);

        const read = (fn, fallback = null) => {
            try {
                return fn();
            } catch (_error) {
                return fallback;
            }
        };

        const round = (value) =>
            Number.isFinite(value) ? Math.round(value * 100) / 100 : null;

        const pair = (fn) => {
            const value = read(fn);
            return value ? [round(value[0]), round(value[1])] : null;
        };

        const snapshot = (actor, tileY = null) => {
            if (!actor) return null;

            const stage = pair(() => actor.get_transformed_position());
            const box = read(() => {
                const bounds = actor.get_allocation_box();
                return [
                    round(bounds.x1),
                    round(bounds.y1),
                    round(bounds.x2),
                    round(bounds.y2),
                ];
            });

            return {
                type: read(() => actor.constructor.name),
                parent: read(() => actor.get_parent()?.constructor.name),
                position: pair(() => actor.get_position()),
                stagePosition: stage,
                relativeY:
                    stage && tileY !== null ? round(stage[1] - tileY) : null,
                size: pair(() => actor.get_size()),
                stageSize: pair(() => actor.get_transformed_size()),
                allocation: box,
                preferred: read(() => actor.get_preferred_size().map(round)),
                yAlign: read(() => actor.y_align),
                xAlign: read(() => actor.x_align),
                yExpand: read(() => actor.y_expand),
                translationY: round(read(() => actor.translation_y)),
                scaleY: round(read(() => actor.scale_y)),
                visible: read(() => actor.visible),
                clip: read(() => actor.clip_to_allocation),
            };
        };

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            const grid = appDisplay?._grid;

            if (!grid) {
                console.log(
                    `[ALT_ICON_GEOMETRY] ${phase}: AppGrid unavailable`,
                );
                return GLib.SOURCE_REMOVE;
            }

            const count = grid.get_n_children();

            console.log(
                `[ALT_ICON_GEOMETRY_BEGIN] phase=${phase} count=${count}`,
            );

            for (let index = 0; index < count; index++) {
                const item = grid.get_child_at_index(index);
                if (!item) continue;

                const tile = snapshot(item);
                const tileY = tile?.stagePosition?.[1] ?? 0;
                const base = item.icon;
                const bin = base?._iconBin;

                const record = {
                    phase,
                    index,
                    app: read(() => item.app.get_name(), "Unknown"),
                    item: tile,
                    iconContainer: snapshot(item._iconContainer, tileY),
                    baseIcon: snapshot(base, tileY),
                    iconBox: snapshot(base?._box, tileY),
                    iconBin: snapshot(bin, tileY),
                    binChild: snapshot(
                        read(() => bin.get_child()),
                        tileY,
                    ),
                    overlay: snapshot(item._chRunningOverlay, tileY),
                    icon: snapshot(base?.icon, tileY),
                    label: snapshot(base?.label, tileY),
                };

                console.log(`[ALT_ICON_GEOMETRY] ${JSON.stringify(record)}`);
            }

            console.log(`[ALT_ICON_GEOMETRY_END] phase=${phase}`);
            return GLib.SOURCE_REMOVE;
        });
    }
}
